import path from 'path'
import fs from 'fs/promises'
import fsSync from 'fs'
import crypto from 'crypto'
import ignore from 'ignore'
import { AuraParser } from './parser.ts'
import { AuraTsResolver } from './ts-resolver.ts'
import { AuraApiAnalyzer } from './api-analyzer.ts'
import {
  AuraNodeKind,
  AuraEdgeType,
} from './types.ts'
import type {
  AuraNode,
  AuraEdge,
  GraphData,
  IndexingStatus,
  IndexingPhase,
  AuraMeta,
  FileHashEntry,
} from './types.ts'
import { computeProgress } from './types.ts'
import { BM25SearchEngine } from './search/bm25.ts'
import { EmbeddingService } from './search/embedding.ts'
import { ContextGenerator } from './context-generator.ts'
import { ProcessTracer } from './process-tracer.ts'

type StatusListener = (status: IndexingStatus) => void

export class AuraIndexer {
  private projectPath: string
  private parser: AuraParser
  private graph: GraphData = { nodes: [], edges: [] }
  private fileHashes: Record<string, FileHashEntry> = {}
  private sourceCache: Map<string, string> = new Map()
  private bm25Engine: BM25SearchEngine | null = null
  private embeddingService: EmbeddingService | null = null
  private contextGenerator: ContextGenerator | null = null
  private processTracer: ProcessTracer | null = null
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
  private config: { ollamaBaseUrl?: string; chatModel?: string; embedModel?: string }

  constructor(projectPath: string, config?: { ollamaBaseUrl?: string; chatModel?: string; embedModel?: string }) {
    this.projectPath = projectPath
    this.parser = new AuraParser()
    this.config = config ?? {}
  }

  async scan(): Promise<string[]> {
    const files: string[] = []
    // Base ignore patterns — always excluded regardless of .gitignore
    const baseIg = ignore().add('.aura').add('.git')
    await this.walkDir(this.projectPath, files, baseIg)
    return files.sort()
  }

  async indexProject(): Promise<GraphData> {
    try {
      // Initialize parser if needed
      if (!this.parser.isReady()) {
        await this.parser.init()
      }

      // Phase: scanning
      this.updateStatus('scanning', 0, 0, 0, 0, 0, 'Scanning project files...')
      const filePaths = await this.scan()

      this.graph = { nodes: [], edges: [] }
      this.sourceCache.clear()

      // Phase: parsing
      this.updateStatus('parsing', 0, 0, filePaths.length, 0, 0, 'Parsing source files...')

      for (let i = 0; i < filePaths.length; i++) {
        const filePath = filePaths[i]
        const relativePath = path.relative(this.projectPath, filePath).replace(/\\/g, '/')

        try {
          const source = await fs.readFile(filePath, 'utf-8')
          const result = await this.parser.parseFile(relativePath, source)

          // Cache source for API analysis phase
          this.sourceCache.set(relativePath, source)

          // Add file node
          this.graph.nodes.push({
            id: relativePath,
            kind: AuraNodeKind.File,
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
          for (const edge of result.dataFlow) {
            this.graph.edges.push(edge)
          }
        } catch (err) {
          console.warn(`[AURA] Failed to parse ${filePath}:`, err instanceof Error ? err.message : err)
        }

        this.updateStatus(
          'parsing',
          (i + 1) / filePaths.length,
          i + 1,
          filePaths.length,
          this.graph.nodes.length,
          this.graph.edges.length,
          `Parsing file ${i + 1} of ${filePaths.length}...`,
        )
      }

      // Compute file content hashes for incremental indexing
      await this.computeFileHashes(filePaths)

      // Phase: resolving
      this.updateStatus('resolving', 0, filePaths.length, filePaths.length, this.graph.nodes.length, this.graph.edges.length, 'Resolving imports and heritage...')
      this.resolveImports()
      this.resolveHeritage()
      this.resolveCallTargets()

      this.updateStatus('resolving', 1, filePaths.length, filePaths.length, this.graph.nodes.length, this.graph.edges.length, 'Resolved imports and heritage')

      // Phase: type resolving
      this.updateStatus('typeResolving', 0, filePaths.length, filePaths.length, this.graph.nodes.length, this.graph.edges.length, 'Resolving types...')
      const tsResolver = new AuraTsResolver()
      const tsAvailable = await tsResolver.init(this.projectPath)
      if (tsAvailable) {
        const tsResult = tsResolver.resolve(this.graph)
        // Update existing edges (targets changed in-place)
        for (const edge of tsResult.updatedEdges) {
          const idx = this.graph.edges.findIndex(e =>
            e.source === edge.source && e.type === edge.type && e.target === edge.target
          )
          if (idx >= 0) {
            this.graph.edges[idx] = edge
          }
        }
        // Add new edges
        this.graph.edges.push(...tsResult.newEdges)
        // Update node metadata
        for (const node of tsResult.updatedNodes) {
          const idx = this.graph.nodes.findIndex(n => n.id === node.id)
          if (idx >= 0) {
            this.graph.nodes[idx] = node
          }
        }
        this.updateStatus('typeResolving', 1, filePaths.length, filePaths.length, this.graph.nodes.length, this.graph.edges.length, 'Resolved types')
      } else {
        this.updateStatus('typeResolving', 1, filePaths.length, filePaths.length, this.graph.nodes.length, this.graph.edges.length, 'TypeScript resolver not available, skipping')
      }
      tsResolver.dispose()

      // Phase: aggregating
      this.updateStatus('aggregating', 0, filePaths.length, filePaths.length, this.graph.nodes.length, this.graph.edges.length, 'Aggregating file-level dependencies...')
      this.aggregateFileDependencies()

      // Clean up: remove dangling edges (target not a valid node) and disconnected file nodes
      this.pruneDisconnectedNodes()

      this.updateStatus('aggregating', 1, filePaths.length, filePaths.length, this.graph.nodes.length, this.graph.edges.length, 'Aggregated dependencies')

      // Phase: API analysis
      this.updateStatus('apiAnalysis', 0, filePaths.length, filePaths.length, this.graph.nodes.length, this.graph.edges.length, 'Analyzing API routes and calls...')
      const apiAnalyzer = new AuraApiAnalyzer()
      const apiAvailable = await apiAnalyzer.init()
      if (apiAvailable) {
        const apiResult = apiAnalyzer.analyze(this.graph, this.projectPath, this.sourceCache)
        this.graph.nodes.push(...apiResult.routes, ...apiResult.apiCalls, ...apiResult.handlerNodes)
        this.graph.edges.push(...apiResult.edges)
        this.updateStatus('apiAnalysis', 1, filePaths.length, filePaths.length, this.graph.nodes.length, this.graph.edges.length, 'Analyzed API routes and calls')
      } else {
        this.updateStatus('apiAnalysis', 1, filePaths.length, filePaths.length, this.graph.nodes.length, this.graph.edges.length, 'API analysis not available, skipping')
      }
      apiAnalyzer.dispose()

      // Phase: process tracing
      this.updateStatus('processTracing', 0, filePaths.length, filePaths.length, this.graph.nodes.length, this.graph.edges.length, 'Tracing execution flows...')
      this.processTracer = new ProcessTracer()
      const ptAvailable = await this.processTracer.init()
      if (ptAvailable) {
        const traceResult = this.processTracer.trace(this.graph, this.sourceCache)
        this.graph.nodes.push(...traceResult.processNodes, ...traceResult.handlerNodes)
        this.graph.edges.push(...traceResult.stepEdges, ...traceResult.containsEdges)
        this.updateStatus('processTracing', 1, filePaths.length, filePaths.length, this.graph.nodes.length, this.graph.edges.length, 'Execution flows traced')
      } else {
        this.updateStatus('processTracing', 1, filePaths.length, filePaths.length, this.graph.nodes.length, this.graph.edges.length, 'Process tracing not available, skipping')
      }
      this.processTracer.dispose()

      // Phase: search indexing
      this.updateStatus('searchIndexing', 0, filePaths.length, filePaths.length, this.graph.nodes.length, this.graph.edges.length, 'Building search index...')
      this.bm25Engine = new BM25SearchEngine()
      this.bm25Engine.buildIndex(this.graph.nodes)

      this.updateStatus('searchIndexing', 0.3, filePaths.length, filePaths.length, this.graph.nodes.length, this.graph.edges.length, 'Generating embeddings and context files...')
      this.embeddingService = new EmbeddingService(this.config.ollamaBaseUrl, this.config.embedModel)
      this.contextGenerator = new ContextGenerator(this.config.ollamaBaseUrl, this.config.chatModel)

      // Run embeddings and context generation in parallel
      const [embeddingAvailable] = await Promise.all([
        this.embeddingService.generateEmbeddings(
          this.graph.nodes,
          (done, total) => {
            this.updateStatus('searchIndexing', 0.3 + 0.5 * done / total, filePaths.length, filePaths.length, this.graph.nodes.length, this.graph.edges.length, `Generating embeddings ${done}/${total}...`)
          },
        ),
        this.generateContextsInternal(filePaths.length),
      ])

      if (!embeddingAvailable) {
        this.updateStatus('searchIndexing', 0.8, filePaths.length, filePaths.length, this.graph.nodes.length, this.graph.edges.length, 'Ollama unavailable, skipping embeddings')
      } else {
        this.updateStatus('searchIndexing', 1, filePaths.length, filePaths.length, this.graph.nodes.length, this.graph.edges.length, 'Search index and context files built')
      }

      // Phase: saving
      this.updateStatus('saving', 0, filePaths.length, filePaths.length, this.graph.nodes.length, this.graph.edges.length, 'Saving graph data...')
      await this.save()

      // Phase: complete
      this.updateStatus('complete', 1, filePaths.length, filePaths.length, this.graph.nodes.length, this.graph.edges.length, 'Indexing complete')

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

  getSearchEngines(): { bm25: BM25SearchEngine | null; embedding: EmbeddingService | null } {
    return { bm25: this.bm25Engine, embedding: this.embeddingService }
  }

  getContextGenerator(): ContextGenerator | null {
    return this.contextGenerator
  }

  getProcessTracer(): ProcessTracer | null {
    return this.processTracer
  }

  setWatching(): void {
    this.updateStatus(
      'watching',
      0,
      this.status.totalFiles,
      this.status.totalFiles,
      this.graph.nodes.length,
      this.graph.edges.length,
      'Watching for changes...',
    )
  }

  onStatus(listener: StatusListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private async generateContextsInternal(totalFiles: number): Promise<void> {
    const available = await this.contextGenerator!.checkAvailability()
    if (!available) {
      this.contextGenerator = null
      return
    }

    await this.contextGenerator!.generateContexts(
      this.graph,
      this.projectPath,
      undefined, // full regeneration on initial index
      (done, total) => {
        const subProgress = 0.8 + 0.2 * done / total
        this.updateStatus('searchIndexing', subProgress, totalFiles, totalFiles, this.graph.nodes.length, this.graph.edges.length, `Generating context files ${done}/${total}...`)
      },
    )
  }

  async save(): Promise<void> {
    const auraDir = path.join(this.projectPath, '.aura')
    await fs.mkdir(auraDir, { recursive: true })

    const graphPath = path.join(auraDir, 'graph.json')
    await fs.writeFile(graphPath, JSON.stringify(this.graph, null, 2), 'utf-8')

    const lastCommit = await this.getGitHead()
    const meta: AuraMeta = {
      indexedAt: new Date().toISOString(),
      lastCommit,
      fileHashes: this.fileHashes,
      stats: {
        totalFiles: this.graph.nodes.filter(n => n.kind === AuraNodeKind.File).length,
        totalNodes: this.graph.nodes.length,
        totalEdges: this.graph.edges.length,
        nodesByKind: this.computeNodesByKind(),
        edgesByType: this.computeEdgesByType(),
      },
    }

    const metaPath = path.join(auraDir, 'meta.json')
    await fs.writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf-8')

    // Save search index data
    if (this.bm25Engine) {
      const searchIndexPath = path.join(auraDir, 'search-index.json')
      await fs.writeFile(searchIndexPath, JSON.stringify(this.bm25Engine.toJSON()), 'utf-8')
    }
    if (this.embeddingService) {
      const embeddingsPath = path.join(auraDir, 'embeddings.json')
      await fs.writeFile(embeddingsPath, JSON.stringify(this.embeddingService.toJSON()), 'utf-8')
    }
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
    const fileNodeMap = new Map<string, AuraNode>()
    for (const node of this.graph.nodes) {
      if (node.kind === AuraNodeKind.File) {
        fileNodeMap.set(node.id, node)
      }
    }

    // Resolve each IMPORTS edge
    for (const edge of this.graph.edges) {
      if (edge.type !== AuraEdgeType.IMPORTS) continue

      const rawImportPath = edge.metadata?.rawImportPath as string | undefined
      if (!rawImportPath) continue

      // Check if this is a Python import (dotted module paths like "utils.helper")
      // A relative JS/TS import like "../styles" or "./utils" contains dots from ".." but
      // is NOT a Python import. Only treat as Python if the source file is .py, or if the
      // import path has no slashes and contains dots (Python absolute import like "os.path").
      const sourceExt = path.extname(edge.source)
      const isPythonImport = sourceExt === '.py' || (!rawImportPath.startsWith('.') && !rawImportPath.includes('/') && rawImportPath.includes('.'))

      if (isPythonImport) {
        // Python import resolution
        // Convert dotted module path to file path: "utils.helper" → "utils/helper"
        // Handle relative imports: ".module" → relative to current directory
        let modulePath: string
        if (rawImportPath.startsWith('.')) {
          // Relative import: .module, ..module, .module.submodule
          const sourceDir = path.dirname(edge.source)
          const dotCount = rawImportPath.match(/^\.+/)?.[0]?.length ?? 1
          const rest = rawImportPath.slice(dotCount).replace(/\./g, '/')
          // Go up dotCount-1 directories for each leading dot
          let dir = sourceDir
          for (let i = 1; i < dotCount; i++) {
            dir = path.dirname(dir)
          }
          modulePath = rest ? path.normalize(path.join(dir, rest)).replace(/\\/g, '/') : dir
        } else {
          // Absolute import: convert dots to slashes
          modulePath = rawImportPath.replace(/\./g, '/')
        }

        // Try Python file resolution
        const pyExtensions = ['.py', '/__init__.py']
        let matched = false

        // Skip self-imports (a file importing from its own module)
        const sourceBase = edge.source.replace(/\.py$/, '')
        if (modulePath === sourceBase || modulePath === path.basename(sourceBase)) {
          // Remove the edge entirely — self-imports are redundant
          edge.confidence = 0
          continue
        }

        for (const ext of pyExtensions) {
          const candidate = modulePath + ext
          if (fileNodeMap.has(candidate)) {
            edge.target = candidate
            edge.confidence = 0.9
            matched = true
            break
          }
        }

        if (!matched && fileNodeMap.has(modulePath)) {
          edge.target = modulePath
          edge.confidence = 0.9
        } else if (!matched) {
          edge.confidence = 0.5
        }
      } else {
        // JS/TS import resolution (existing logic)
        // Skip non-relative imports (bare specifiers like 'react', 'express')
        if (!rawImportPath.startsWith('.')) continue

        // Resolve relative import path
        const sourceDir = path.dirname(edge.source)
        const resolvedPath = path.normalize(path.join(sourceDir, rawImportPath)).replace(/\\/g, '/')

        // Try extensions
        const extensions = ['.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx', '/index.js', '/index.jsx']
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

      // Symbol-level import resolution for Python imports with importedSymbols
      // e.g., "from db import User, Project" should also create edges to db.py:User, db.py:Project
      if (isPythonImport && edge.confidence >= 0.9 && edge.metadata?.importedSymbols) {
        const importedSymbols = edge.metadata.importedSymbols as Array<{ localName: string; exportedName: string }>
        const targetFile = edge.target
        for (const sym of importedSymbols) {
          // Look up the symbol by name in the target file
          const symbolId = `${targetFile}:${sym.exportedName}`
          const existingSymbol = this.graph.nodes.find(n => n.id === symbolId)
          if (existingSymbol) {
            // Create a symbol-level import edge
            this.graph.edges.push({
              source: edge.source,
              target: existingSymbol.id,
              type: AuraEdgeType.IMPORTS,
              confidence: 0.85,
              metadata: {
                rawImportPath: `${rawImportPath}.${sym.exportedName}`,
                importedSymbol: sym.localName,
              },
            })
          }
        }
      }
    }
  }

  private resolveHeritage(): void {
    // Build a name index: symbol name -> AuraNode[]
    const nameIndex = new Map<string, AuraNode[]>()
    for (const node of this.graph.nodes) {
      if (node.kind === AuraNodeKind.Class || node.kind === AuraNodeKind.Interface) {
        const existing = nameIndex.get(node.name) ?? []
        existing.push(node)
        nameIndex.set(node.name, existing)
      }
    }

    // Resolve each EXTENDS/IMPLEMENTS edge where target is not already a node ID
    const nodeIds = new Set(this.graph.nodes.map(n => n.id))

    for (const edge of this.graph.edges) {
      if (edge.type !== AuraEdgeType.EXTENDS && edge.type !== AuraEdgeType.IMPLEMENTS) continue

      // If target is already a node ID, skip
      if (nodeIds.has(edge.target)) continue

      // Look up the target name in the name index
      const matches = nameIndex.get(edge.target)
      if (matches && matches.length > 0) {
        edge.target = matches[0].id
      }
    }
  }

  private resolveCallTargets(): void {
    // Step 1: Build local symbol table per file
    // Map: filePath -> Map(symbolName -> nodeId[])
    const localSymbols = new Map<string, Map<string, string[]>>()
    for (const node of this.graph.nodes) {
      if (node.kind === AuraNodeKind.File) continue
      if (!node.id.includes(':')) continue
      const colonIdx = node.id.indexOf(':')
      const filePath = node.id.substring(0, colonIdx)
      if (!localSymbols.has(filePath)) {
        localSymbols.set(filePath, new Map())
      }
      const fileSymbols = localSymbols.get(filePath)!
      const existing = fileSymbols.get(node.name) ?? []
      existing.push(node.id)
      fileSymbols.set(node.name, existing)
    }

    // Step 2: Build import symbol table per file
    // Map: filePath -> Map(localName -> { sourceFile, exportedName })
    const importTable = new Map<string, Map<string, { sourceFile: string; exportedName: string }>>()
    for (const edge of this.graph.edges) {
      if (edge.type !== AuraEdgeType.IMPORTS) continue
      const importedSymbols = edge.metadata?.importedSymbols as Array<{ localName: string; exportedName: string }> | undefined
      if (!importedSymbols || importedSymbols.length === 0) continue

      const sourceFile = edge.source // The importing file
      const targetFile = edge.target  // The imported file (already resolved by resolveImports)

      if (!importTable.has(sourceFile)) {
        importTable.set(sourceFile, new Map())
      }
      const fileImports = importTable.get(sourceFile)!
      for (const sym of importedSymbols) {
        fileImports.set(sym.localName, { sourceFile: targetFile, exportedName: sym.exportedName })
      }
    }

    // Step 3: Build global name index for fallback (all symbol kinds)
    const globalNameIndex = new Map<string, AuraNode[]>()
    for (const node of this.graph.nodes) {
      if (node.kind === AuraNodeKind.File) continue
      const existing = globalNameIndex.get(node.name) ?? []
      existing.push(node)
      globalNameIndex.set(node.name, existing)
    }

    // Step 4: Resolve CALLS edges
    const nodeIds = new Set(this.graph.nodes.map(n => n.id))
    const newSymbolEdges: AuraEdge[] = []

    for (const edge of this.graph.edges) {
      if (edge.type !== AuraEdgeType.CALLS) continue
      // Skip already-resolved targets (node IDs contain ':')
      if (nodeIds.has(edge.target)) continue

      const callTarget = edge.target
      const callTargetKind = edge.metadata?.callTargetKind as string | undefined
      const methodName = edge.metadata?.methodName as string | undefined

      // Determine the source file
      const colonIdx = edge.source.indexOf(':')
      const sourceFile = colonIdx >= 0 ? edge.source.substring(0, colonIdx) : edge.source

      let resolved = false

      if (callTargetKind === 'member' && methodName) {
        // Member expression: try to resolve the method name
        resolved = this.resolveMemberCall(edge, methodName, sourceFile, localSymbols, importTable, globalNameIndex)
      } else {
        // Direct call: try import table first, then local symbols, then global
        resolved = this.resolveDirectCall(edge, callTarget, sourceFile, localSymbols, importTable, globalNameIndex, newSymbolEdges)
      }

      if (!resolved) {
        // Lower confidence for unresolved calls
        edge.confidence = 0.3
      }
    }

    // Step 5: Add new symbol-level IMPORTS edges
    this.graph.edges.push(...newSymbolEdges)
  }

  private resolveDirectCall(
    edge: AuraEdge,
    callTarget: string,
    sourceFile: string,
    localSymbols: Map<string, Map<string, string[]>>,
    importTable: Map<string, Map<string, { sourceFile: string; exportedName: string }>>,
    globalNameIndex: Map<string, AuraNode[]>,
    newSymbolEdges: AuraEdge[],
  ): boolean {
    // Strategy 1: Same-file local symbol
    const fileSymbols = localSymbols.get(sourceFile)
    if (fileSymbols?.has(callTarget)) {
      const candidates = fileSymbols.get(callTarget)!
      if (candidates.length > 0) {
        edge.target = candidates[0]
        edge.confidence = 0.95
        return true
      }
    }

    // Strategy 2: Import-scoped resolution
    const fileImports = importTable.get(sourceFile)
    if (fileImports?.has(callTarget)) {
      const { sourceFile: importedFrom, exportedName } = fileImports.get(callTarget)!
      const importedSymbols = localSymbols.get(importedFrom)
      if (importedSymbols?.has(exportedName)) {
        const candidates = importedSymbols.get(exportedName)!
        if (candidates.length > 0) {
          edge.target = candidates[0]
          edge.confidence = 0.9

          // Create a symbol-level IMPORTS edge
          newSymbolEdges.push({
            source: edge.source,
            target: candidates[0],
            type: AuraEdgeType.IMPORTS,
            confidence: 0.9,
            metadata: { resolvedFrom: 'call_target', importedName: callTarget },
          })
          return true
        }
      }
      // Imported name found but symbol not yet in local table — try exported name as local name
      if (importedSymbols?.has(callTarget)) {
        const candidates = importedSymbols.get(callTarget)!
        if (candidates.length > 0) {
          edge.target = candidates[0]
          edge.confidence = 0.85

          newSymbolEdges.push({
            source: edge.source,
            target: candidates[0],
            type: AuraEdgeType.IMPORTS,
            confidence: 0.85,
            metadata: { resolvedFrom: 'call_target_fallback', importedName: callTarget },
          })
          return true
        }
      }
    }

    // Strategy 3: Global fallback
    const matches = globalNameIndex.get(callTarget)
    if (matches && matches.length > 0) {
      // Prefer matches in the same file
      const sameFileMatch = matches.find(n => n.filePath === sourceFile)
      if (sameFileMatch) {
        edge.target = sameFileMatch.id
        edge.confidence = 0.7
        return true
      }
      edge.target = matches[0].id
      edge.confidence = 0.5
      return true
    }

    return false
  }

  private resolveMemberCall(
    edge: AuraEdge,
    methodName: string,
    sourceFile: string,
    localSymbols: Map<string, Map<string, string[]>>,
    importTable: Map<string, Map<string, { sourceFile: string; exportedName: string }>>,
    globalNameIndex: Map<string, AuraNode[]>,
  ): boolean {
    const callName = edge.metadata?.callName as string | undefined

    // For this.method() calls: look up the method in the same file's class
    if (callName?.startsWith('this.')) {
      const fileSymbols = localSymbols.get(sourceFile)
      if (fileSymbols?.has(methodName)) {
        const candidates = fileSymbols.get(methodName)!
        if (candidates.length > 0) {
          edge.target = candidates[0]
          edge.confidence = 0.85
          return true
        }
      }
    }

    // For obj.method() calls: try to resolve the object through the import table
    // e.g., user_service.list_users() → user_service is imported from user_service.py,
    // so look for list_users in that imported file
    if (callName?.includes('.')) {
      const objectName = callName.substring(0, callName.indexOf('.'))
      const fileImports = importTable.get(sourceFile)

      // Try exact import name match first
      let resolvedByImport = false
      if (fileImports?.has(objectName)) {
        const { sourceFile: importedFrom, exportedName } = fileImports.get(objectName)!
        const importedFileSymbols = localSymbols.get(importedFrom)
        if (importedFileSymbols?.has(methodName)) {
          const candidates = importedFileSymbols.get(methodName)!
          if (candidates.length > 0) {
            edge.target = candidates[0]
            edge.confidence = 0.9
            return true
          }
        }
        // The imported name might be a class, check for methods in the same file
        if (importedFileSymbols?.has(exportedName)) {
          if (importedFileSymbols.has(methodName)) {
            const candidates = importedFileSymbols.get(methodName)!
            if (candidates.length > 0) {
              edge.target = candidates[0]
              edge.confidence = 0.85
              return true
            }
          }
        }
      }

      // Try inferred import: user_service → UserService (snake_case to CamelCase)
      // This handles patterns like: from module import UserService; user_service = UserService()
      if (!resolvedByImport && fileImports) {
        const camelName = objectName.split('_').map(part => part.charAt(0).toUpperCase() + part.slice(1)).join('')
        if (fileImports.has(camelName)) {
          const { sourceFile: importedFrom } = fileImports.get(camelName)!
          const importedFileSymbols = localSymbols.get(importedFrom)
          if (importedFileSymbols?.has(methodName)) {
            const candidates = importedFileSymbols.get(methodName)!
            if (candidates.length > 0) {
              edge.target = candidates[0]
              edge.confidence = 0.85
              return true
            }
          }
        }
      }

      // Try file-name heuristic: user_service.py likely contains user_service's methods
      // Look for any imported file whose basename matches the object name
      if (!resolvedByImport && fileImports) {
        for (const [localName, { sourceFile: importedFrom }] of fileImports) {
          const importBase = importedFrom.split('/').pop()!.replace(/\.\w+$/, '')
          if (importBase === objectName) {
            const importedFileSymbols = localSymbols.get(importedFrom)
            if (importedFileSymbols?.has(methodName)) {
              const candidates = importedFileSymbols.get(methodName)!
              if (candidates.length > 0) {
                edge.target = candidates[0]
                edge.confidence = 0.8
                return true
              }
            }
          }
        }
      }
    }

    // Try global method lookup (Method-kind only for member expressions)
    const matches = globalNameIndex.get(methodName)
    if (matches) {
      const methodMatches = matches.filter(n => n.kind === AuraNodeKind.Method || n.kind === AuraNodeKind.Function)
      if (methodMatches.length > 0) {
        const sameFileMatch = methodMatches.find(n => n.filePath === sourceFile)
        if (sameFileMatch) {
          edge.target = sameFileMatch.id
          edge.confidence = 0.7
          return true
        }
        edge.target = methodMatches[0].id
        edge.confidence = 0.4
        return true
      }
    }

    return false
  }

  private aggregateFileDependencies(): void {
    const dependsOnEdges: AuraEdge[] = []
    const seenFileDeps = new Set<string>()
    const seenSymbolDeps = new Set<string>()

    for (const edge of this.graph.edges) {
      if (edge.type !== AuraEdgeType.IMPORTS && edge.type !== AuraEdgeType.CALLS) continue

      // File-level DEPENDS_ON
      const sourceFile = this.getFileFromNodeId(edge.source)
      const targetFile = this.getFileFromNodeId(edge.target)

      if (sourceFile && targetFile && sourceFile !== targetFile) {
        const fileDepKey = `${sourceFile}|${targetFile}`
        if (!seenFileDeps.has(fileDepKey)) {
          seenFileDeps.add(fileDepKey)
          dependsOnEdges.push({
            source: sourceFile,
            target: targetFile,
            type: AuraEdgeType.DEPENDS_ON,
            confidence: 1.0,
          })
        }
      }

      // Symbol-level DEPENDS_ON (only if both are symbol IDs in different files)
      if (edge.source.includes(':') && edge.target.includes(':')) {
        const sourceSymFile = edge.source.substring(0, edge.source.indexOf(':'))
        const targetSymFile = edge.target.substring(0, edge.target.indexOf(':'))
        if (sourceSymFile !== targetSymFile) {
          const symbolDepKey = `${edge.source}|${edge.target}`
          if (!seenSymbolDeps.has(symbolDepKey)) {
            seenSymbolDeps.add(symbolDepKey)
            dependsOnEdges.push({
              source: edge.source,
              target: edge.target,
              type: AuraEdgeType.DEPENDS_ON,
              confidence: 0.9,
            })
          }
        }
      }
    }

    this.graph.edges.push(...dependsOnEdges)
  }

  private pruneDisconnectedNodes(): void {
    // Remove file nodes that have no edges at all AND no symbol children.
    // Files that export types/interfaces may have no import edges yet, but
    // they have CONTAINS edges to their symbols — those should be kept.
    // Only prune truly empty files (e.g., postcss.config.cjs with no exports we track).
    const connectedNodes = new Set<string>()
    for (const edge of this.graph.edges) {
      connectedNodes.add(edge.source)
      connectedNodes.add(edge.target)
    }

    this.graph.nodes = this.graph.nodes.filter(node => {
      if (node.kind !== AuraNodeKind.File) return true
      if (connectedNodes.has(node.id)) return true
      return false
    })
  }

  private getFileFromNodeId(nodeId: string): string | null {
    // If the nodeId is a file node (matches a file path), return it directly
    // If the nodeId is a symbol node (format: "filePath:symbolName"), extract the file path
    if (nodeId.includes(':')) {
      const colonIndex = nodeId.indexOf(':')
      const filePath = nodeId.substring(0, colonIndex)
      // Verify it's a real file node
      const fileNode = this.graph.nodes.find(n => n.id === filePath && n.kind === AuraNodeKind.File)
      return fileNode ? filePath : null
    }

    // Check if this is a file node
    const fileNode = this.graph.nodes.find(n => n.id === nodeId && n.kind === AuraNodeKind.File)
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

  private getChangedFolders(changedFiles: string[]): string[] {
    const folders = new Set<string>()
    for (const file of changedFiles) {
      const lastSlash = file.lastIndexOf('/')
      folders.add(lastSlash >= 0 ? file.substring(0, lastSlash) : '.')
    }
    return Array.from(folders)
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
    subProgress: number,
    filesProcessed: number,
    totalFiles: number,
    nodesFound: number,
    edgesFound: number,
    message: string,
    error?: string,
  ): void {
    this.status = {
      phase,
      progress: computeProgress(phase, subProgress),
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

  private async computeFileHashes(filePaths: string[]): Promise<void> {
    this.fileHashes = {}
    for (const filePath of filePaths) {
      try {
        const stat = await fs.stat(filePath)
        const content = await fs.readFile(filePath, 'utf-8')
        const hash = crypto.createHash('sha256').update(content).digest('hex')
        const relativePath = path.relative(this.projectPath, filePath).replace(/\\/g, '/')
        this.fileHashes[relativePath] = { hash, mtime: stat.mtimeMs }
      } catch {
        // Skip files that can't be read
      }
    }
  }

  // ── Incremental Indexing ─────────────────────────────────────────────────────

  async incrementalIndex(changedFiles?: string[]): Promise<GraphData> {
    // Normalize changed files to relative paths (handle both absolute and already-relative)
    if (changedFiles) {
      changedFiles = changedFiles.map(f => {
        // If already relative (doesn't start with / or drive letter), normalize separators only
        if (!path.isAbsolute(f)) {
          return f.replace(/\\/g, '/')
        }
        return path.relative(this.projectPath, f).replace(/\\/g, '/')
      })
    }

    // If no changed files provided, detect them by comparing hashes
    if (!changedFiles) {
      const filePaths = await this.scan()
      const newHashes: Record<string, FileHashEntry> = {}

      for (const filePath of filePaths) {
        try {
          const stat = await fs.stat(filePath)
          const relativePath = path.relative(this.projectPath, filePath).replace(/\\/g, '/')
          // mtime fast-path: if mtime matches, skip hash computation
          const oldEntry = this.fileHashes[relativePath]
          if (oldEntry && Math.abs(stat.mtimeMs - oldEntry.mtime) < 1) {
            newHashes[relativePath] = oldEntry
            continue
          }
          const content = await fs.readFile(filePath, 'utf-8')
          const hash = crypto.createHash('sha256').update(content).digest('hex')
          if (!oldEntry || oldEntry.hash !== hash) {
            changedFiles = changedFiles ?? []
            changedFiles.push(relativePath)
          }
          newHashes[relativePath] = { hash, mtime: stat.mtimeMs }
        } catch {
          // Skip unreadable files
        }
      }

      this.fileHashes = newHashes

      if (!changedFiles || changedFiles.length === 0) {
        return this.graph
      }
    }

    this.updateStatus('parsing', 0, 0, changedFiles.length, this.graph.nodes.length, this.graph.edges.length, 'Incremental: detecting changes...')

    // Build reverse-import map: for each file, which files import it
    const reverseImports = new Map<string, Set<string>>()
    for (const edge of this.graph.edges) {
      if (edge.type === AuraEdgeType.IMPORTS || edge.type === AuraEdgeType.DEPENDS_ON) {
        const sourceFile = edge.source.includes(':') ? edge.source.substring(0, edge.source.indexOf(':')) : edge.source
        const targetFile = edge.target.includes(':') ? edge.target.substring(0, edge.target.indexOf(':')) : edge.target
        if (sourceFile && targetFile && sourceFile !== targetFile) {
          let importers = reverseImports.get(targetFile)
          if (!importers) {
            importers = new Set()
            reverseImports.set(targetFile, importers)
          }
          importers.add(sourceFile)
        }
      }
    }

    // Expand changed files to include their importers
    const reparseSet = new Set<string>(changedFiles)
    for (const file of changedFiles) {
      const importers = reverseImports.get(file)
      if (importers) {
        for (const importer of importers) {
          reparseSet.add(importer)
        }
      }
    }

    const reparseList = Array.from(reparseSet)

    // Remove nodes and edges for files being re-parsed
    this.graph.nodes = this.graph.nodes.filter(n => {
      const nodeFile = n.id.includes(':') ? n.id.substring(0, n.id.indexOf(':')) : n.id
      return !reparseSet.has(nodeFile)
    })
    this.graph.edges = this.graph.edges.filter(e => {
      const sourceFile = e.source.includes(':') ? e.source.substring(0, e.source.indexOf(':')) : e.source
      const targetFile = e.target.includes(':') ? e.target.substring(0, e.target.indexOf(':')) : e.target
      return !reparseSet.has(sourceFile) && !reparseSet.has(targetFile)
    })

    // Initialize parser if needed
    if (!this.parser.isReady()) {
      await this.parser.init()
    }

    // Re-parse changed files
    this.updateStatus('parsing', 0, 0, reparseList.length, this.graph.nodes.length, this.graph.edges.length, 'Incremental: re-parsing changed files...')

    for (let i = 0; i < reparseList.length; i++) {
      const relativePath = reparseList[i]
      const absolutePath = path.join(this.projectPath, relativePath)

      try {
        const source = await fs.readFile(absolutePath, 'utf-8')
        const result = await this.parser.parseFile(relativePath, source)

        // Add file node
        this.graph.nodes.push({
          id: relativePath,
          kind: AuraNodeKind.File,
          name: path.basename(absolutePath),
          filePath: relativePath,
          exported: false,
        })

        // Add symbol nodes
        for (const symbol of result.symbols) {
          this.graph.nodes.push(symbol)
        }

        // Add all edges
        for (const edge of result.contains) this.graph.edges.push(edge)
        for (const edge of result.imports) this.graph.edges.push(edge)
        for (const edge of result.calls) this.graph.edges.push(edge)
        for (const edge of result.heritage) this.graph.edges.push(edge)
        for (const edge of result.dataFlow) this.graph.edges.push(edge)
      } catch {
        // Skip files that fail to parse
      }

      this.updateStatus('parsing', (i + 1) / reparseList.length, i + 1, reparseList.length, this.graph.nodes.length, this.graph.edges.length, `Incremental: re-parsing ${i + 1} of ${reparseList.length}...`)
    }

    // Re-run resolution passes
    this.updateStatus('resolving', 0, reparseList.length, reparseList.length, this.graph.nodes.length, this.graph.edges.length, 'Incremental: resolving imports...')
    this.resolveImports()
    this.resolveHeritage()
    this.resolveCallTargets()

    this.updateStatus('resolving', 1, reparseList.length, reparseList.length, this.graph.nodes.length, this.graph.edges.length, 'Incremental: resolved imports and heritage')

    // Type resolving
    this.updateStatus('typeResolving', 0, reparseList.length, reparseList.length, this.graph.nodes.length, this.graph.edges.length, 'Incremental: resolving types...')
    const tsResolver = new AuraTsResolver()
    const tsAvailable = await tsResolver.init(this.projectPath)
    if (tsAvailable) {
      const tsResult = tsResolver.resolve(this.graph)
      for (const edge of tsResult.updatedEdges) {
        const idx = this.graph.edges.findIndex(e =>
          e.source === edge.source && e.type === edge.type && e.target === edge.target
        )
        if (idx >= 0) this.graph.edges[idx] = edge
      }
      this.graph.edges.push(...tsResult.newEdges)
      for (const node of tsResult.updatedNodes) {
        const idx = this.graph.nodes.findIndex(n => n.id === node.id)
        if (idx >= 0) this.graph.nodes[idx] = node
      }
      this.updateStatus('typeResolving', 1, reparseList.length, reparseList.length, this.graph.nodes.length, this.graph.edges.length, 'Incremental: resolved types')
    } else {
      this.updateStatus('typeResolving', 1, reparseList.length, reparseList.length, this.graph.nodes.length, this.graph.edges.length, 'TypeScript resolver not available, skipping')
    }
    tsResolver.dispose()

    // Re-aggregate file dependencies
    this.updateStatus('aggregating', 0, reparseList.length, reparseList.length, this.graph.nodes.length, this.graph.edges.length, 'Incremental: aggregating dependencies...')
    this.aggregateFileDependencies()
    this.pruneDisconnectedNodes()

    // Re-run API analysis on updated graph
    this.updateStatus('apiAnalysis', 0, reparseList.length, reparseList.length, this.graph.nodes.length, this.graph.edges.length, 'Incremental: analyzing API routes and calls...')
    // Remove existing Route and ApiCall nodes before re-analyzing
    this.graph.nodes = this.graph.nodes.filter(n => n.kind !== AuraNodeKind.Route && n.kind !== AuraNodeKind.ApiCall)
    this.graph.edges = this.graph.edges.filter(e => e.type !== AuraEdgeType.HANDLES && e.type !== AuraEdgeType.FETCHES && e.type !== AuraEdgeType.MIDDLEWARE)
    // Rebuild source cache for changed files
    for (const relativePath of reparseList) {
      const absolutePath = path.join(this.projectPath, relativePath)
      try {
        const content = await fs.readFile(absolutePath, 'utf-8')
        this.sourceCache.set(relativePath, content)
      } catch {
        this.sourceCache.delete(relativePath)
      }
    }
    const incApiAnalyzer = new AuraApiAnalyzer()
    const incApiAvailable = await incApiAnalyzer.init()
    if (incApiAvailable) {
      const incApiResult = incApiAnalyzer.analyze(this.graph, this.projectPath, this.sourceCache)
      this.graph.nodes.push(...incApiResult.routes, ...incApiResult.apiCalls)
      this.graph.edges.push(...incApiResult.edges)
    }
    incApiAnalyzer.dispose()

    // Re-run process tracing
    this.updateStatus('processTracing', 0, reparseList.length, reparseList.length, this.graph.nodes.length, this.graph.edges.length, 'Incremental: tracing execution flows...')
    this.graph.nodes = this.graph.nodes.filter(n => n.kind !== AuraNodeKind.Process)
    this.graph.edges = this.graph.edges.filter(e => e.type !== AuraEdgeType.STEP_IN_PROCESS)
    const incProcessTracer = new ProcessTracer()
    const incPtAvailable = await incProcessTracer.init()
    if (incPtAvailable) {
      const incTraceResult = incProcessTracer.trace(this.graph, this.sourceCache)
      this.graph.nodes.push(...incTraceResult.processNodes, ...incTraceResult.handlerNodes)
      this.graph.edges.push(...incTraceResult.stepEdges, ...incTraceResult.containsEdges)
    }
    incProcessTracer.dispose()

    // Rebuild search indices
    this.updateStatus('searchIndexing', 0, reparseList.length, reparseList.length, this.graph.nodes.length, this.graph.edges.length, 'Incremental: building search index...')
    this.bm25Engine = new BM25SearchEngine()
    this.bm25Engine.buildIndex(this.graph.nodes)

    this.updateStatus('searchIndexing', 0.3, reparseList.length, reparseList.length, this.graph.nodes.length, this.graph.edges.length, 'Incremental: generating embeddings...')
    this.embeddingService = this.embeddingService ?? new EmbeddingService(this.config.ollamaBaseUrl, this.config.embedModel)
    // Remove embeddings for re-parsed nodes, then regenerate
    this.embeddingService.removeNodes(new Set(reparseList))
    await this.embeddingService.generateEmbeddings(this.graph.nodes)

    // Regenerate context files for changed folders only
    this.contextGenerator = this.contextGenerator ?? new ContextGenerator(this.config.ollamaBaseUrl, this.config.chatModel)
    const changedFolders = this.getChangedFolders(reparseList)
    if (changedFolders.length > 0) {
      this.updateStatus('searchIndexing', 0.6, reparseList.length, reparseList.length, this.graph.nodes.length, this.graph.edges.length, 'Incremental: regenerating context files...')
      await this.contextGenerator.generateContexts(
        this.graph,
        this.projectPath,
        changedFolders,
      )
    }

    this.updateStatus('searchIndexing', 1, reparseList.length, reparseList.length, this.graph.nodes.length, this.graph.edges.length, 'Incremental: search index rebuilt')

    // Update hashes for changed files
    for (const relativePath of reparseList) {
      const absolutePath = path.join(this.projectPath, relativePath)
      try {
        const stat = await fs.stat(absolutePath)
        const content = await fs.readFile(absolutePath, 'utf-8')
        const hash = crypto.createHash('sha256').update(content).digest('hex')
        this.fileHashes[relativePath] = { hash, mtime: stat.mtimeMs }
      } catch {
        // File may have been deleted
        delete this.fileHashes[relativePath]
      }
    }

    this.updateStatus('saving', 0, reparseList.length, reparseList.length, this.graph.nodes.length, this.graph.edges.length, 'Incremental: saving...')
    await this.save()

    this.updateStatus('complete', 1, reparseList.length, reparseList.length, this.graph.nodes.length, this.graph.edges.length, 'Incremental indexing complete')
    return this.graph
  }
}