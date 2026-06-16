import path from 'path'
import fs from 'fs/promises'
import fsSync from 'fs'
import crypto from 'crypto'
import { execFile } from 'child_process'
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
import { PY_EXTENSIONS, CSS_EXTENSIONS, SCSS_EXTENSIONS, HTML_EXTENSIONS, VUE_EXTENSIONS, PHP_EXTENSIONS, JAVA_EXTENSIONS, C_EXTENSIONS, CPP_EXTENSIONS, CSHARP_EXTENSIONS, GO_EXTENSIONS, RUST_EXTENSIONS } from './extensions.ts'
import { getGitHead } from './git.ts'
import { BM25SearchEngine } from './search/bm25.ts'
import { EmbeddingService } from './search/embedding.ts'
import { ContextGenerator } from './context-generator.ts'
import { ProcessTracer } from './process-tracer.ts'

const execFileAsync = (cmd: string, args: string[], options: import('child_process').ExecFileOptions) =>
  new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    execFile(cmd, args, options, (err, stdout, stderr) => {
      if (err) reject(err)
      else resolve({ stdout: stdout || '', stderr: stderr || '' })
    })
  })

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
  private tsconfigPaths: Array<{ pattern: RegExp; replacements: string[] }> = []
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

      this.updateStatus('searchIndexing', 0.3, filePaths.length, filePaths.length, this.graph.nodes.length, this.graph.edges.length, 'Generating embeddings...')
      this.embeddingService = new EmbeddingService(this.config.ollamaBaseUrl, this.config.embedModel)

      // Run embeddings first, then context generation — avoids overwhelming Ollama with concurrent requests
      const EMBEDDING_TIMEOUT = 120_000 // 2 minute timeout for all embeddings
      const embeddingAvailable = await Promise.race([
        this.embeddingService.generateEmbeddings(
          this.graph.nodes,
          (done, total) => {
            this.updateStatus('searchIndexing', 0.3 + 0.5 * done / total, filePaths.length, filePaths.length, this.graph.nodes.length, this.graph.edges.length, `Generating embeddings ${done}/${total}...`)
          },
        ),
        new Promise<false>((resolve) => setTimeout(() => resolve(false), EMBEDDING_TIMEOUT)),
      ])

      this.updateStatus('searchIndexing', 0.8, filePaths.length, filePaths.length, this.graph.nodes.length, this.graph.edges.length, embeddingAvailable ? 'Embeddings complete, generating context files...' : 'Embeddings timed out, generating context files...')
      this.contextGenerator = new ContextGenerator(this.config.ollamaBaseUrl, this.config.chatModel)
      await this.generateContextsInternal(filePaths.length)

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

    // Ensure .aura/ is in .gitignore
    await this.ensureGitignore()

    // Create .aura/.gitignore to ignore all contents (double protection)
    const auraGitignore = path.join(auraDir, '.gitignore')
    try {
      await fs.access(auraGitignore)
    } catch {
      await fs.writeFile(auraGitignore, '*\n', 'utf-8')
    }

    // Untrack .aura/ if it was committed before .gitignore was set up
    await this.untrackAuraDir()

    const graphPath = path.join(auraDir, 'graph.json')
    await fs.writeFile(graphPath, JSON.stringify(this.graph, null, 2), 'utf-8')

    const lastCommit = await getGitHead(this.projectPath)
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

  /** Load tsconfig paths aliases (e.g. "@/*" -> "./src/*") into this.tsconfigPaths */
  private loadTsconfigPaths(): void {
    this.tsconfigPaths = []
    const tsconfigs = ['tsconfig.json', 'tsconfig.app.json']

    for (const tsconfigName of tsconfigs) {
      const tsconfigPath = path.join(this.projectPath, tsconfigName)
      try {
        const content = fsSync.readFileSync(tsconfigPath, 'utf-8')
        // Strip comments (single-line and multi-line)
        const cleaned = content.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
        const json = JSON.parse(cleaned)
        const opts = json.compilerOptions || {}
        // baseUrl is relative to the tsconfig file's directory
        const baseUrl = opts.baseUrl
          ? path.resolve(path.dirname(tsconfigPath), opts.baseUrl)
          : this.projectPath
        if (opts.paths && typeof opts.paths === 'object') {
          for (const [pattern, targets] of Object.entries(opts.paths as Record<string, string[]>)) {
            // Convert glob pattern like "@/*" to a RegExp
            const regexStr = '^' + pattern.replace(/\*/g, '(.+)') + '$'
            this.tsconfigPaths.push({
              pattern: new RegExp(regexStr),
              // Store replacement paths relative to project root (matching file node IDs)
              replacements: targets.map((t: string) => {
                const absoluteTarget = path.resolve(baseUrl, t).replace(/\\/g, '/')
                // Convert back to project-relative path to match file node IDs
                const projectPrefix = this.projectPath.replace(/\\/g, '/') + '/'
                return absoluteTarget.startsWith(projectPrefix)
                  ? absoluteTarget.slice(projectPrefix.length)
                  : absoluteTarget
              }),
            })
          }
          break // Found paths, no need to check more tsconfigs
        }
      } catch {
        // File doesn't exist or isn't valid JSON — skip
      }
    }
  }

  /** Resolve a bare import specifier (e.g. "@/types") using tsconfig paths */
  private resolveAlias(specifier: string, fileNodeMap: Map<string, AuraNode>): string | null {
    for (const { pattern, replacements } of this.tsconfigPaths) {
      const match = specifier.match(pattern)
      if (match) {
        for (const replacement of replacements) {
          // Replace the wildcard capture group
          const wildcard = match[1] || ''
          const resolved = replacement.replace(/\*/g, wildcard)
          // Try common extensions
          const extensions = ['', '.ts', '.tsx', '.js', '.jsx', '.vue', '.php', '.phtml', '.java', '.h', '.hpp', '.c', '.cpp', '.go', '.rs', '/index.ts', '/index.tsx', '/index.js', '/index.jsx', '/index.vue']
          for (const ext of extensions) {
            const candidate = resolved + ext
            if (fileNodeMap.has(candidate)) return candidate
          }
        }
      }
    }
    return null
  }

  private resolveImports(): void {
    // Load tsconfig path aliases for resolving bare specifiers like "@/types"
    this.loadTsconfigPaths()

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
      const isPythonImport = PY_EXTENSIONS.has(sourceExt) || (!rawImportPath.startsWith('.') && !rawImportPath.includes('/') && rawImportPath.includes('.'))

      // ── Python import resolution ──
      if (isPythonImport) {
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
        const pyExtensions = ['.py', '.pyw', '/__init__.py', '/__init__.pyw']
        let matched = false

        // Skip self-imports (a file importing from its own module)
        const sourceBase = edge.source.replace(/\.(py|pyw)$/, '')
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
      }

      // ── CSS/SCSS import resolution ──
      const isStyleImport = CSS_EXTENSIONS.has(sourceExt) || SCSS_EXTENSIONS.has(sourceExt) ||
        (VUE_EXTENSIONS.has(sourceExt) && (edge.metadata?.importKind === 'css-import' || edge.metadata?.importKind === 'use' || edge.metadata?.importKind === 'forward'))

      if (isStyleImport && !isPythonImport) {
        if (!rawImportPath.startsWith('.')) {
          // Non-relative: could be a package or partial — low confidence
          edge.confidence = 0.3
          continue
        }

        // Resolve relative style import
        const sourceDir = path.dirname(edge.source)
        const resolvedPath = path.normalize(path.join(sourceDir, rawImportPath)).replace(/\\/g, '/')

        // SCSS partial resolution: try _ prefix (e.g. @use "variables" → _variables.scss)
        const styleExtensions = ['.scss', '.sass', '.css', '/index.scss', '/index.css']
        const partialPrefix = path.basename(resolvedPath)
        const partialDir = path.dirname(resolvedPath)
        const partialPath = path.normalize(path.join(partialDir, '_' + partialPrefix)).replace(/\\/g, '/')

        let matched = false
        // Try partial first (SCSS convention: @use "vars" resolves to _vars.scss)
        for (const ext of styleExtensions) {
          const candidate = partialPath + ext
          if (fileNodeMap.has(candidate)) {
            edge.target = candidate
            edge.confidence = 0.9
            matched = true
            break
          }
        }
        if (!matched) {
          for (const ext of styleExtensions) {
            const candidate = resolvedPath + ext
            if (fileNodeMap.has(candidate)) {
              edge.target = candidate
              edge.confidence = 0.9
              matched = true
              break
            }
          }
        }
        if (!matched && fileNodeMap.has(resolvedPath)) {
          edge.target = resolvedPath
          edge.confidence = 0.9
        } else if (!matched) {
          edge.confidence = 0.5
        }
        continue
      }

      // ── HTML import resolution ──
      const isHtmlImport = HTML_EXTENSIONS.has(sourceExt) ||
        (VUE_EXTENSIONS.has(sourceExt) && (edge.metadata?.importKind === 'html-script' || edge.metadata?.importKind === 'html-link'))

      if (isHtmlImport && !isPythonImport) {
        if (!rawImportPath.startsWith('.') && !rawImportPath.startsWith('/')) {
          edge.confidence = 0.3
          continue
        }

        const sourceDir = path.dirname(edge.source)
        const resolvedPath = path.normalize(path.join(sourceDir, rawImportPath)).replace(/\\/g, '/')

        const htmlExtensions = ['.js', '.ts', '.tsx', '.jsx', '.css', '.scss', '.vue',
          '/index.js', '/index.ts', '/index.tsx', '/index.jsx']
        let matched = false
        for (const ext of htmlExtensions) {
          const candidate = resolvedPath + ext
          if (fileNodeMap.has(candidate)) {
            edge.target = candidate
            edge.confidence = 0.9
            matched = true
            break
          }
        }
        if (!matched && fileNodeMap.has(resolvedPath)) {
          edge.target = resolvedPath
          edge.confidence = 0.9
        } else if (!matched) {
          edge.confidence = 0.5
        }
        continue
      }

      // ── PHP import resolution ──
      const isPhpImport = PHP_EXTENSIONS.has(sourceExt) ||
        (VUE_EXTENSIONS.has(sourceExt) && edge.metadata?.importKind === 'use')

      if (isPhpImport && !isPythonImport) {
        // PHP use statements have namespace paths like "App\\Models\\User" (converted to "App/Models/User" by parser)
        // require/include statements have relative file paths like "./helpers.php"
        const isRequireInclude = edge.metadata?.importKind === 'require' || edge.metadata?.importKind === 'include'

        if (isRequireInclude) {
          // resolve relative to source directory
          if (!rawImportPath.startsWith('.') && !rawImportPath.startsWith('/')) {
            edge.confidence = 0.3
            continue
          }
          const sourceDir = path.dirname(edge.source)
          const resolvedPath = path.normalize(path.join(sourceDir, rawImportPath)).replace(/\\/g, '/')
          const phpExtensions = ['.php', '.phtml', '/index.php', '/index.phtml']
          let matched = false
          for (const ext of phpExtensions) {
            const candidate = resolvedPath + ext
            if (fileNodeMap.has(candidate)) {
              edge.target = candidate
              edge.confidence = 0.9
              matched = true
              break
            }
          }
          if (!matched && fileNodeMap.has(resolvedPath)) {
            edge.target = resolvedPath
            edge.confidence = 0.9
          } else if (!matched) {
            edge.confidence = 0.5
          }
        } else {
          // use/namespace imports — these are typically framework autoloaded (e.g., "App/Models/User")
          // Convert namespace separators and try to match to file paths
          const namespacePath = rawImportPath.replace(/\\/g, '/')
          // Try mapping namespace to PSR-4 style paths
          // Common patterns: App/Models/User → app/Models/User.php, app/Models/User/index.php
          const phpExtensions = ['.php', '.phtml', '/index.php', '/index.phtml']
          let matched = false
          // Try lowercase namespace mapping: App → app
          const lowerPath = namespacePath.charAt(0).toLowerCase() + namespacePath.slice(1)
          for (const prefix of ['', 'src/', 'app/', 'lib/']) {
            for (const ext of phpExtensions) {
              const candidate = prefix + lowerPath + ext
              if (fileNodeMap.has(candidate)) {
                edge.target = candidate
                edge.confidence = 0.7
                matched = true
                break
              }
            }
            if (matched) break
          }
          // Also try the exact namespace path as-is
          if (!matched) {
            for (const ext of phpExtensions) {
              const candidate = namespacePath + ext
              if (fileNodeMap.has(candidate)) {
                edge.target = candidate
                edge.confidence = 0.7
                matched = true
                break
              }
            }
          }
          if (!matched) {
            edge.confidence = 0.3 // Likely an autoloaded framework class
          }
        }
        continue
      }

      // ── Java import resolution ──
      const isJavaImport = JAVA_EXTENSIONS.has(sourceExt)

      if (isJavaImport && !isPythonImport && !isPhpImport) {
        // Java imports are dotted package paths like "java.util.List" or "com.example.MyClass"
        // Convert to file paths: "com/example/MyClass.java"
        const dottedPath = rawImportPath
        const slashPath = dottedPath.replace(/\./g, '/')

        // For wildcard imports (com.example.*) — can't resolve specific class
        if (rawImportPath.endsWith('.*') || edge.metadata?.importKind === 'java-wildcard-import') {
          edge.confidence = 0.3
          continue
        }

        // Try resolving the last segment as a class name
        const lastSegment = dottedPath.split('.').pop()!
        const javaExtensions = ['.java', '/package-info.java']
        let matched = false

        // Try: src/main/java/com/example/MyClass.java (Maven/Gradle convention)
        // Try: com/example/MyClass.java (direct match)
        for (const prefix of ['', 'src/main/java/', 'src/']) {
          for (const ext of javaExtensions) {
            const candidate = prefix + slashPath + ext
            if (fileNodeMap.has(candidate)) {
              edge.target = candidate
              edge.confidence = 0.9
              matched = true
              break
            }
          }
          if (matched) break
        }

        // Also try matching by class name (short name resolution)
        if (!matched) {
          for (const [nodeId] of fileNodeMap) {
            if (nodeId.endsWith(`/${lastSegment}.java`) || nodeId === `${lastSegment}.java`) {
              edge.target = nodeId
              edge.confidence = 0.7
              matched = true
              break
            }
          }
        }

        if (!matched) {
          edge.confidence = 0.3 // Likely a JDK or third-party library class
        }
        continue
      }

      // ── C/C++ import resolution ──
      const isCImport = C_EXTENSIONS.has(sourceExt)
      const isCppImport = CPP_EXTENSIONS.has(sourceExt)

      if ((isCImport || isCppImport) && !isPythonImport && !isPhpImport && !isJavaImport) {
        const importKind = edge.metadata?.importKind as string | undefined

        if (importKind === 'c-system-include' || importKind === 'cpp-system-include') {
          // System includes like <stdio.h>, <vector> — likely standard library
          edge.confidence = 0.3
          continue
        }

        if (importKind === 'c-local-include' || importKind === 'cpp-local-include') {
          // Local includes like "utils.h", "../src/main.cpp"
          if (rawImportPath.startsWith('.') || rawImportPath.startsWith('/')) {
            // Relative path — resolve against source directory
            const sourceDir = path.dirname(edge.source)
            const resolvedPath = path.normalize(path.join(sourceDir, rawImportPath)).replace(/\\/g, '/')
            const cppExtensions = isCppImport
              ? ['.hpp', '.hxx', '.hh', '.h', '.cpp', '.cc', '.cxx', '/index.hpp', '/index.h']
              : ['.h', '.c', '/index.h']
            let matched = false
            for (const ext of cppExtensions) {
              const candidate = resolvedPath.endsWith(ext) ? resolvedPath : resolvedPath + ext
              if (fileNodeMap.has(candidate)) {
                edge.target = candidate
                edge.confidence = 0.9
                matched = true
                break
              }
            }
            if (!matched) {
              // Try without extension (some includes omit .h)
              if (fileNodeMap.has(resolvedPath)) {
                edge.target = resolvedPath
                edge.confidence = 0.9
                matched = true
              }
            }
            if (!matched) {
              edge.confidence = 0.4
            }
          } else {
            // Non-relative local include — try common include directories
            const cppExtensions = isCppImport
              ? ['.hpp', '.hxx', '.hh', '.h', '.cpp', '.cc', '.cxx']
              : ['.h', '.c']
            const prefixes = ['', 'include/', 'src/', 'lib/']
            let matched = false
            for (const prefix of prefixes) {
              for (const ext of cppExtensions) {
                const candidate = prefix + rawImportPath + ext
                if (fileNodeMap.has(candidate)) {
                  edge.target = candidate
                  edge.confidence = 0.7
                  matched = true
                  break
                }
              }
              if (matched) break
            }
            if (!matched) {
              edge.confidence = 0.3
            }
          }
        } else if (importKind === 'cpp-using') {
          // using declarations — namespace-based like Java imports
          // "namespace std" or "std::vector" or "std::cout"
          const dottedPath = rawImportPath.replace(/\s+/g, '') // remove spaces
          if (dottedPath.startsWith('namespace')) {
            // using namespace std; — low confidence, broad
            edge.confidence = 0.3
          } else {
            // using std::vector; — resolve like a qualified name
            const slashPath = dottedPath.replace(/::/g, '/')
            const cppExtensions = ['.hpp', '.hxx', '.hh', '.h', '.cpp', '.cc', '.cxx']
            let matched = false
            for (const ext of cppExtensions) {
              const candidate = slashPath + ext
              if (fileNodeMap.has(candidate)) {
                edge.target = candidate
                edge.confidence = 0.7
                matched = true
                break
              }
            }
            if (!matched) {
              // Try short-name matching
              const lastSegment = dottedPath.split('::').pop()!
              for (const [nodeId] of fileNodeMap) {
                if (nodeId.endsWith(`/${lastSegment}.hpp`) || nodeId.endsWith(`/${lastSegment}.h`) ||
                    nodeId.endsWith(`/${lastSegment}.cpp`) || nodeId.endsWith(`/${lastSegment}.cc`)) {
                  edge.target = nodeId
                  edge.confidence = 0.5
                  matched = true
                  break
                }
              }
            }
            if (!matched) {
              edge.confidence = 0.3
            }
          }
        } else {
          // Unknown import kind — treat as local include with low confidence
          edge.confidence = 0.3
        }
        continue
      }

      // ── C# import resolution ──
      const isCSharpImport = CSHARP_EXTENSIONS.has(sourceExt)

      if (isCSharpImport) {
        const importKind = edge.metadata?.importKind as string | undefined

        // C# using directives resolve to namespace paths
        // "using System;" / "using MyApp.Services;" / "using static Math;" / "using X = Y;"
        const dottedPath = rawImportPath.replace(/\s+/g, '')
        const slashPath = dottedPath.replace(/\./g, '/')

        if (importKind === 'using-static' || importKind === 'using-alias') {
          // using static or using alias — try resolving the target path
          const csExtensions = ['.cs', '/index.cs']
          let matched = false
          for (const ext of csExtensions) {
            const candidate = slashPath + ext
            if (fileNodeMap.has(candidate)) {
              edge.target = candidate
              edge.confidence = 0.7
              matched = true
              break
            }
          }
          if (!matched) {
            // Try short-name matching
            const lastSegment = dottedPath.split('.').pop()!
            for (const [nodeId] of fileNodeMap) {
              if (nodeId.endsWith(`/${lastSegment}.cs`)) {
                edge.target = nodeId
                edge.confidence = 0.5
                matched = true
                break
              }
            }
          }
          if (!matched) {
            edge.confidence = 0.3
          }
        } else {
          // Regular using directive: "using System", "using MyApp.Services"
          // First check if it's a well-known .NET namespace
          const dotnetNamespaces = new Set([
            'System', 'System.Collections', 'System.Collections.Generic',
            'System.IO', 'System.Net', 'System.Net.Http', 'System.Threading',
            'System.Threading.Tasks', 'System.Linq', 'System.Text',
            'System.Text.RegularExpressions', 'System.Globalization',
            'System.Reflection', 'System.Diagnostics', 'System.Runtime',
            'System.Runtime.CompilerServices', 'System.Runtime.InteropServices',
            'System.Runtime.Serialization', 'System.Security', 'System.Security.Cryptography',
            'System.Data', 'System.Data.Common', 'System.Xml', 'System.Xml.Linq',
          ])
          if (dotnetNamespaces.has(rawImportPath)) {
            edge.confidence = 0.2
            continue
          }

          // Try resolving as namespace → file path
          const csExtensions = ['.cs', '/index.cs']
          let matched = false
          for (const ext of csExtensions) {
            const candidate = slashPath + ext
            if (fileNodeMap.has(candidate)) {
              edge.target = candidate
              edge.confidence = 0.7
              matched = true
              break
            }
          }
          if (!matched) {
            // Try short-name matching: "MyApp.Services" → find files like Services.cs
            const lastSegment = dottedPath.split('.').pop()!
            for (const [nodeId] of fileNodeMap) {
              if (nodeId.endsWith(`/${lastSegment}.cs`)) {
                edge.target = nodeId
                edge.confidence = 0.5
                matched = true
                break
              }
            }
          }
          if (!matched) {
            edge.confidence = 0.3
          }
        }
        continue
      }

      // ── Go import resolution ──
      const isGoImport = GO_EXTENSIONS.has(sourceExt)

      if (isGoImport) {
        const importKind = edge.metadata?.importKind as string | undefined

        if (importKind === 'go-stdlib' || importKind === 'go-external') {
          // Standard library or external package — no local resolution possible
          edge.confidence = 0.3
          continue
        }

        // Internal Go package paths: "myproject/internal/handler"
        // Try resolving to local .go files
        const goExtensions = ['.go', '/index.go']
        let matched = false
        for (const ext of goExtensions) {
          const candidate = rawImportPath + ext
          if (fileNodeMap.has(candidate)) {
            edge.target = candidate
            edge.confidence = 0.7
            matched = true
            break
          }
        }
        if (!matched) {
          // Try short-name matching: last path segment
          const lastSegment = rawImportPath.split('/').pop()!
          for (const [nodeId] of fileNodeMap) {
            if (nodeId.endsWith(`/${lastSegment}.go`) || nodeId.endsWith(`/${lastSegment}/index.go`)) {
              edge.target = nodeId
              edge.confidence = 0.5
              matched = true
              break
            }
          }
        }
        if (!matched) {
          edge.confidence = 0.3
        }
        continue
      }

      // ── Rust import resolution ──
      const isRustImport = RUST_EXTENSIONS.has(sourceExt)

      if (isRustImport) {
        const importKind = edge.metadata?.importKind as string | undefined
        let resolvedPath = rawImportPath

        if (importKind === 'rust-stdlib') {
          // std::/core::/alloc:: — standard library
          edge.confidence = 0.3
          continue
        }

        // Strip crate::/self::/super:: prefixes and convert :: to /
        resolvedPath = resolvedPath.replace(/^(crate|self|super)::/, '')
        resolvedPath = resolvedPath.replace(/::/g, '/')

        if (resolvedPath) {
          // Try resolving to local .rs files
          const rustExtensions = ['.rs', '/mod.rs', '/lib.rs']
          let matched = false
          for (const ext of rustExtensions) {
            const candidate = resolvedPath + ext
            if (fileNodeMap.has(candidate)) {
              edge.target = candidate
              edge.confidence = 0.7
              matched = true
              break
            }
          }
          if (!matched) {
            // Try with src/ prefix
            for (const ext of rustExtensions) {
              const candidate = `src/${resolvedPath}${ext}`
              if (fileNodeMap.has(candidate)) {
                edge.target = candidate
                edge.confidence = 0.7
                matched = true
                break
              }
            }
          }
          if (!matched) {
            // Try short-name matching
            const lastSegment = resolvedPath.split('/').pop()!
            for (const [nodeId] of fileNodeMap) {
              if (nodeId.endsWith(`/${lastSegment}.rs`) || nodeId.endsWith(`/${lastSegment}/mod.rs`)) {
                edge.target = nodeId
                edge.confidence = 0.5
                matched = true
                break
              }
            }
          }
          if (!matched) {
            edge.confidence = 0.3
          }
        } else {
          edge.confidence = 0.3
        }
        continue
      }

      // ── JS/TS/Vue import resolution ──
      // Only reach here for JS/TS/Vue imports (Python, CSS/SCSS, HTML, PHP, Java, C/C++, C#, Go, Rust are handled above)
      if (!rawImportPath.startsWith('.')) {
        // Non-relative import — try tsconfig path aliases (e.g. "@/types" -> "./src/types")
        const aliasResolved = this.resolveAlias(rawImportPath, fileNodeMap)
        if (aliasResolved) {
          edge.target = aliasResolved
          edge.confidence = 0.9
        } else {
          // Unresolvable bare specifier (e.g. 'react', 'express') — keep with low confidence
          edge.confidence = 0.3
        }
        continue
      }

      // Resolve relative import path
      const sourceDir = path.dirname(edge.source)
      const resolvedPath = path.normalize(path.join(sourceDir, rawImportPath)).replace(/\\/g, '/')

      // Try extensions (including .vue for Vue component imports)
      const extensions = ['.ts', '.tsx', '.js', '.jsx', '.vue', '/index.ts', '/index.tsx', '/index.js', '/index.jsx', '/index.vue']
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


  private async ensureGitignore(): Promise<void> {
    const gitignorePath = path.join(this.projectPath, '.gitignore')
    const entries = ['.aura/']
    let content = ''
    try {
      content = await fs.readFile(gitignorePath, 'utf-8')
    } catch {
      // No .gitignore yet
    }
    const lines = content ? content.split(/\r?\n/) : []
    const needsAppend = entries.filter(e => !lines.includes(e) && !lines.includes(e.replace('/', '')))
    if (needsAppend.length > 0) {
      const addition = (content && !content.endsWith('\n') ? '\n' : '') + '\n# AI tools\n' + needsAppend.join('\n') + '\n'
      await fs.writeFile(gitignorePath, content + addition, 'utf-8')
    }
  }

  private async untrackAuraDir(): Promise<void> {
    // If .aura/ files are already tracked by git, remove them from the index
    // without deleting the files on disk. One-time fix for repos where .aura/
    // was committed before .gitignore was set up.
    try {
      const { stdout } = await execFileAsync('git', ['ls-files', '.aura/'], {
        cwd: this.projectPath,
        timeout: 5000,
      })
      if (stdout.trim()) {
        await execFileAsync('git', ['rm', '-r', '--cached', '.aura/'], {
          cwd: this.projectPath,
          timeout: 10000,
        })
      }
    } catch {
      // Not a git repo or no tracked .aura/ files — ignore
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