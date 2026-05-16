import express, { Router } from 'express'
import path from 'path'
import fs from 'fs/promises'
import type { ProjectService } from '../services/project.ts'
import type { GroupService } from '../services/group.ts'
import type { FileStore } from '../storage/fileStore.ts'
import type { Settings } from '../storage/types.ts'

// Lazy-imported services — instantiated per project on demand
import { AuraIndexer } from '../services/aura/indexer.ts'
import { AuraQueryService } from '../services/aura/graph.ts'
import { AuraWatcherManager } from '../services/aura/watcher-manager.ts'
import { isGitRepository, getGitDiff } from '../services/aura/git.ts'
import { syncContracts, loadContracts } from '../services/aura/contract-registry.ts'
import { GroupQueryService } from '../services/aura/group-query.ts'
import { installSkills, listAvailableSkills } from '../services/skill-installer.ts'
import { AuraChatService } from '../services/aura-chat.ts'
import type { AuraChatSession } from '../services/aura-chat.ts'
import type { GitDiffScope } from '../services/aura/types.ts'
import { globalApprovalManagers } from '../services/aura/agent.ts'
import { PlanPersistenceService } from '../services/aura/plan-persistence.ts'

const groupQueryService = new GroupQueryService()
const chatService = new AuraChatService()

function matchesGlobSimple(str: string, glob: string): boolean {
  const re = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '{{GS}}')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
    .replace(/\{\{GS\}\}/g, '.*')
  return new RegExp(`(^|/)${re}($|/)`).test(str) || new RegExp(re).test(str)
}

export function createAuraRouter(
  projectService: ProjectService,
  indexerMap: Map<string, AuraIndexer>,
  queryMap: Map<string, AuraQueryService>,
  watcherManager: AuraWatcherManager,
  groupService: GroupService,
  dataDir: string,
  store: FileStore,
): Router {
  const router = Router()

  async function getAuraConfig() {
    const settings = await store.read<Settings>('settings.json')
    return {
      ollamaBaseUrl: (() => {
        const raw = (settings?.ollamaBaseUrl?.trim() || process.env.OLLAMA_BASE_URL || 'http://localhost:11434')
        return /^https?:\/\//i.test(raw) ? raw : `http://${raw}`
      })(),
      chatModel: settings?.defaultProjectModel || settings?.defaultModel || process.env.OLLAMA_MODEL || 'glm-5.1:cloud',
      embedModel: settings?.defaultEmbeddingModel || 'mxbai-embed-large:335m',
      contextWindow: settings?.contextWindowSize || 8192,
    }
  }

  // POST /api/aura/index/:projectId — Start indexing
  router.post('/index/:projectId', async (req, res) => {
    const { projectId } = req.params
    const project = await projectService.get(projectId)
    if (!project) {
      res.status(404).json({ error: 'Project not found' })
      return
    }

    const config = await getAuraConfig()
    let indexer = indexerMap.get(projectId)
    if (!indexer) {
      indexer = new AuraIndexer(project.workspacePath, config)
      indexerMap.set(projectId, indexer)
    }

    // Start indexing in background — don't await
    indexer.indexProject()
      .then(async () => {
        let qs = queryMap.get(projectId)
        if (!qs) {
          qs = new AuraQueryService(project.workspacePath, config)
          queryMap.set(projectId, qs)
        }
        await qs.load()

        // Push search engines to query service
        const { bm25, embedding } = indexer.getSearchEngines()
        qs.setSearchEngines(bm25, embedding)

        // Transition to watching phase and start file watcher
        indexer.setWatching()
        await watcherManager.startWatching(projectId, project.workspacePath, indexer, qs)
      })
      .catch((err) => {
        console.error(`AURA indexing failed for ${projectId}:`, err)
      })

    res.json({ status: 'started', projectId })
  })

  // GET /api/aura/status/:projectId — Indexing progress
  router.get('/status/:projectId', async (req, res) => {
    const { projectId } = req.params
    const indexer = indexerMap.get(projectId)
    if (!indexer) {
      res.json({ phase: 'idle', progress: 0, message: 'Not indexed yet' })
      return
    }
    res.json(indexer.getStatus())
  })

  // GET /api/aura/graph/:projectId — Full graph data
  router.get('/graph/:projectId', async (req, res) => {
    const { projectId } = req.params
    const qs = queryMap.get(projectId)
    if (!qs || !qs.isLoaded()) {
      res.status(404).json({ error: 'Graph not available. Start indexing first.' })
      return
    }
    try {
      res.json(qs.getGraph())
    } catch (err) {
      console.error(`Error fetching graph for project ${projectId}:`, err)
      res.status(500).json({ error: 'Failed to fetch graph' })
    }
  })

  // POST /api/aura/search/:projectId — Search nodes
  router.post('/search/:projectId', async (req, res) => {
    const { projectId } = req.params
    const { query, limit, kinds, mode } = req.body as { query: string; limit?: number; kinds?: string[]; mode?: string }
    if (!query) {
      res.status(400).json({ error: 'Query string required' })
      return
    }

    const qs = queryMap.get(projectId)
    if (!qs || !qs.isLoaded()) {
      res.status(404).json({ error: 'Graph not available' })
      return
    }

    try {
      const results = await qs.search(query, { limit: limit ?? 50, kinds, mode: (mode as any) ?? 'hybrid' })
      res.json({ results })
    } catch (err) {
      console.error(`Error searching for "${query}" in project ${projectId}:`, err)
      res.status(500).json({ error: 'Search failed' })
    }
  })

  // POST /api/aura/context/:projectId — 360° context
  router.post('/context/:projectId', async (req, res) => {
    const { projectId } = req.params
    const { nodeId } = req.body as { nodeId: string }
    if (!nodeId) {
      res.status(400).json({ error: 'nodeId required' })
      return
    }

    const qs = queryMap.get(projectId)
    if (!qs || !qs.isLoaded()) {
      res.status(404).json({ error: 'Graph not available' })
      return
    }

    try {
      const ctx = qs.context(nodeId)
      if (!ctx) {
        res.status(404).json({ error: 'Node not found' })
        return
      }
      res.json(ctx)
    } catch (err) {
      console.error(`Error fetching context for node ${nodeId}:`, err)
      res.status(500).json({ error: 'Failed to fetch node context' })
    }
  })

  // POST /api/aura/impact/:projectId — Impact analysis
  router.post('/impact/:projectId', async (req, res) => {
    const { projectId } = req.params
    const { targetId } = req.body as { targetId: string }
    if (!targetId) {
      res.status(400).json({ error: 'targetId required' })
      return
    }

    const qs = queryMap.get(projectId)
    if (!qs || !qs.isLoaded()) {
      res.status(404).json({ error: 'Graph not available' })
      return
    }

    try {
      const result = qs.impact(targetId)
      if (!result) {
        res.status(404).json({ error: 'Target node not found' })
        return
      }
      res.json(result)
    } catch (err) {
      console.error(`Error computing impact for node ${targetId}:`, err)
      res.status(500).json({ error: 'Failed to compute impact analysis' })
    }
  })

  // POST /api/aura/incremental-index/:projectId — Trigger incremental indexing
  router.post('/incremental-index/:projectId', async (req, res) => {
    const { projectId } = req.params
    const { files } = req.body as { files?: string[] }
    const config = await getAuraConfig()

    const project = await projectService.get(projectId)
    if (!project) {
      res.status(404).json({ error: 'Project not found' })
      return
    }

    let indexer = indexerMap.get(projectId)
    if (!indexer) {
      indexer = new AuraIndexer(project.workspacePath, config)
      indexerMap.set(projectId, indexer)
    }

    // Start incremental indexing in background
    indexer.incrementalIndex(files)
      .then(async () => {
        let qs = queryMap.get(projectId)
        if (!qs) {
          qs = new AuraQueryService(project.workspacePath, config)
          queryMap.set(projectId, qs)
        }
        await qs.load()

        // Push search engines to query service
        const { bm25, embedding } = indexer.getSearchEngines()
        qs.setSearchEngines(bm25, embedding)

        // Return to watching phase
        indexer.setWatching()
      })
      .catch((err) => {
        console.error(`AURA incremental indexing failed for ${projectId}:`, err)
      })

    res.json({ status: 'started', projectId })
  })

  // POST /api/aura/detect-changes/:projectId — Detect changes from git diff
  router.post('/detect-changes/:projectId', async (req, res) => {
    const { projectId } = req.params
    const project = await projectService.get(projectId)
    if (!project) {
      res.status(404).json({ error: 'Project not found' })
      return
    }

    const isGit = await isGitRepository(project.workspacePath)
    if (!isGit) {
      res.status(400).json({ error: 'Project is not a git repository' })
      return
    }

    const qs = queryMap.get(projectId)
    if (!qs || !qs.isLoaded()) {
      res.status(404).json({ error: 'Graph not available. Start indexing first.' })
      return
    }

    const { scope, base, head } = req.body as { scope?: GitDiffScope; base?: string; head?: string }

    const fileDiffs = await getGitDiff(project.workspacePath, {
      scope: scope ?? 'unstaged',
      base,
      head,
    })

    const result = qs.detectChanges(fileDiffs)
    res.json(result)
  })

  // POST /api/aura/rename/:projectId — Rename a symbol across the codebase
  router.post('/rename/:projectId', async (req, res) => {
    const { projectId } = req.params
    const { nodeId, newName, dryRun } = req.body as { nodeId: string; newName: string; dryRun?: boolean }
    const config = await getAuraConfig()

    if (!nodeId || !newName) {
      res.status(400).json({ error: 'nodeId and newName are required' })
      return
    }

    const project = await projectService.get(projectId)
    if (!project) {
      res.status(404).json({ error: 'Project not found' })
      return
    }

    const qs = queryMap.get(projectId)
    if (!qs || !qs.isLoaded()) {
      res.status(404).json({ error: 'Graph not available. Start indexing first.' })
      return
    }

    // If nodeId doesn't contain ':', it's a name — search for matches
    let resolvedId = nodeId
    if (!nodeId.includes(':')) {
      const results = await qs.search(nodeId, { limit: 10, mode: 'basic' })
      if (results.length === 0) {
        res.status(404).json({ error: `Symbol "${nodeId}" not found` })
        return
      }
      if (results.length > 1) {
        res.status(409).json({
          error: `Symbol "${nodeId}" is ambiguous. Please provide a full nodeId.`,
          candidates: results.map(r => ({ id: r.node.id, name: r.node.name, filePath: r.node.filePath })),
        })
        return
      }
      resolvedId = results[0].node.id
    }

    const shouldDryRun = dryRun !== false // default true

    const result = await qs.rename(resolvedId, newName, shouldDryRun)
    res.json(result)

    // Trigger re-index if not a dry run
    if (!shouldDryRun && result.edits.length > 0) {
      const changedFiles = [...new Set(result.edits.map(e => e.filePath))]
      let indexer = indexerMap.get(projectId)
      if (!indexer) {
        indexer = new AuraIndexer(project.workspacePath, config)
        indexerMap.set(projectId, indexer)
      }
      indexer.incrementalIndex(changedFiles)
        .then(async () => {
          await qs.load()
          const { bm25, embedding } = indexer.getSearchEngines()
          qs.setSearchEngines(bm25, embedding)
          indexer.setWatching()
          await watcherManager.startWatching(projectId, project.workspacePath, indexer, qs)
        })
        .catch((err) => {
          console.error(`AURA re-index after rename failed for ${projectId}:`, err)
        })
    }
  })

  // POST /api/aura/route-map/:projectId — Get all routes and API calls
  router.post('/route-map/:projectId', async (req, res) => {
    const { projectId } = req.params
    const qs = queryMap.get(projectId)
    if (!qs || !qs.isLoaded()) {
      res.status(404).json({ error: 'Graph not available. Start indexing first.' })
      return
    }
    res.json(qs.routeMap())
  })

  // POST /api/aura/tool-map/:projectId — Get all MCP tool definitions
  router.post('/tool-map/:projectId', async (req, res) => {
    const { projectId } = req.params
    const qs = queryMap.get(projectId)
    if (!qs || !qs.isLoaded()) {
      res.status(404).json({ error: 'Graph not available. Start indexing first.' })
      return
    }
    res.json(qs.toolMap())
  })

  // POST /api/aura/shape-check/:projectId — Check response shape vs consumer access
  router.post('/shape-check/:projectId', async (req, res) => {
    const { projectId } = req.params
    const { routeId } = req.body as { routeId: string }
    if (!routeId) {
      res.status(400).json({ error: 'routeId required' })
      return
    }

    const qs = queryMap.get(projectId)
    if (!qs || !qs.isLoaded()) {
      res.status(404).json({ error: 'Graph not available. Start indexing first.' })
      return
    }

    const result = qs.shapeCheck(routeId)
    if (!result) {
      res.status(404).json({ error: 'Route not found' })
      return
    }
    res.json(result)
  })

  // POST /api/aura/api-impact/:projectId — Impact analysis for an API route
  router.post('/api-impact/:projectId', async (req, res) => {
    const { projectId } = req.params
    const { routeId } = req.body as { routeId: string }
    if (!routeId) {
      res.status(400).json({ error: 'routeId required' })
      return
    }

    const qs = queryMap.get(projectId)
    if (!qs || !qs.isLoaded()) {
      res.status(404).json({ error: 'Graph not available. Start indexing first.' })
      return
    }

    const result = qs.apiImpact(routeId)
    if (!result) {
      res.status(404).json({ error: 'Route not found' })
      return
    }
    res.json(result)
  })

  // GET /api/aura/processes/:projectId — Get all processes
  router.get('/processes/:projectId', async (req, res) => {
    const { projectId } = req.params
    const qs = queryMap.get(projectId)
    if (!qs || !qs.isLoaded()) {
      res.status(404).json({ error: 'Graph not available. Start indexing first.' })
      return
    }
    const processes = qs.getProcesses()
    res.json({ processes })
  })

  // POST /api/aura/process/:projectId — Get process detail
  router.post('/process/:projectId', async (req, res) => {
    const { projectId } = req.params
    const { processId } = req.body as { processId: string }
    if (!processId) {
      res.status(400).json({ error: 'processId required' })
      return
    }
    const qs = queryMap.get(projectId)
    if (!qs || !qs.isLoaded()) {
      res.status(404).json({ error: 'Graph not available. Start indexing first.' })
      return
    }
    const detail = qs.getProcessDetail(processId)
    if (!detail) {
      res.status(404).json({ error: 'Process not found' })
      return
    }
    res.json(detail)
  })

  // ── Context endpoints ─────────────────────────────────────────────────────────

  // GET /api/aura/contexts/:projectId — Get context manifest
  router.get('/contexts/:projectId', async (req, res) => {
    const { projectId } = req.params
    const qs = queryMap.get(projectId)
    if (!qs || !qs.isLoaded()) {
      res.status(404).json({ error: 'Graph not available. Start indexing first.' })
      return
    }
    const manifest = qs.getContextManifest()
    if (!manifest) {
      const fallbackConfig = await getAuraConfig()
      res.json({ folders: {}, generatedAt: null, ollamaWasAvailable: false, model: fallbackConfig.chatModel })
      return
    }
    res.json(manifest)
  })

  // GET /api/aura/contexts/:projectId/root — Get root project context
  router.get('/contexts/:projectId/root', async (req, res) => {
    const { projectId } = req.params
    const qs = queryMap.get(projectId)
    if (!qs || !qs.isLoaded()) {
      res.status(404).json({ error: 'Graph not available. Start indexing first.' })
      return
    }
    const context = qs.getContextForFolder('.')
    if (!context) {
      res.status(404).json({ error: 'Root context not found' })
      return
    }
    res.type('text/markdown').send(context)
  })

  // GET /api/aura/contexts/:projectId/*folderPath — Get context for a specific folder
  router.get('/contexts/:projectId/*folderPath', async (req, res) => {
    const { projectId } = req.params
    const folderPath = req.params.folderPath || req.params[0]
    const qs = queryMap.get(projectId)
    if (!qs || !qs.isLoaded()) {
      res.status(404).json({ error: 'Graph not available. Start indexing first.' })
      return
    }
    // Convert URL path back to folder path (src_components_canvas -> src/components/canvas)
    const decodedPath = folderPath ? folderPath.replace(/_/g, '/') : '.'
    const context = qs.getContextForFolder(decodedPath)
    if (!context) {
      res.status(404).json({ error: 'Context not found for this folder' })
      return
    }
    res.type('text/markdown').send(context)
  })

  // ── Group endpoints ─────────────────────────────────────────────────────────

  // POST /api/aura/group — Create a group
  router.post('/group', async (req, res) => {
    const { name, description, memberProjectIds } = req.body as { name: string; description?: string; memberProjectIds?: string[] }
    if (!name) {
      res.status(400).json({ error: 'name is required' })
      return
    }
    const group = await groupService.create(name, description || '', memberProjectIds || [])
    res.json(group)
  })

  // GET /api/aura/group — List all groups
  router.get('/group', async (_req, res) => {
    const groups = await groupService.list()
    res.json(groups)
  })

  // GET /api/aura/group/:groupId — Get one group
  router.get('/group/:groupId', async (req, res) => {
    const group = await groupService.get(req.params.groupId)
    if (!group) {
      res.status(404).json({ error: 'Group not found' })
      return
    }
    res.json(group)
  })

  // PUT /api/aura/group/:groupId — Update a group
  router.put('/group/:groupId', async (req, res) => {
    const { name, description } = req.body as { name?: string; description?: string }
    const group = await groupService.update(req.params.groupId, { name, description })
    if (!group) {
      res.status(404).json({ error: 'Group not found' })
      return
    }
    res.json(group)
  })

  // DELETE /api/aura/group/:groupId — Delete a group
  router.delete('/group/:groupId', async (req, res) => {
    const deleted = await groupService.delete(req.params.groupId)
    if (!deleted) {
      res.status(404).json({ error: 'Group not found' })
      return
    }
    res.json({ deleted: true })
  })

  // POST /api/aura/group/:groupId/members — Add member project
  router.post('/group/:groupId/members', async (req, res) => {
    const { projectId } = req.body as { projectId: string }
    if (!projectId) {
      res.status(400).json({ error: 'projectId is required' })
      return
    }
    const group = await groupService.addMember(req.params.groupId, projectId)
    if (!group) {
      res.status(404).json({ error: 'Group not found' })
      return
    }
    res.json(group)
  })

  // DELETE /api/aura/group/:groupId/members/:projectId — Remove member project
  router.delete('/group/:groupId/members/:projectId', async (req, res) => {
    const group = await groupService.removeMember(req.params.groupId, req.params.projectId)
    if (!group) {
      res.status(404).json({ error: 'Group not found' })
      return
    }
    res.json(group)
  })

  // POST /api/aura/group/:groupId/sync — Build contract registry
  router.post('/group/:groupId/sync', async (req, res) => {
    const group = await groupService.get(req.params.groupId)
    if (!group) {
      res.status(404).json({ error: 'Group not found' })
      return
    }

    // Verify all member projects are indexed
    const memberProjects: Array<{ projectId: string; projectName: string; queryService: AuraQueryService }> = []
    for (const pid of group.memberProjectIds) {
      const qs = queryMap.get(pid)
      if (!qs || !qs.isLoaded()) {
        res.status(400).json({ error: `Project ${pid} is not indexed. Index all member projects first.` })
        return
      }
      const project = await projectService.get(pid)
      memberProjects.push({ projectId: pid, projectName: project?.name ?? pid, queryService: qs })
    }

    if (memberProjects.length === 0) {
      res.status(400).json({ error: 'Group has no member projects' })
      return
    }

    const registry = await syncContracts(group.id, memberProjects, dataDir)
    res.json(registry)
  })

  // GET /api/aura/group/:groupId/contracts — Get contracts (with filters)
  router.get('/group/:groupId/contracts', async (req, res) => {
    const registry = await loadContracts(req.params.groupId, dataDir)
    if (!registry) {
      res.status(404).json({ error: 'No contract registry found. Call /sync first.' })
      return
    }

    const { type, projectId } = req.query as { type?: string; projectId?: string }
    let contracts = registry.contracts

    if (type === 'provider') {
      contracts = contracts.filter(c => c.providerProjectId && c.sourceRouteNodeId)
    } else if (type === 'consumer') {
      contracts = contracts.filter(c => c.consumerProjectId && c.consumerNodeId)
    } else if (type === 'unmatched') {
      contracts = contracts.filter(c => !c.matched)
    }

    if (projectId) {
      contracts = contracts.filter(c => c.providerProjectId === projectId || c.consumerProjectId === projectId)
    }

    res.json({ ...registry, contracts, filteredCount: contracts.length })
  })

  // POST /api/aura/group/:groupId/query — Cross-repo search
  router.post('/group/:groupId/query', async (req, res) => {
    const group = await groupService.get(req.params.groupId)
    if (!group) {
      res.status(404).json({ error: 'Group not found' })
      return
    }

    const registry = await loadContracts(group.id, dataDir)
    if (!registry) {
      res.status(400).json({ error: 'No contract registry found. Call /sync first.' })
      return
    }

    const { query, limit, kinds, servicePrefix, mode } = req.body as { query: string; limit?: number; kinds?: string[]; servicePrefix?: string; mode?: string }
    if (!query) {
      res.status(400).json({ error: 'query is required' })
      return
    }

    const memberProjects: Array<{ projectId: string; projectName: string; queryService: AuraQueryService }> = []
    for (const pid of group.memberProjectIds) {
      const qs = queryMap.get(pid)
      if (qs && qs.isLoaded()) {
        const project = await projectService.get(pid)
        memberProjects.push({ projectId: pid, projectName: project?.name ?? pid, queryService: qs })
      }
    }

    const result = await groupQueryService.search(memberProjects, query, { limit, kinds, servicePrefix, mode: (mode as any) ?? 'hybrid' })
    res.json(result)
  })

  // GET /api/aura/group/:groupId/status — Per-repo staleness report
  router.get('/group/:groupId/status', async (req, res) => {
    const group = await groupService.get(req.params.groupId)
    if (!group) {
      res.status(404).json({ error: 'Group not found' })
      return
    }

    const registry = await loadContracts(group.id, dataDir)

    const memberProjects: Array<{ projectId: string; projectName: string; queryService: AuraQueryService }> = []
    for (const pid of group.memberProjectIds) {
      const qs = queryMap.get(pid)
      if (qs) {
        const project = await projectService.get(pid)
        memberProjects.push({ projectId: pid, projectName: project?.name ?? pid, queryService: qs })
      }
    }

    const result = groupQueryService.status(group, memberProjects, registry, projectService, indexerMap)
    res.json(result)
  })

  // POST /api/aura/group/:groupId/impact — Cross-repo impact
  router.post('/group/:groupId/impact', async (req, res) => {
    const group = await groupService.get(req.params.groupId)
    if (!group) {
      res.status(404).json({ error: 'Group not found' })
      return
    }

    const registry = await loadContracts(group.id, dataDir)
    if (!registry) {
      res.status(400).json({ error: 'No contract registry found. Call /sync first.' })
      return
    }

    const { projectId, nodeId } = req.body as { projectId: string; nodeId: string }
    if (!projectId || !nodeId) {
      res.status(400).json({ error: 'projectId and nodeId are required' })
      return
    }

    const memberProjects: Array<{ projectId: string; projectName: string; queryService: AuraQueryService }> = []
    for (const pid of group.memberProjectIds) {
      const qs = queryMap.get(pid)
      if (qs && qs.isLoaded()) {
        const project = await projectService.get(pid)
        memberProjects.push({ projectId: pid, projectName: project?.name ?? pid, queryService: qs })
      }
    }

    const result = groupQueryService.impact(projectId, nodeId, memberProjects, registry)
    if (!result) {
      res.status(404).json({ error: 'Node not found in the specified project' })
      return
    }
    res.json(result)
  })

  // POST /api/aura/group/:groupId/context — Cross-repo context
  router.post('/group/:groupId/context', async (req, res) => {
    const group = await groupService.get(req.params.groupId)
    if (!group) {
      res.status(404).json({ error: 'Group not found' })
      return
    }

    const registry = await loadContracts(group.id, dataDir)

    const { nodeId, servicePrefix } = req.body as { nodeId: string; servicePrefix?: string }
    if (!nodeId) {
      res.status(400).json({ error: 'nodeId is required' })
      return
    }

    const memberProjects: Array<{ projectId: string; projectName: string; queryService: AuraQueryService }> = []
    for (const pid of group.memberProjectIds) {
      const qs = queryMap.get(pid)
      if (qs && qs.isLoaded()) {
        const project = await projectService.get(pid)
        memberProjects.push({ projectId: pid, projectName: project?.name ?? pid, queryService: qs })
      }
    }

    const result = groupQueryService.context(nodeId, memberProjects, registry, { servicePrefix })
    if (!result) {
      res.status(404).json({ error: 'Node not found in any member project' })
      return
    }
    res.json(result)
  })

  // ── Skills endpoints ──────────────────────────────────────────────────────

  // GET /api/aura/skills — List available skill templates
  router.get('/skills', (_req, res) => {
    res.json(listAvailableSkills())
  })

  // POST /api/aura/install-skills/:projectId — Install skills into project's .aura/skills/
  router.post('/install-skills/:projectId', async (req, res) => {
    const { projectId } = req.params
    const project = await projectService.get(projectId)
    if (!project) {
      res.status(404).json({ error: 'Project not found' })
      return
    }

    const result = await installSkills(project.workspacePath)
    res.json(result)
  })

  // ── Direct tool endpoints (for external agents) ──────────────────────────────

  // POST /api/aura/read-file/:projectId — Read a source file
  router.post('/read-file/:projectId', async (req, res) => {
    const { projectId } = req.params
    const { filePath, startLine, endLine } = req.body as { filePath?: string; startLine?: number; endLine?: number }

    if (!filePath) {
      res.status(400).json({ error: 'filePath is required' })
      return
    }

    const project = await projectService.get(projectId)
    if (!project) {
      res.status(404).json({ error: 'Project not found' })
      return
    }

    const fullPath = path.resolve(project.workspacePath, filePath)
    if (!fullPath.startsWith(path.resolve(project.workspacePath))) {
      res.status(403).json({ error: 'Invalid file path' })
      return
    }

    try {
      const content = await fs.readFile(fullPath, 'utf-8')
      const lines = content.split('\n')
      const start = Math.max(1, startLine ?? 1)
      const end = Math.min(lines.length, endLine ?? lines.length)

      if (start > lines.length) {
        res.json({ filePath, totalLines: lines.length, error: `startLine ${start} out of range` })
        return
      }

      const MAX_LINES = 500
      const cappedEnd = Math.min(end, start + MAX_LINES - 1)
      const selected = lines.slice(start - 1, cappedEnd)
      const numbered = selected.map((line, i) => `${start + i}: ${line}`).join('\n')

      res.json({
        filePath,
        totalLines: lines.length,
        startLine: start,
        endLine: cappedEnd,
        ...(cappedEnd < end ? { note: `Showing ${MAX_LINES} of ${end - start + 1} requested lines. Use startLine/endLine to read more.` } : {}),
        content: numbered,
      })
    } catch (err) {
      res.status(404).json({ error: `Could not read file "${filePath}": ${err instanceof Error ? err.message : String(err)}` })
    }
  })

  // POST /api/aura/search-pattern/:projectId — Search for a pattern across files
  router.post('/search-pattern/:projectId', async (req, res) => {
    const { projectId } = req.params
    const { pattern, glob, contextLines, maxMatches } = req.body as {
      pattern?: string
      glob?: string
      contextLines?: number
      maxMatches?: number
    }

    if (!pattern) {
      res.status(400).json({ error: 'pattern is required' })
      return
    }

    const project = await projectService.get(projectId)
    if (!project) {
      res.status(404).json({ error: 'Project not found' })
      return
    }

    try {
      const regex = new RegExp(pattern, 'i')
      const ctx = Math.min(20, contextLines ?? 5)
      const max = maxMatches ?? 30
      const results: Array<{ filePath: string; line: number; column: number; match: string; before: string[]; after: string[] }> = []

      const skipDirs = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.next', '.cache'])
      const skipExts = new Set(['.png', '.jpg', '.jpeg', '.gif', '.ico', '.svg', '.woff', '.woff2', '.ttf', '.eot', '.mp3', '.mp4', '.zip', '.tar', '.gz', '.wasm', '.lock'])

      const searchDir = async (dir: string, relPath: string) => {
        if (results.length >= max) return
        const entries = await fs.readdir(dir, { withFileTypes: true })
        for (const entry of entries) {
          if (results.length >= max) break
          const entryRel = relPath ? `${relPath}/${entry.name}` : entry.name
          if (entry.isDirectory() && skipDirs.has(entry.name)) continue
          const entryPath = path.join(dir, entry.name)
          if (entry.isDirectory()) {
            await searchDir(entryPath, entryRel)
          } else {
            const ext = entry.name.includes('.') ? '.' + entry.name.split('.').pop()! : entry.name
            if (skipExts.has(ext.toLowerCase())) continue
            if (glob && !matchesGlobSimple(entryRel, glob) && !matchesGlobSimple(entry.name, glob)) continue
            try {
              const content = await fs.readFile(entryPath, 'utf-8')
              const lines = content.split('\n')
              for (let i = 0; i < lines.length; i++) {
                if (results.length >= max) break
                const m = regex.exec(lines[i])
                regex.lastIndex = 0
                if (m) {
                  results.push({
                    filePath: entryRel,
                    line: i + 1,
                    column: m.index + 1,
                    match: m[0],
                    before: lines.slice(Math.max(0, i - ctx), i),
                    after: lines.slice(i + 1, Math.min(lines.length, i + 1 + ctx)),
                  })
                }
              }
            } catch { /* skip */ }
          }
        }
      }

      await searchDir(project.workspacePath, '')
      res.json({ pattern, totalMatches: results.length, matches: results })
    } catch (err) {
      res.status(400).json({ error: `Invalid pattern: ${err instanceof Error ? err.message : String(err)}` })
    }
  })

  // POST /api/aura/ask/:projectId — AI agent endpoint
  // Query param ?mode=json returns a single JSON response instead of SSE stream
  router.post('/ask/:projectId', async (req, res) => {
    const { projectId } = req.params
    const { prompt, context, priorMessages } = req.body as {
      prompt?: string
      context?: Record<string, unknown>
      priorMessages?: Array<{ role: string; content: string }>
    }
    const mode = req.query.mode as string | undefined

    if (!prompt) {
      res.status(400).json({ error: 'prompt is required' })
      return
    }

    const project = await projectService.get(projectId)
    if (!project) {
      res.status(404).json({ error: 'Project not found' })
      return
    }

    const qs = queryMap.get(projectId)
    if (!qs || !qs.isLoaded()) {
      res.status(404).json({ error: 'Graph not available. Start indexing first.' })
      return
    }

    const { AuraAgent } = await import('../services/aura/agent.ts')
    const config = await getAuraConfig()
    const agent = new AuraAgent(qs, project.workspacePath, config.ollamaBaseUrl, config.chatModel, config.contextWindow)

    // JSON mode — collect all SSE events and return a single response
    if (mode === 'json') {
      const { CollectingEventSink } = await import('../services/aura/sse.ts')
      const sink = new CollectingEventSink()

      try {
        await agent.run(prompt, sink, context, priorMessages)
      } catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Agent failed' })
        return
      }

      const tokens = sink.tokens.join('')
      const errors = sink.errors

      res.json({
        content: tokens,
        errors: errors.length > 0 ? errors : undefined,
      })
      return
    }

    // SSE mode (default) — stream events to the client
    const { setupSSEHeaders, SSEEventSink } = await import('../services/aura/sse.ts')
    setupSSEHeaders(res)

    const eventSink = new SSEEventSink(res)

    // Handle client disconnect
    let aborted = false
    req.on('close', () => {
      aborted = true
      agent.abort()
    })

    try {
      await agent.run(prompt, eventSink, context, priorMessages)
    } catch (err) {
      if (!aborted) {
        eventSink.emit('error', { message: err instanceof Error ? err.message : 'Agent failed' })
      }
    } finally {
      eventSink.close()
    }
  })

  // ── Chat Session Endpoints ─────────────────────────────────────────────────

  // GET /api/aura/chats/:projectId — Get or create chat for a project
  router.get('/chats/:projectId', async (req, res) => {
    const { projectId } = req.params
    const project = await projectService.get(projectId)
    if (!project) {
      res.status(404).json({ error: 'Project not found' })
      return
    }
    let chat = await chatService.get(project.workspacePath)
    if (!chat) {
      chat = await chatService.create(project.workspacePath)
    }
    res.json(chat)
  })

  // POST /api/aura/chats/:projectId — Create new chat (replaces existing)
  router.post('/chats/:projectId', async (req, res) => {
    const { projectId } = req.params
    const project = await projectService.get(projectId)
    if (!project) {
      res.status(404).json({ error: 'Project not found' })
      return
    }
    const chat = await chatService.create(project.workspacePath)
    res.json(chat)
  })

  // PATCH /api/aura/chats/:projectId/:chatId — Save messages
  router.patch('/chats/:projectId/:chatId', async (req, res) => {
    const { projectId, chatId } = req.params
    const project = await projectService.get(projectId)
    if (!project) {
      res.status(404).json({ error: 'Project not found' })
      return
    }
    const { messages } = req.body as { messages: unknown[] }
    const existing = await chatService.get(project.workspacePath)
    if (!existing || existing.id !== chatId) {
      res.status(404).json({ error: 'Chat not found' })
      return
    }
    existing.messages = messages as AuraChatSession['messages']
    await chatService.save(project.workspacePath, existing)
    res.json(existing)
  })

  // GET /api/aura/context-estimate/:projectId — Estimate system prompt token count
  router.get('/context-estimate/:projectId', async (req, res) => {
    const { projectId } = req.params
    const project = await projectService.get(projectId)
    if (!project) {
      res.status(404).json({ error: 'Project not found' })
      return
    }

    const qs = queryMap.get(projectId)
    if (!qs || !qs.isLoaded()) {
      res.json({ systemTokens: 0, contextWindow: (await getAuraConfig()).contextWindow })
      return
    }

    const config = await getAuraConfig()
    const { AuraAgent } = await import('../services/aura/agent.ts')
    const estimate = AuraAgent.estimateSystemTokens(qs, project.workspacePath, config.ollamaBaseUrl, config.chatModel)

    res.json({
      systemTokens: estimate,
      contextWindow: config.contextWindow,
    })
  })

  // GET /api/aura/plans/:projectId — List active plans
  router.get('/plans/:projectId', async (req, res) => {
    const { projectId } = req.params
    const project = await projectService.get(projectId)
    if (!project) {
      res.status(404).json({ error: 'Project not found' })
      return
    }
    const planService = new PlanPersistenceService()
    const plans = await planService.listPlans(project.workspacePath)
    res.json({ plans })
  })

  // POST /api/aura/approve/:projectId — Resolve a pending approval request
  router.post('/approve/:projectId', async (req, res) => {
    const { projectId } = req.params
    const { approvalId, approved, feedback } = req.body as { approvalId: string; approved: boolean; feedback?: string }

    if (!approvalId) {
      res.status(400).json({ error: 'approvalId is required' })
      return
    }

    const project = await projectService.get(projectId)
    if (!project) {
      res.status(404).json({ error: 'Project not found' })
      return
    }

    const am = globalApprovalManagers.get(project.workspacePath)
    if (!am) {
      res.status(404).json({ error: 'No pending approvals for this project' })
      return
    }

    const resolved = am.resolve(approvalId, { approved, feedback })
    if (!resolved) {
      res.status(404).json({ error: 'Approval request not found or expired' })
      return
    }

    res.json({ status: 'ok' })
  })

  // Global error handler — catches unhandled errors from any route above
  router.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('AURA route error:', err)
    res.status(500).json({ error: err.message || 'Internal server error' })
  })

  return router
}