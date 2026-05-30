import path from 'path'
import fs from 'fs/promises'
import fsSync from 'fs'
import type {
  AuraNode,
  AuraEdge,
  GraphData,
  FolderContextData,
  ProjectContextData,
  ContextManifest,
} from './types.ts'
import { AuraNodeKind, AuraEdgeType } from './types.ts'

const CHAT_TIMEOUT = 30000
const MAX_CONCURRENT = 3
const AVAILABILITY_CACHE_MS = 60000
const CONTEXT_CACHE_MAX = 50

export class ContextGenerator {
  private ollamaBaseUrl: string
  private chatModel: string
  private available = false
  private lastAvailabilityCheck = 0
  private availabilityCacheResult = false
  private contextCache = new Map<string, string>()

  constructor(ollamaBaseUrl?: string, chatModel?: string) {
    this.ollamaBaseUrl = ollamaBaseUrl || process.env.OLLAMA_BASE_URL || 'http://localhost:11434'
    this.chatModel = chatModel || process.env.OLLAMA_MODEL || 'glm-5.1:cloud'
  }

  async checkAvailability(): Promise<boolean> {
    const now = Date.now()
    if (now - this.lastAvailabilityCheck < AVAILABILITY_CACHE_MS) {
      return this.availabilityCacheResult
    }

    try {
      const res = await fetch(`${this.ollamaBaseUrl}/api/tags`, {
        signal: AbortSignal.timeout(5000),
      })
      if (!res.ok) {
        this.availabilityCacheResult = false
        this.lastAvailabilityCheck = now
        return false
      }
      const data = await res.json() as { models?: Array<{ name: string }> }
      const modelExists = (data.models ?? []).some(
        m => m.name.startsWith(this.chatModel.split(':')[0]),
      )
      this.availabilityCacheResult = modelExists
      this.lastAvailabilityCheck = now
      return modelExists
    } catch {
      this.availabilityCacheResult = false
      this.lastAvailabilityCheck = now
      return false
    }
  }

  async generateContexts(
    graph: GraphData,
    projectPath: string,
    changedFolders?: string[],
    onProgress?: (done: number, total: number) => void,
  ): Promise<{ manifest: ContextManifest; generatedCount: number; skippedCount: number }> {
    const isAvailable = await this.checkAvailability()

    const allFolders = this.getFoldersFromGraph(graph)
    const manifest = this.loadManifest(projectPath) ?? this.createEmptyManifest()

    // Remove contexts for folders no longer in the graph
    const removedFolders = Object.keys(manifest.folders).filter(f => !allFolders.includes(f))
    for (const folder of removedFolders) {
      const entry = manifest.folders[folder]
      if (entry) {
        const filePath = path.join(projectPath, '.aura', 'contexts', entry.contextFile)
        await fs.unlink(filePath).catch(() => {})
        delete manifest.folders[folder]
      }
    }

    // Determine which folders need regeneration
    let foldersToGenerate: string[]
    if (changedFolders) {
      // Merge explicitly changed folders with any that were marked stale by cascading invalidation
      const staleFromManifest = manifest.needsRegeneration?.filter(f => allFolders.includes(f)) ?? []
      const merged = new Set([...changedFolders.filter(f => allFolders.includes(f)), ...staleFromManifest])
      foldersToGenerate = Array.from(merged)
      // Clear the stale list since we're about to regenerate these
      manifest.needsRegeneration = []
    } else {
      // Full regeneration: regenerate all folders
      foldersToGenerate = allFolders
      manifest.needsRegeneration = []
    }

    if (!isAvailable || foldersToGenerate.length === 0) {
      if (!isAvailable) manifest.ollamaWasAvailable = false
      await this.saveManifest(manifest, projectPath)
      return { manifest, generatedCount: 0, skippedCount: foldersToGenerate.length }
    }

    // Pre-build folder dependency map for efficient data gathering
    const depMap = this.buildFolderDependencyMap(graph)

    let done = 0
    const total = foldersToGenerate.length
    let generatedCount = 0
    let failures = 0
    const abortThreshold = Math.floor(total * 0.5)

    const contextDir = path.join(projectPath, '.aura', 'contexts')
    await fs.mkdir(contextDir, { recursive: true })

    // Invalidate cache since we're about to write new context files
    this.invalidateCache(projectPath)

    for (let i = 0; i < foldersToGenerate.length; i += MAX_CONCURRENT) {
      const batch = foldersToGenerate.slice(i, i + MAX_CONCURRENT)
      const results = await Promise.allSettled(
        batch.map(folder => this.generateOneContext(graph, projectPath, folder, depMap)),
      )

      const regeneratedFolders: string[] = []
      for (let j = 0; j < results.length; j++) {
        const result = results[j]
        if (result.status === 'fulfilled' && result.value !== null) {
          const fileName = this.folderPathToFileName(batch[j])
          await fs.writeFile(path.join(contextDir, `${fileName}.md`), result.value, 'utf-8')

          manifest.folders[batch[j]] = {
            contextFile: `${fileName}.md`,
            generatedAt: new Date().toISOString(),
            fileHashes: this.computeFolderFileHashes(graph, batch[j]),
          }
          generatedCount++
          regeneratedFolders.push(batch[j])
        } else {
          failures++
        }
      }

      // Cascading invalidation: mark dependents of regenerated folders for next re-index
      if (regeneratedFolders.length > 0) {
        const existing = new Set(manifest.needsRegeneration ?? [])
        for (const folder of regeneratedFolders) {
          const dependents = depMap.folderImportsTo.get(folder) ?? new Set()
          for (const dep of dependents) {
            // Only add folders that exist in the graph and aren't already in this batch
            if (allFolders.includes(dep) && !batch.includes(dep)) {
              existing.add(dep)
            }
          }
        }
        manifest.needsRegeneration = Array.from(existing)
      }

      // Circuit breaker: re-check availability after each batch
      const stillAvailable = await this.checkAvailability()
      if (!stillAvailable) {
        manifest.ollamaWasAvailable = false
        // Save progress before aborting
        await this.saveManifest(manifest, projectPath)
        break
      }

      // Save manifest after each batch to preserve progress on crash
      await this.saveManifest(manifest, projectPath)

      done += batch.length
      onProgress?.(done, total)

      if (failures > abortThreshold) break
    }

    manifest.generatedAt = new Date().toISOString()
    manifest.ollamaWasAvailable = isAvailable
    await this.saveManifest(manifest, projectPath)

    return { manifest, generatedCount, skippedCount: total - generatedCount }
  }

  private async generateOneContext(
    graph: GraphData,
    projectPath: string,
    folderPath: string,
    depMap: ReturnType<typeof this.buildFolderDependencyMap>,
  ): Promise<string | null> {
    if (folderPath === '.') {
      return this.generateRootContext(graph, depMap)
    }
    const data = this.gatherFolderData(graph, folderPath, depMap)
    const messages = this.buildPrompt(data)
    const llmSummary = await this.callOllama(messages)
    if (!llmSummary) return null
    return this.formatContextMarkdown(data, llmSummary)
  }

  private async generateRootContext(
    graph: GraphData,
    depMap: ReturnType<typeof this.buildFolderDependencyMap>,
  ): Promise<string | null> {
    const projectData = this.gatherProjectData(graph, depMap)
    const messages = this.buildRootPrompt(projectData)
    const llmSummary = await this.callOllama(messages)
    if (!llmSummary) return null
    // Ensure proper header
    if (llmSummary.trimStart().startsWith('# ')) {
      return llmSummary
    }
    return `# Project Overview\n\n${llmSummary}`
  }

  // ── Data Gathering ──────────────────────────────────────────────────────────

  private getFoldersFromGraph(graph: GraphData): string[] {
    const folders = new Set<string>()
    for (const node of graph.nodes) {
      if (node.kind === AuraNodeKind.File) {
        const lastSlash = node.filePath.lastIndexOf('/')
        const folder = lastSlash >= 0 ? node.filePath.substring(0, lastSlash) : '.'
        folders.add(folder)
      }
    }
    return Array.from(folders).sort()
  }

  private buildFolderDependencyMap(graph: GraphData) {
    const folderNodes = new Map<string, AuraNode[]>()
    const folderSymbols = new Map<string, AuraNode[]>()
    const folderImportsFrom = new Map<string, Set<string>>()
    const folderImportsTo = new Map<string, Set<string>>()
    const folderDependsOn = new Map<string, Set<string>>()
    const folderDependedBy = new Map<string, Set<string>>()

    // Single pass over nodes: group files and symbols by folder
    for (const node of graph.nodes) {
      const folder = this.getFolderFromPath(node.filePath)
      if (node.kind === AuraNodeKind.File) {
        if (!folderNodes.has(folder)) folderNodes.set(folder, [])
        folderNodes.get(folder)!.push(node)
      } else {
        if (!folderSymbols.has(folder)) folderSymbols.set(folder, [])
        folderSymbols.get(folder)!.push(node)
      }
    }

    // Single pass over edges: build folder-level import/dependency adjacency
    for (const edge of graph.edges) {
      if (edge.type !== AuraEdgeType.IMPORTS && edge.type !== AuraEdgeType.DEPENDS_ON) continue

      const sourceFolder = this.getFolderFromNodeId(edge.source)
      const targetFolder = this.getFolderFromNodeId(edge.target)
      if (sourceFolder === targetFolder) continue

      if (edge.type === AuraEdgeType.IMPORTS) {
        if (!folderImportsFrom.has(sourceFolder)) folderImportsFrom.set(sourceFolder, new Set())
        folderImportsFrom.get(sourceFolder)!.add(targetFolder)

        if (!folderImportsTo.has(targetFolder)) folderImportsTo.set(targetFolder, new Set())
        folderImportsTo.get(targetFolder)!.add(sourceFolder)
      }

      if (edge.type === AuraEdgeType.DEPENDS_ON) {
        if (!folderDependsOn.has(sourceFolder)) folderDependsOn.set(sourceFolder, new Set())
        folderDependsOn.get(sourceFolder)!.add(targetFolder)

        if (!folderDependedBy.has(targetFolder)) folderDependedBy.set(targetFolder, new Set())
        folderDependedBy.get(targetFolder)!.add(sourceFolder)
      }
    }

    return { folderNodes, folderSymbols, folderImportsFrom, folderImportsTo, folderDependsOn, folderDependedBy }
  }

  private gatherFolderData(
    graph: GraphData,
    folderPath: string,
    depMap: ReturnType<typeof this.buildFolderDependencyMap>,
  ): FolderContextData {
    const files: FolderContextData['files'] = []
    const fileNodes = depMap.folderNodes.get(folderPath) ?? []
    const symbolNodes = depMap.folderSymbols.get(folderPath) ?? []

    // Build symbol-to-file map for this folder
    const symbolsByFile = new Map<string, AuraNode[]>()
    for (const sym of symbolNodes) {
      const file = sym.filePath
      if (!symbolsByFile.has(file)) symbolsByFile.set(file, [])
      symbolsByFile.get(file)!.push(sym)
    }

    for (const fileNode of fileNodes) {
      const symbols = (symbolsByFile.get(fileNode.filePath) ?? []).map(s => ({
        name: s.name,
        kind: s.kind,
        exported: s.exported,
      }))
      files.push({
        filePath: fileNode.filePath,
        name: fileNode.name,
        exported: fileNode.exported,
        kind: fileNode.kind,
        symbols,
      })
    }

    // Dependencies
    const importsFrom = Array.from(depMap.folderImportsFrom.get(folderPath) ?? []).sort()
    const importsTo = Array.from(depMap.folderImportsTo.get(folderPath) ?? []).sort()
    const dependsOn = Array.from(depMap.folderDependsOn.get(folderPath) ?? []).sort()
    const dependedBy = Array.from(depMap.folderDependedBy.get(folderPath) ?? []).sort()

    // Key types: exported Class and Interface nodes
    const keyTypes = symbolNodes
      .filter(n => (n.kind === AuraNodeKind.Class || n.kind === AuraNodeKind.Interface) && n.exported)
      .map(n => ({ name: n.name, kind: n.kind, exported: n.exported }))

    // Routes and API calls
    const routes: FolderContextData['routes'] = []
    const apiCalls: FolderContextData['apiCalls'] = []

    for (const sym of symbolNodes) {
      if (sym.kind === AuraNodeKind.Route) {
        const meta = sym.metadata as Record<string, unknown> | undefined
        routes.push({
          method: (meta?.method as string) ?? 'GET',
          path: (meta?.path as string) ?? sym.name,
          handler: sym.name,
        })
      }
      if (sym.kind === AuraNodeKind.ApiCall) {
        const meta = sym.metadata as Record<string, unknown> | undefined
        apiCalls.push({
          method: (meta?.method as string) ?? 'GET',
          url: (meta?.url as string) ?? sym.name,
          caller: sym.name,
        })
      }
    }

    // Count edges touching this folder
    let edgeCount = 0
    for (const edge of graph.edges) {
      const srcFolder = this.getFolderFromNodeId(edge.source)
      const tgtFolder = this.getFolderFromNodeId(edge.target)
      if (srcFolder === folderPath || tgtFolder === folderPath) edgeCount++
    }

    return {
      folderPath,
      files,
      importsFrom,
      importsTo,
      dependsOn,
      dependedBy,
      keyTypes,
      routes,
      apiCalls,
      symbolCount: symbolNodes.length,
      edgeCount,
    }
  }

  // ── Project-Level Data Gathering ─────────────────────────────────────────────

  private gatherProjectData(
    graph: GraphData,
    depMap: ReturnType<typeof this.buildFolderDependencyMap>,
  ): ProjectContextData {
    const allFolders = this.getFoldersFromGraph(graph)
    const folders: ProjectContextData['folders'] = []
    let totalRoutes = 0
    let totalApiCalls = 0
    const keyExportedTypes: ProjectContextData['keyExportedTypes'] = []

    // Tech stack inference from file extensions
    const extensions = new Set<string>()
    const entryPoints: ProjectContextData['entryPoints'] = []

    for (const folder of allFolders) {
      const fileNodes = depMap.folderNodes.get(folder) ?? []
      const symbolNodes = depMap.folderSymbols.get(folder) ?? []
      let exportsCount = 0

      for (const node of fileNodes) {
        const ext = node.filePath.substring(node.filePath.lastIndexOf('.') + 1)
        extensions.add(ext)
        if (node.exported) exportsCount++
      }

      for (const sym of symbolNodes) {
        if (sym.exported) exportsCount++
        if (sym.kind === AuraNodeKind.Route) totalRoutes++
        if (sym.kind === AuraNodeKind.ApiCall) totalApiCalls++
        if (
          (sym.kind === AuraNodeKind.Class || sym.kind === AuraNodeKind.Interface) &&
          sym.exported
        ) {
          keyExportedTypes.push({
            name: sym.name,
            kind: sym.kind,
            folder,
          })
        }
      }

      // Infer role from naming patterns and dependency structure
      const importsFrom = depMap.folderImportsFrom.get(folder) ?? new Set()
      const importedBy = depMap.folderImportsTo.get(folder) ?? new Set()
      let role = 'module'
      if (folder === '.') role = 'root config'
      else if (folder.includes('route') || folder.includes('controller')) role = 'API routes'
      else if (folder.includes('component') || folder.includes('page')) role = 'UI components'
      else if (folder.includes('hook')) role = 'React hooks'
      else if (folder.includes('service')) role = 'service layer'
      else if (folder.includes('util') || folder.includes('helper')) role = 'utilities'
      else if (folder.includes('test') || folder.includes('spec')) role = 'tests'
      else if (folder.includes('model') || folder.includes('schema')) role = 'data models'
      else if (folder.includes('middleware')) role = 'middleware'
      else if (importsFrom.size === 0 && importedBy.size > 0) role = 'foundation/leaf'
      else if (importedBy.size === 0 && importsFrom.size > 0) role = 'entry point'

      folders.push({
        path: folder,
        fileCount: fileNodes.length,
        symbolCount: symbolNodes.length,
        exportsCount,
        role,
      })
    }

    // Identify entry points (exported files with no imports from other project folders)
    for (const node of graph.nodes) {
      if (node.kind === AuraNodeKind.File && node.exported) {
        const folder = this.getFolderFromPath(node.filePath)
        const importsFrom = depMap.folderImportsFrom.get(folder)
        const isEntry = !importsFrom || importsFrom.size === 0
        if (isEntry && node.name !== 'vite.config.ts') {
          entryPoints.push({
            filePath: node.filePath,
            name: node.name,
            kind: node.kind,
          })
        }
      }
    }

    // Map tech stack from extensions
    const techStack: string[] = []
    if (extensions.has('ts') || extensions.has('tsx')) techStack.push('TypeScript')
    if (extensions.has('tsx') || extensions.has('jsx')) techStack.push('React/JSX')
    if (extensions.has('vue')) techStack.push('Vue')
    if (extensions.has('css') || extensions.has('scss')) techStack.push('CSS/SCSS')
    if (extensions.has('html')) techStack.push('HTML')

    // Check for common frameworks in file names
    const allFilePaths = graph.nodes
      .filter(n => n.kind === AuraNodeKind.File)
      .map(n => n.filePath)
    if (allFilePaths.some(f => f.includes('vite'))) techStack.push('Vite')
    if (allFilePaths.some(f => f.includes('express'))) techStack.push('Express')

    // Build folder dependency edges
    const folderDependencies: ProjectContextData['folderDependencies'] = []
    for (const edge of graph.edges) {
      if (edge.type !== AuraEdgeType.IMPORTS && edge.type !== AuraEdgeType.DEPENDS_ON) continue
      const sourceFolder = this.getFolderFromNodeId(edge.source)
      const targetFolder = this.getFolderFromNodeId(edge.target)
      if (sourceFolder === targetFolder) continue
      // Deduplicate
      const key = `${sourceFolder}->${targetFolder}:${edge.type}`
      if (!folderDependencies.some(d => `${d.from}->${d.to}:${d.type}` === key)) {
        folderDependencies.push({
          from: sourceFolder,
          to: targetFolder,
          type: edge.type === AuraEdgeType.IMPORTS ? 'imports' : 'depends_on',
        })
      }
    }

    return {
      folders,
      folderDependencies,
      totalFiles: graph.nodes.filter(n => n.kind === AuraNodeKind.File).length,
      totalSymbols: graph.nodes.filter(n => n.kind !== AuraNodeKind.File).length,
      totalEdges: graph.edges.length,
      totalRoutes,
      totalApiCalls,
      entryPoints,
      techStack: [...new Set(techStack)],
      keyExportedTypes: keyExportedTypes.slice(0, 30),
    }
  }

  private buildRootPrompt(data: ProjectContextData): Array<{ role: string; content: string }> {
    const foldersDesc = data.folders
      .map(f => `${f.path}: ${f.fileCount} files, ${f.symbolCount} symbols, ${f.exportsCount} exports — ${f.role}`)
      .join('\n')

    const depDesc = data.folderDependencies
      .map(d => `${d.from} -> ${d.to} (${d.type})`)
      .join('\n')

    const entryDesc = data.entryPoints.map(e => `${e.filePath} (${e.kind})`).join(', ') || 'None detected'
    const techDesc = data.techStack.join(', ') || 'Unknown'
    const keyTypesDesc = data.keyExportedTypes
      .map(t => `${t.name} (${t.kind}) in ${t.folder}`)
      .join('\n')

    return [
      {
        role: 'system',
        content: `You are a code architecture analyst. Given structured data about an entire project, produce a concise but rich markdown project overview optimized for AI agents. Follow this exact format:

# Project Overview

## Architecture
<2-3 sentences describing the overall architecture pattern, how the codebase is organized, and the primary data flow>

## Tech Stack
<List the inferred technologies. Add any you can infer from file names and patterns beyond what's explicitly listed>

## Entry Points
<List the primary entry points — files that are exported but don't import from other project folders>

## Module Map
<For each folder, one line: "- folderPath (role): N files, M symbols, K exports">

## Dependency Graph
<Describe the high-level dependency flow between folders. Which folders depend on which. Identify cycles if any>

## Key Types
<List the most important exported classes and interfaces across the project, grouped by folder>

## Stats
<Total files, symbols, edges, routes, API calls>

Rules:
- Be specific and factual. Do not hallucinate functionality not present in the data.
- Use folder and symbol names exactly as provided.
- Keep the total output under 60 lines.
- If a section would be empty, omit it entirely.`,
      },
      {
        role: 'user',
        content: `Analyze this project:

Tech stack: ${techDesc}
Total files: ${data.totalFiles}, Total symbols: ${data.totalSymbols}, Total edges: ${data.totalEdges}
Total routes: ${data.totalRoutes}, Total API calls: ${data.totalApiCalls}

Folders:
${foldersDesc}

Folder dependencies:
${depDesc || 'None detected'}

Entry points:
${entryDesc}

Key exported types (top 30):
${keyTypesDesc || 'None'}`,
      },
    ]
  }

  // ── LLM Prompt ──────────────────────────────────────────────────────────────

  private buildPrompt(data: FolderContextData): Array<{ role: string; content: string }> {
    const filesDesc = data.files.map(f => {
      const syms = f.symbols.length > 0
        ? f.symbols.map(s => `${s.name}(${s.kind}${s.exported ? ', exported' : ''})`).join(', ')
        : 'no symbols'
      return `${f.filePath}: [${syms}]`
    }).join('\n')

    const keyTypesDesc = data.keyTypes.map(t => `${t.name} (${t.kind}${t.exported ? ', exported' : ''})`).join(', ') || 'None'
    const routesDesc = data.routes.map(r => `${r.method} ${r.path} -> ${r.handler}`).join(', ') || 'None'
    const apiCallsDesc = data.apiCalls.map(a => `${a.method} ${a.url} from ${a.caller}`).join(', ') || 'None'

    return [
      {
        role: 'system',
        content: `You are a code architecture analyst. Given structured data about a source folder, produce a concise markdown summary optimized for AI agents. Follow this exact format:

# <folder path>

## Role
<One sentence: what architectural role does this folder play? Infer from its dependencies, symbol types, and naming patterns. Examples: "UI component layer", "API route handlers", "Data access and ORM models", "Shared utility functions", "Application entry point and configuration">

## Exports
<For each file in the folder, one line: "- filename (exported|internal): brief description of what it provides. Key symbols listed if significant.">

## Dependencies
- **Imports from**: <comma-separated list of other project folders this folder depends on, or "None (self-contained)">
- **Imported by**: <comma-separated list of other project folders that depend on this folder, or "None (leaf folder)">

## Key Types
<For each class/interface: "- TypeName (exported|internal): one-line description inferred from name and context">

## Routes (if any)
<For each route: "- METHOD /path -> handlerName">

## Summary
<Two to three sentences summarizing the folder's purpose, its position in the dependency graph, and any notable patterns>

Rules:
- Be specific and factual. Do not hallucinate functionality not present in the data.
- Use file and symbol names exactly as provided.
- Keep the total output under 40 lines.
- If a section would be empty, omit it entirely.`,
      },
      {
        role: 'user',
        content: `Analyze this folder:

Folder: ${data.folderPath}
Files:
${filesDesc}
Imports from (folders): ${data.importsFrom.join(', ') || 'None (self-contained)'}
Imported by (folders): ${data.importsTo.join(', ') || 'None (leaf folder)'}
Depends on: ${data.dependsOn.join(', ') || 'None'}
Depended by: ${data.dependedBy.join(', ') || 'None'}
Key types: ${keyTypesDesc}
Routes: ${routesDesc}
API calls: ${apiCallsDesc}
Total symbols: ${data.symbolCount}, Total edges: ${data.edgeCount}`,
      },
    ]
  }

  // ── Ollama Chat API ──────────────────────────────────────────────────────────

  private async callOllama(
    messages: Array<{ role: string; content: string }>,
  ): Promise<string | null> {
    try {
      const res = await fetch(`${this.ollamaBaseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.chatModel,
          messages,
          stream: false,
        }),
        signal: AbortSignal.timeout(CHAT_TIMEOUT),
      })
      if (!res.ok) {
        // Invalidate availability cache so next check is live
        this.lastAvailabilityCheck = 0
        return null
      }
      const data = await res.json() as { message?: { content?: string } }
      return data.message?.content ?? null
    } catch {
      // Invalidate availability cache so next check is live
      this.lastAvailabilityCheck = 0
      return null
    }
  }

  // ── Output Formatting ───────────────────────────────────────────────────────

  private formatContextMarkdown(data: FolderContextData, llmSummary: string): string {
    // Use the LLM output as the primary content, but ensure the folder path header is correct
    // If LLM output already starts with the folder header, use it as-is
    const expectedHeader = `# ${data.folderPath}`
    if (llmSummary.trimStart().startsWith('# ')) {
      return llmSummary
    }
    return `${expectedHeader}\n\n${llmSummary}`
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  private getFolderFromPath(filePath: string): string {
    const lastSlash = filePath.lastIndexOf('/')
    return lastSlash >= 0 ? filePath.substring(0, lastSlash) : '.'
  }

  private getFolderFromNodeId(nodeId: string): string {
    // Symbol node: "src/hooks/useChat.ts:useChat" -> "src/hooks"
    // File node: "src/hooks/useChat.ts" -> "src/hooks"
    const colonIdx = nodeId.indexOf(':')
    const filePath = colonIdx >= 0 ? nodeId.substring(0, colonIdx) : nodeId
    return this.getFolderFromPath(filePath)
  }

  private folderPathToFileName(folderPath: string): string {
    if (folderPath === '.') return 'root'
    return folderPath.replace(/\//g, '__SLASH__')
  }

  private computeFolderFileHashes(graph: GraphData, folderPath: string): Record<string, string> {
    const hashes: Record<string, string> = {}
    for (const node of graph.nodes) {
      // Include both File nodes and Symbol nodes so intra-file changes (adding/removing functions) trigger regeneration
      const nodeFolder = this.getFolderFromPath(node.filePath)
      if (nodeFolder === folderPath) {
        const key = node.kind === AuraNodeKind.File ? node.filePath : `${node.filePath}:${node.id}`
        hashes[key] = node.id
      }
    }
    return hashes
  }

  private createEmptyManifest(): ContextManifest {
    return {
      version: 1,
      generatedAt: '',
      ollamaWasAvailable: false,
      model: this.chatModel,
      folders: {},
      needsRegeneration: [],
    }
  }

  // ── Persistence ─────────────────────────────────────────────────────────────

  private async saveManifest(manifest: ContextManifest, projectPath: string): Promise<void> {
    const auraDir = path.join(projectPath, '.aura')
    await fs.mkdir(auraDir, { recursive: true })
    const manifestPath = path.join(auraDir, 'contexts.json')
    const tmpPath = manifestPath + '.tmp'
    await fs.writeFile(tmpPath, JSON.stringify(manifest, null, 2), 'utf-8')
    await fs.rename(tmpPath, manifestPath)
  }

  loadManifest(projectPath: string): ContextManifest | null {
    const manifestPath = path.join(projectPath, '.aura', 'contexts.json')
    if (!fsSync.existsSync(manifestPath)) return null
    try {
      const raw = fsSync.readFileSync(manifestPath, 'utf-8')
      const manifest = JSON.parse(raw) as ContextManifest
      // Migration: rename old underscore-encoded context files to __SLASH__ encoding
      const contextDir = path.join(projectPath, '.aura', 'contexts')
      let migrated = false
      for (const [folder, entry] of Object.entries(manifest.folders)) {
        const oldName = folder === '.' ? 'root' : folder.replace(/\//g, '_')
        const newName = this.folderPathToFileName(folder)
        if (entry.contextFile === `${oldName}.md` && oldName !== newName) {
          const oldPath = path.join(contextDir, `${oldName}.md`)
          const newPath = path.join(contextDir, `${newName}.md`)
          if (fsSync.existsSync(oldPath)) {
            fsSync.renameSync(oldPath, newPath)
          }
          entry.contextFile = `${newName}.md`
          migrated = true
        }
      }
      if (migrated) {
        fsSync.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8')
      }
      return manifest
    } catch {
      return null
    }
  }

  getContextForFolder(projectPath: string, folderPath: string): string | null {
    const cacheKey = `${projectPath}:${folderPath}`
    const cached = this.contextCache.get(cacheKey)
    if (cached !== undefined) return cached

    const manifest = this.loadManifest(projectPath)
    if (!manifest) return null
    const entry = manifest.folders[folderPath]
    if (!entry) return null
    const filePath = path.join(projectPath, '.aura', 'contexts', entry.contextFile)
    if (!fsSync.existsSync(filePath)) return null
    try {
      const content = fsSync.readFileSync(filePath, 'utf-8')
      this.setCache(cacheKey, content)
      return content
    } catch {
      return null
    }
  }

  getAllContexts(projectPath: string): Record<string, string> {
    const manifest = this.loadManifest(projectPath)
    if (!manifest) return {}
    const result: Record<string, string> = {}
    for (const [folder, entry] of Object.entries(manifest.folders)) {
      const cacheKey = `${projectPath}:${folder}`
      const cached = this.contextCache.get(cacheKey)
      if (cached !== undefined) {
        result[folder] = cached
        continue
      }
      const filePath = path.join(projectPath, '.aura', 'contexts', entry.contextFile)
      try {
        const content = fsSync.readFileSync(filePath, 'utf-8')
        this.setCache(cacheKey, content)
        result[folder] = content
      } catch {
        // skip unreadable files
      }
    }
    return result
  }

  /** Evict cache entries for a project (call after generating new contexts) */
  invalidateCache(projectPath: string): void {
    for (const key of this.contextCache.keys()) {
      if (key.startsWith(`${projectPath}:`)) {
        this.contextCache.delete(key)
      }
    }
  }

  private setCache(key: string, value: string): void {
    if (this.contextCache.size >= CONTEXT_CACHE_MAX) {
      // Evict oldest entry (Map preserves insertion order)
      const oldest = this.contextCache.keys().next().value
      if (oldest !== undefined) this.contextCache.delete(oldest)
    }
    this.contextCache.set(key, value)
  }
}