import path from 'path'
import fs from 'fs/promises'
import fsSync from 'fs'
import ignore from 'ignore'
import { SynapseParser } from './parser.ts'
import {
  SynapseNodeKind,
  SynapseEdgeType,
} from './types.ts'
import type {
  SynapseNode,
  SynapseEdge,
  GraphData,
  IndexingStatus,
  IndexingPhase,
  SynapseMeta,
} from './types.ts'

type StatusListener = (status: IndexingStatus) => void

export class SynapseIndexer {
  private projectPath: string
  private parser: SynapseParser
  private graph: GraphData = { nodes: [], edges: [] }
  private status: IndexingStatus = {
    phase: 'idle',
    progress: 0,
    filesProcessed: 0,
    totalFiles: 0,
    nodesFound: 0,
    edgesFound: 0,
    message: 'Idle',
  }
  private listeners: Set<StatusListener> = new Set()

  constructor(projectPath: string) {
    this.projectPath = projectPath
    this.parser = new SynapseParser()
  }

  async scan(): Promise<string[]> {
    const files: string[] = []
    // Base ignore patterns — always excluded regardless of .gitignore
    const baseIg = ignore().add('.aura').add('.synapse').add('.git')
    await this.walkDir(this.projectPath, files, baseIg)
    return files.sort()
  }

  async indexProject(): Promise<GraphData> {
    try {
      // Initialize parser if needed
      if (!this.parser.isReady()) {
        await this.parser.init()
      }

      // Phase: scanning (0 - 0.15)
      this.updateStatus('scanning', 0, 0, 0, 0, 0, 'Scanning project files...')
      const filePaths = await this.scan()

      this.graph = { nodes: [], edges: [] }

      // Phase: parsing (0.15 - 0.55)
      this.updateStatus('parsing', 0.15, 0, filePaths.length, 0, 0, 'Parsing source files...')

      for (let i = 0; i < filePaths.length; i++) {
        const filePath = filePaths[i]
        const relativePath = path.relative(this.projectPath, filePath).replace(/\\/g, '/')

        try {
          const source = await fs.readFile(filePath, 'utf-8')
          const result = await this.parser.parseFile(relativePath, source)

          // Add file node
          this.graph.nodes.push({
            id: relativePath,
            kind: SynapseNodeKind.File,
            name: path.basename(filePath),
            filePath: relativePath,
            exported: false,
          })

          // Add symbol nodes
          for (const symbol of result.symbols) {
            this.graph.nodes.push(symbol)
          }

          // Add all edges from parse result
          for (const edge of result.contains) {
            this.graph.edges.push(edge)
          }
          for (const edge of result.imports) {
            this.graph.edges.push(edge)
          }
          for (const edge of result.calls) {
            this.graph.edges.push(edge)
          }
          for (const edge of result.heritage) {
            this.graph.edges.push(edge)
          }
        } catch {
          // Skip files that fail to parse
        }

        const progress = 0.15 + (0.40 * (i + 1)) / filePaths.length
        this.updateStatus(
          'parsing',
          progress,
          i + 1,
          filePaths.length,
          this.graph.nodes.length,
          this.graph.edges.length,
          `Parsing file ${i + 1} of ${filePaths.length}...`,
        )
      }

      // Phase: resolving (0.55 - 0.7)
      this.updateStatus('resolving', 0.55, filePaths.length, filePaths.length, this.graph.nodes.length, this.graph.edges.length, 'Resolving imports and heritage...')
      this.resolveImports()
      this.resolveHeritage()

      this.updateStatus('resolving', 0.7, filePaths.length, filePaths.length, this.graph.nodes.length, this.graph.edges.length, 'Resolved imports and heritage')

      // Phase: aggregating (0.7 - 0.85)
      this.updateStatus('aggregating', 0.7, filePaths.length, filePaths.length, this.graph.nodes.length, this.graph.edges.length, 'Aggregating file-level dependencies...')
      this.aggregateFileDependencies()

      this.updateStatus('aggregating', 0.85, filePaths.length, filePaths.length, this.graph.nodes.length, this.graph.edges.length, 'Aggregated dependencies')

      // Phase: saving (0.85 - 0.95)
      this.updateStatus('saving', 0.85, filePaths.length, filePaths.length, this.graph.nodes.length, this.graph.edges.length, 'Saving graph data...')
      await this.save()

      // Phase: complete (1.0)
      this.updateStatus('complete', 1.0, filePaths.length, filePaths.length, this.graph.nodes.length, this.graph.edges.length, 'Indexing complete')

      return this.graph
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.updateStatus('error', 0, 0, 0, 0, 0, `Indexing failed: ${message}`, message)
      throw err
    }
  }

  getStatus(): IndexingStatus {
    return { ...this.status }
  }

  onStatus(listener: StatusListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  async save(): Promise<void> {
    const synapseDir = path.join(this.projectPath, '.synapse')
    await fs.mkdir(synapseDir, { recursive: true })

    const graphPath = path.join(synapseDir, 'graph.json')
    await fs.writeFile(graphPath, JSON.stringify(this.graph, null, 2), 'utf-8')

    const lastCommit = await this.getGitHead()
    const meta: SynapseMeta = {
      indexedAt: new Date().toISOString(),
      lastCommit,
      stats: {
        totalFiles: this.graph.nodes.filter(n => n.kind === SynapseNodeKind.File).length,
        totalNodes: this.graph.nodes.length,
        totalEdges: this.graph.edges.length,
        nodesByKind: this.computeNodesByKind(),
        edgesByType: this.computeEdgesByType(),
      },
    }

    const metaPath = path.join(synapseDir, 'meta.json')
    await fs.writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf-8')
  }

  // --- Private methods ---

  private async walkDir(currentPath: string, files: string[], parentIg: ReturnType<typeof ignore> | null = null, relativeDir: string = ''): Promise<void> {
    let entries: fsSync.Dirent[]
    try {
      entries = await fs.readdir(currentPath, { withFileTypes: true })
    } catch {
      return
    }

    // Build the ignore instance for this directory: inherit parent, then add local .gitignore
    let ig = parentIg
    const localIg = await this.loadGitignore(currentPath)
    if (localIg) {
      ig = ig ? ig.add(localIg) : localIg
    }

    for (const entry of entries) {
      const entryPath = path.join(currentPath, entry.name)
      const entryRelative = relativeDir ? `${relativeDir}/${entry.name}` : entry.name

      // Check hard-coded ignore list first
      if (entry.isDirectory() && this.parser.shouldIgnore(entry.name)) continue

      // Check gitignore using relative path (supports path-based patterns like src/secrets/)
      if (ig && ig.ignores(entryRelative)) continue

      if (entry.isDirectory()) {
        await this.walkDir(entryPath, files, ig, entryRelative)
      } else if (entry.isFile()) {
        if (this.parser.isParsable(entryPath)) {
          files.push(entryPath)
        }
      }
    }
  }

  private async loadGitignore(dirPath: string): Promise<ReturnType<typeof ignore> | null> {
    const gitignorePath = path.join(dirPath, '.gitignore')
    try {
      const content = await fs.readFile(gitignorePath, 'utf-8')
      return ignore().add(content)
    } catch {
      return null
    }
  }

  private resolveImports(): void {
    // Build a map of file node IDs for quick lookup
    const fileNodeMap = new Map<string, SynapseNode>()
    for (const node of this.graph.nodes) {
      if (node.kind === SynapseNodeKind.File) {
        fileNodeMap.set(node.id, node)
      }
    }

    // Resolve each IMPORTS edge
    for (const edge of this.graph.edges) {
      if (edge.type !== SynapseEdgeType.IMPORTS) continue

      const rawImportPath = edge.metadata?.rawImportPath as string | undefined
      if (!rawImportPath) continue

      // Skip non-relative imports (bare specifiers like 'react', 'express')
      if (!rawImportPath.startsWith('.')) continue

      // Resolve relative import path
      const sourceDir = path.dirname(edge.source)
      const resolvedPath = path.normalize(path.join(sourceDir, rawImportPath)).replace(/\\/g, '/')

      // Try extensions
      const extensions = ['.ts', '.tsx', '.js', '/index.ts', '/index.tsx', '/index.js']
      let matched = false

      for (const ext of extensions) {
        const candidate = resolvedPath + ext
        if (fileNodeMap.has(candidate)) {
          edge.target = candidate
          edge.confidence = 0.9
          matched = true
          break
        }
      }

      if (!matched) {
        // Check if the raw path itself matches a file node
        if (fileNodeMap.has(resolvedPath)) {
          edge.target = resolvedPath
          edge.confidence = 0.9
        } else {
          edge.confidence = 0.5
        }
      }
    }
  }

  private resolveHeritage(): void {
    // Build a name index: symbol name -> SynapseNode[]
    const nameIndex = new Map<string, SynapseNode[]>()
    for (const node of this.graph.nodes) {
      if (node.kind === SynapseNodeKind.Class || node.kind === SynapseNodeKind.Interface) {
        const existing = nameIndex.get(node.name) ?? []
        existing.push(node)
        nameIndex.set(node.name, existing)
      }
    }

    // Resolve each EXTENDS/IMPLEMENTS edge where target is not already a node ID
    const nodeIds = new Set(this.graph.nodes.map(n => n.id))

    for (const edge of this.graph.edges) {
      if (edge.type !== SynapseEdgeType.EXTENDS && edge.type !== SynapseEdgeType.IMPLEMENTS) continue

      // If target is already a node ID, skip
      if (nodeIds.has(edge.target)) continue

      // Look up the target name in the name index
      const matches = nameIndex.get(edge.target)
      if (matches && matches.length > 0) {
        edge.target = matches[0].id
      }
    }
  }

  private aggregateFileDependencies(): void {
    const dependsOnEdges: SynapseEdge[] = []

    for (const edge of this.graph.edges) {
      if (edge.type !== SynapseEdgeType.IMPORTS && edge.type !== SynapseEdgeType.CALLS) continue

      // Get source file and target file from the edge
      const sourceFile = this.getFileFromNodeId(edge.source)
      const targetFile = this.getFileFromNodeId(edge.target)

      // Only add DEPENDS_ON if source and target are different files
      if (sourceFile && targetFile && sourceFile !== targetFile) {
        // Check if this DEPENDS_ON edge already exists
        const exists = dependsOnEdges.some(
          e => e.source === sourceFile && e.target === targetFile,
        )
        if (!exists) {
          dependsOnEdges.push({
            source: sourceFile,
            target: targetFile,
            type: SynapseEdgeType.DEPENDS_ON,
            confidence: 1.0,
          })
        }
      }
    }

    this.graph.edges.push(...dependsOnEdges)
  }

  private getFileFromNodeId(nodeId: string): string | null {
    // If the nodeId is a file node (matches a file path), return it directly
    // If the nodeId is a symbol node (format: "filePath:symbolName"), extract the file path
    if (nodeId.includes(':')) {
      const colonIndex = nodeId.indexOf(':')
      const filePath = nodeId.substring(0, colonIndex)
      // Verify it's a real file node
      const fileNode = this.graph.nodes.find(n => n.id === filePath && n.kind === SynapseNodeKind.File)
      return fileNode ? filePath : null
    }

    // Check if this is a file node
    const fileNode = this.graph.nodes.find(n => n.id === nodeId && n.kind === SynapseNodeKind.File)
    return fileNode ? nodeId : null
  }

  private computeNodesByKind(): Record<string, number> {
    const counts: Record<string, number> = {}
    for (const node of this.graph.nodes) {
      counts[node.kind] = (counts[node.kind] ?? 0) + 1
    }
    return counts
  }

  private computeEdgesByType(): Record<string, number> {
    const counts: Record<string, number> = {}
    for (const edge of this.graph.edges) {
      counts[edge.type] = (counts[edge.type] ?? 0) + 1
    }
    return counts
  }

  private async getGitHead(): Promise<string | null> {
    try {
      const headPath = path.join(this.projectPath, '.git', 'HEAD')
      const content = await fs.readFile(headPath, 'utf-8')
      return content.trim()
    } catch {
      return null
    }
  }

  private updateStatus(
    phase: IndexingPhase,
    progress: number,
    filesProcessed: number,
    totalFiles: number,
    nodesFound: number,
    edgesFound: number,
    message: string,
    error?: string,
  ): void {
    this.status = {
      phase,
      progress,
      filesProcessed,
      totalFiles,
      nodesFound,
      edgesFound,
      message,
      ...(error !== undefined ? { error } : {}),
    }
    for (const listener of this.listeners) {
      listener(this.status)
    }
  }
}