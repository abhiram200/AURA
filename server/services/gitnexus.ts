// server/services/gitnexus.ts
import { ChildProcess, spawn } from 'child_process'
import { join } from 'path'
import type { ProjectService } from './project.ts'
import type {
  IndexingStatus,
  GraphData,
  NodeContext,
  ImpactResult,
  Cluster,
  DependencyNode,
  DependencyEdge,
} from '../types/gitnexus.ts'

interface JsonRpcRequest {
  jsonrpc: '2.0'
  id: number
  method: string
  params?: Record<string, unknown>
}

interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: number
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

const CLUSTER_PALETTE = [
  '#6c63ff', '#ff6b6b', '#4ecdc4', '#ffd93d', '#f093fb',
  '#45b7d1', '#96ceb4', '#ff8a5c', '#a29bfe', '#fd79a8',
]

export class GitNexusService {
  private projectService: ProjectService
  private mcpProcess: ChildProcess | null = null
  private requestId = 0
  private pendingRequests = new Map<number, { resolve: (value: unknown) => void; reject: (reason: unknown) => void }>()
  private initialized = false
  private initializing: Promise<void> | null = null
  private indexingStatuses = new Map<string, IndexingStatus>()
  private buffer = ''

  constructor(projectService: ProjectService) {
    this.projectService = projectService
  }

  async ensureInstalled(): Promise<boolean> {
    return new Promise((resolve) => {
      const child = spawn('npx', ['gitnexus', '--version'], { shell: true, stdio: 'pipe' })
      let output = ''
      child.stdout?.on('data', (data: Buffer) => { output += data.toString() })
      child.stderr?.on('data', (data: Buffer) => { output += data.toString() })
      child.on('close', (code) => {
        resolve(code === 0)
      })
      child.on('error', () => {
        resolve(false)
      })
      setTimeout(() => {
        child.kill()
        resolve(false)
      }, 10000)
    })
  }

  async analyzeProject(projectId: string): Promise<void> {
    const project = await this.projectService.get(projectId)
    if (!project) throw new Error('Project not found')

    this.indexingStatuses.set(projectId, { status: 'indexing', phase: 'scanning', percent: 0 })

    return new Promise((resolve, reject) => {
      const child = spawn('npx', ['gitnexus', 'analyze', '--repo-path', project.workspacePath], {
        shell: true,
        stdio: 'pipe',
      })

      let stderr = ''

      child.stdout?.on('data', (data: Buffer) => {
        const text = data.toString()
        const phaseMatch = text.match(/(\w+)\s+\.{3}\s*(\d+)%/)
        if (phaseMatch) {
          this.indexingStatuses.set(projectId, {
            status: 'indexing',
            phase: phaseMatch[1].toLowerCase(),
            percent: parseInt(phaseMatch[2], 10),
          })
        }
      })

      child.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString()
      })

      child.on('close', (code) => {
        if (code === 0) {
          this.indexingStatuses.set(projectId, {
            status: 'ready',
            stats: { files: 0, nodes: 0, edges: 0, clusters: 0 },
          })
          resolve()
        } else {
          const errorMsg = stderr || `gitnexus analyze exited with code ${code}`
          this.indexingStatuses.set(projectId, { status: 'error', error: errorMsg })
          reject(new Error(errorMsg))
        }
      })

      child.on('error', (err) => {
        this.indexingStatuses.set(projectId, { status: 'error', error: err.message })
        reject(err)
      })
    })
  }

  async reindexProject(projectId: string): Promise<void> {
    return this.analyzeProject(projectId)
  }

  getIndexingStatus(projectId: string): IndexingStatus {
    return this.indexingStatuses.get(projectId) ?? { status: 'idle' }
  }

  private async ensureMcpReady(): Promise<void> {
    if (this.initialized) return
    if (this.initializing) return this.initializing

    this.initializing = this.spawnAndInitialize()
    return this.initializing
  }

  private async spawnAndInitialize(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.mcpProcess = spawn('npx', ['gitnexus', 'mcp'], {
        shell: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      })

      this.mcpProcess.stdout?.on('data', (data: Buffer) => {
        this.handleMcpData(data.toString())
      })

      this.mcpProcess.on('close', () => {
        this.initialized = false
        this.mcpProcess = null
        this.initializing = null
      })

      this.mcpProcess.on('error', (err) => {
        this.initialized = false
        this.initializing = null
        reject(err)
      })

      this.sendRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'aura', version: '0.1.0' },
      }).then(() => {
        this.initialized = true
        this.initializing = null
        resolve()
      }).catch((err) => {
        this.initialized = false
        this.initializing = null
        reject(err)
      })
    })
  }

  private handleMcpData(data: string): void {
    this.buffer += data
    const lines = this.buffer.split('\n')
    this.buffer = lines.pop() ?? ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        const response: JsonRpcResponse = JSON.parse(trimmed)
        const pending = this.pendingRequests.get(response.id)
        if (pending) {
          this.pendingRequests.delete(response.id)
          if (response.error) {
            pending.reject(new Error(response.error.message))
          } else {
            pending.resolve(response.result)
          }
        }
      } catch {
        // Not a JSON-RPC response, ignore
      }
    }
  }

  private sendRequest(method: string, params?: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.mcpProcess || !this.mcpProcess.stdin) {
        reject(new Error('MCP process not running'))
        return
      }

      const id = ++this.requestId
      const request: JsonRpcRequest = {
        jsonrpc: '2.0',
        id,
        method,
        params,
      }

      this.pendingRequests.set(id, { resolve, reject })
      this.mcpProcess.stdin.write(JSON.stringify(request) + '\n')

      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id)
          reject(new Error(`MCP request timeout: ${method}`))
        }
      }, 30000)
    })
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    await this.ensureMcpReady()
    const result = await this.sendRequest('tools/call', { name, arguments: args })
    return result
  }

  async getGraph(projectId: string): Promise<GraphData> {
    const project = await this.projectService.get(projectId)
    if (!project) throw new Error('Project not found')

    const reposResult = await this.callTool('list_repos', {}) as { repos?: { name: string; path: string }[] }
    const repos = reposResult?.repos ?? []
    const repo = repos.find((r: { name: string; path: string }) => {
      const repoPath = r.path.replace(/\\/g, '/')
      const wsPath = project.workspacePath.replace(/\\/g, '/')
      return repoPath === wsPath || repoPath.endsWith(wsPath.split('/').pop()!)
    })

    if (!repo) throw new Error('Project not indexed. Run gitnexus analyze first.')

    const repoName = repo.name

    const queryResult = await this.callTool('query', { repo: repoName, q: '*', limit: 5000 }) as { content?: { type: string; text: string }[] }
    const queryText = this.extractTextFromResult(queryResult)

    const clusterResult = await this.sendRequest('resources/read', { uri: `gitnexus://repo/${repoName}/clusters` }) as { contents?: { text: string }[] }
    const clusterText = clusterResult?.contents?.[0]?.text ?? '[]'

    const contextResult = await this.callTool('context', { repo: repoName, name: '*', kind: 'File', limit: 500 }) as { content?: { type: string; text: string }[] }
    const contextText = this.extractTextFromResult(contextResult)

    const nodes = this.parseNodesFromResults(queryText, contextText)
    const edges = this.parseEdgesFromResults(queryText, contextText)
    const clusters = this.parseClustersFromResult(clusterText, nodes)

    return { nodes, edges, clusters }
  }

  async getContext(projectId: string, file: string, name?: string): Promise<NodeContext> {
    const project = await this.projectService.get(projectId)
    if (!project) throw new Error('Project not found')

    const args: Record<string, unknown> = { repo: this.getRepoNameForProject(project.workspacePath), file_path: file }
    if (name) args.name = name

    const result = await this.callTool('context', args) as { content?: { type: string; text: string }[] }
    const text = this.extractTextFromResult(result)
    return this.parseNodeContext(text, file)
  }

  async getImpact(projectId: string, target: string): Promise<ImpactResult> {
    const result = await this.callTool('impact', { target }) as { content?: { type: string; text: string }[] }
    const text = this.extractTextFromResult(result)
    return this.parseImpactResult(text, target)
  }

  async getClusters(projectId: string): Promise<Cluster[]> {
    const project = await this.projectService.get(projectId)
    if (!project) throw new Error('Project not found')

    const repoName = this.getRepoNameForProject(project.workspacePath)
    const clusterResult = await this.sendRequest('resources/read', { uri: `gitnexus://repo/${repoName}/clusters` }) as { contents?: { text: string }[] }
    const clusterText = clusterResult?.contents?.[0]?.text ?? '[]'
    return this.parseClusterList(clusterText)
  }

  private getRepoNameForProject(workspacePath: string): string {
    return workspacePath.replace(/\\/g, '/').split('/').pop() ?? 'unknown'
  }

  private extractTextFromResult(result: { content?: { type: string; text: string }[] }): string {
    if (!result?.content) return ''
    return result.content
      .filter((c: { type: string; text: string }) => c.type === 'text')
      .map((c: { type: string; text: string }) => c.text)
      .join('\n')
  }

  private parseNodesFromResults(queryText: string, contextText: string): DependencyNode[] {
    const nodes: DependencyNode[] = []
    const seen = new Set<string>()

    const lines = contextText.split('\n')
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue

      try {
        const fileMatch = trimmed.match(/^(?:File|Module|Function|Class):\s*(.+)/)
        if (fileMatch) {
          const label = fileMatch[1].trim()
          const id = label.replace(/\\/g, '/')
          if (!seen.has(id)) {
            seen.add(id)
            nodes.push({
              id,
              label: label.split('/').pop() ?? label,
              type: trimmed.startsWith('File') ? 'file' : trimmed.startsWith('Module') ? 'module' : trimmed.startsWith('Function') ? 'function' : 'class',
              filePath: label.includes('/') || label.includes('\\') ? label : undefined,
            })
          }
        }
      } catch {
        // Skip unparseable lines
      }
    }

    if (nodes.length === 0 && queryText) {
      const queryLines = queryText.split('\n')
      for (const line of queryLines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        const pathMatch = trimmed.match(/^[\s-]*([a-zA-Z0-9_./\\]+\.[a-zA-Z0-9]+)/)
        if (pathMatch) {
          const filePath = pathMatch[1].replace(/\\/g, '/')
          if (!seen.has(filePath)) {
            seen.add(filePath)
            nodes.push({
              id: filePath,
              label: filePath.split('/').pop() ?? filePath,
              type: 'file',
              filePath,
            })
          }
        }
      }
    }

    return nodes
  }

  private parseEdgesFromResults(queryText: string, contextText: string): DependencyEdge[] {
    const edges: DependencyEdge[] = []
    const combined = queryText + '\n' + contextText

    try {
      const jsonMatch = combined.match(/\[[\s\S]*?\]/)
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0])
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            if (item.source && item.target) {
              edges.push({
                source: item.source.replace(/\\/g, '/'),
                target: item.target.replace(/\\/g, '/'),
                type: item.type || 'imports',
              })
            }
          }
        }
      }
    } catch {
      // Not JSON, continue
    }

    return edges
  }

  private parseClustersFromResult(clusterText: string, nodes: DependencyNode[]): Cluster[] {
    const clusters: Cluster[] = []
    try {
      const parsed = JSON.parse(clusterText)
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          clusters.push({
            name: item.name ?? item.id ?? 'unknown',
            color: item.color ?? CLUSTER_PALETTE[clusters.length % CLUSTER_PALETTE.length],
            members: Array.isArray(item.members) ? item.members.map((m: { id?: string; name?: string }) => (m.id ?? m.name ?? '').replace(/\\/g, '/')) : [],
          })
        }
      }
    } catch {
      if (nodes.length > 0) {
        clusters.push({
          name: 'default',
          color: CLUSTER_PALETTE[0],
          members: nodes.map((n) => n.id),
        })
      }
    }
    return clusters
  }

  private parseNodeContext(text: string, filePath: string): NodeContext {
    const context: NodeContext = {
      name: filePath.split('/').pop() ?? filePath,
      kind: 'file',
      filePath,
      cluster: null,
      imports: [],
      importedBy: [],
      calls: [],
      calledBy: [],
      processes: [],
    }

    const lines = text.split('\n')
    let currentSection = ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue

      if (/^imports?:/i.test(trimmed)) currentSection = 'imports'
      else if (/^imported\s+by:/i.test(trimmed)) currentSection = 'importedBy'
      else if (/^calls?:/i.test(trimmed)) currentSection = 'calls'
      else if (/^called\s+by:/i.test(trimmed)) currentSection = 'calledBy'
      else if (/^processes?:/i.test(trimmed)) currentSection = 'processes'
      else if (/^kind:/i.test(trimmed)) context.kind = trimmed.replace(/^kind:\s*/i, '')
      else if (/^cluster:/i.test(trimmed)) context.cluster = trimmed.replace(/^cluster:\s*/i, '')
      else if (/^\s*[-•]\s/.test(trimmed)) {
        const item = trimmed.replace(/^\s*[-•]\s*/, '')
        if (currentSection === 'imports') context.imports.push(item)
        else if (currentSection === 'importedBy') context.importedBy.push(item)
        else if (currentSection === 'calls') context.calls.push(item)
        else if (currentSection === 'calledBy') context.calledBy.push(item)
        else if (currentSection === 'processes') context.processes.push(item)
      }
    }

    return context
  }

  private parseImpactResult(text: string, target: string): ImpactResult {
    const result: ImpactResult = {
      target,
      direct: 0,
      transitive: 0,
      affectedFiles: [],
      affectedProcesses: [],
    }

    const lines = text.split('\n')
    for (const line of lines) {
      const trimmed = line.trim()
      const directMatch = trimmed.match(/direct[:\s]+(\d+)/i)
      if (directMatch) result.direct = parseInt(directMatch[1], 10)
      const transitiveMatch = trimmed.match(/transitive[:\s]+(\d+)/i)
      if (transitiveMatch) result.transitive = parseInt(transitiveMatch[1], 10)
      if (/^\s*[-•]\s/.test(trimmed)) {
        const item = trimmed.replace(/^\s*[-•]\s*/, '')
        result.affectedFiles.push(item)
      }
    }

    return result
  }

  private parseClusterList(clusterText: string): Cluster[] {
    return this.parseClustersFromResult(clusterText, [])
  }

  dispose(): void {
    if (this.mcpProcess) {
      this.mcpProcess.kill()
      this.mcpProcess = null
    }
    this.initialized = false
    this.initializing = null
    this.pendingRequests.clear()
  }
}