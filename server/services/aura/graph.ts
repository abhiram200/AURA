import path from 'path'
import fs from 'fs/promises'
import fsSync from 'fs'
import {
  AuraNodeKind,
  AuraEdgeType,
} from './types.ts'
import type {
  AuraNode,
  AuraEdge,
  GraphData,
  AuraMeta,
  ImpactResult,
  DirectionResult,
  FileImpact,
  SymbolImpact,
  TraceStep,
  NodeContext,
  SearchResult,
  SearchMode,
  ContextManifest,
  FileDiff,
  ChangedSymbol,
  ChangeDetectionResult,
  RenameEdit,
  RenameResult,
  RouteMapResult,
  McpToolMapResult,
  ResponseShapeField,
  ShapeCheckResult,
  ShapeConsumer,
  ShapeMismatch,
  ApiImpactResult,
  RouteMiddleware,
  ProcessInfo,
  ProcessDetail,
} from './types.ts'
import { BM25SearchEngine } from './search/bm25.ts'
import { EmbeddingService } from './search/embedding.ts'
import { HybridSearchEngine } from './search/hybrid.ts'
import { ContextGenerator } from './context-generator.ts'

type AdjacencyEntry = { edge: AuraEdge; neighbor: AuraNode }

const EDGE_TRANSMISSION: Record<string, number> = {
  [AuraEdgeType.EXTENDS]: 0.95,
  [AuraEdgeType.IMPLEMENTS]: 0.90,
  [AuraEdgeType.CALLS]: 0.70,
  [AuraEdgeType.DEPENDS_ON]: 0.30,
  [AuraEdgeType.IMPORTS]: 0.30,
  [AuraEdgeType.CONTAINS]: 0.00,
  [AuraEdgeType.HAS_METHOD]: 0.00,
  [AuraEdgeType.HAS_PROPERTY]: 0.00,
  [AuraEdgeType.TYPEOF]: 0.60,
  [AuraEdgeType.TYPE_ALIAS]: 0.40,
  [AuraEdgeType.FLOWS_TO]: 0.40,
  [AuraEdgeType.HANDLES]: 0.00,
  [AuraEdgeType.FETCHES]: 0.70,
  [AuraEdgeType.MIDDLEWARE]: 0.00,
}

const SEVERITY_THRESHOLDS = { critical: 0.80, moderate: 0.50 } as const

function scoreToSeverity(score: number): 'critical' | 'moderate' | 'low' {
  if (score >= SEVERITY_THRESHOLDS.critical) return 'critical'
  if (score >= SEVERITY_THRESHOLDS.moderate) return 'moderate'
  return 'low'
}

export class AuraQueryService {
  private projectPath: string
  private config: { ollamaBaseUrl?: string; chatModel?: string; embedModel?: string }
  private loaded = false
  private graphData: GraphData = { nodes: [], edges: [] }
  private metaData: AuraMeta | null = null

  private nodeMap: Map<string, AuraNode> = new Map()
  private adjacency: Map<string, AdjacencyEntry[]> = new Map()
  private reverseAdjacency: Map<string, AdjacencyEntry[]> = new Map()
  private fileToSymbolsMap: Map<string, AuraNode[]> = new Map()

  private bm25Engine: BM25SearchEngine | null = null
  private embeddingService: EmbeddingService | null = null
  private hybridEngine: HybridSearchEngine | null = null
  private contextManifest: ContextManifest | null = null
  constructor(projectPath: string, config?: { ollamaBaseUrl?: string; chatModel?: string; embedModel?: string }) {
    this.projectPath = projectPath
    this.config = config ?? {}
  }

  async load(): Promise<void> {
    // Reset all indices
    this.nodeMap.clear()
    this.adjacency.clear()
    this.reverseAdjacency.clear()
    this.graphData = { nodes: [], edges: [] }
    this.metaData = null
    this.loaded = false

    const graphPath = path.join(this.projectPath, '.aura', 'graph.json')
    const metaPath = path.join(this.projectPath, '.aura', 'meta.json')

    if (fsSync.existsSync(graphPath)) {
      const graphRaw = await fs.readFile(graphPath, 'utf-8')
      this.graphData = JSON.parse(graphRaw) as GraphData
    }

    if (fsSync.existsSync(metaPath)) {
      const metaRaw = await fs.readFile(metaPath, 'utf-8')
      this.metaData = JSON.parse(metaRaw) as AuraMeta
    }

    // Build node map
    for (const node of this.graphData.nodes) {
      this.nodeMap.set(node.id, node)
    }

    // Build file-to-symbols map (non-File nodes grouped by filePath)
    this.fileToSymbolsMap.clear()
    for (const node of this.graphData.nodes) {
      if (node.kind !== AuraNodeKind.File && node.filePath) {
        const list = this.fileToSymbolsMap.get(node.filePath) ?? []
        list.push(node)
        this.fileToSymbolsMap.set(node.filePath, list)
      }
    }

    // Build adjacency and reverse adjacency lists (deduplicating edges)
    const seenEdges = new Set<string>()
    for (const edge of this.graphData.edges) {
      // Skip edges where source or target node doesn't exist
      const sourceNode = this.nodeMap.get(edge.source)
      const targetNode = this.nodeMap.get(edge.target)
      if (!sourceNode || !targetNode) continue

      // Deduplicate: skip if this (source, type, target) edge was already processed
      const dedupeKey = `${edge.source}|${edge.type}|${edge.target}`
      if (seenEdges.has(dedupeKey)) continue
      seenEdges.add(dedupeKey)

      // Forward adjacency: source -> target
      const forwardList = this.adjacency.get(edge.source) ?? []
      forwardList.push({ edge, neighbor: targetNode })
      this.adjacency.set(edge.source, forwardList)

      // Reverse adjacency: target -> source
      const reverseList = this.reverseAdjacency.get(edge.target) ?? []
      reverseList.push({ edge, neighbor: sourceNode })
      this.reverseAdjacency.set(edge.target, reverseList)
    }

    // Load search indices
    const searchIndexPath = path.join(this.projectPath, '.aura', 'search-index.json')
    if (fsSync.existsSync(searchIndexPath)) {
      try {
        const raw = await fs.readFile(searchIndexPath, 'utf-8')
        const data = JSON.parse(raw)
        this.bm25Engine = BM25SearchEngine.fromJSON(data, this.nodeMap)
      } catch {
        this.bm25Engine = null
      }
    }

    const embeddingsPath = path.join(this.projectPath, '.aura', 'embeddings.json')
    if (fsSync.existsSync(embeddingsPath)) {
      try {
        const raw = await fs.readFile(embeddingsPath, 'utf-8')
        const data = JSON.parse(raw)
        this.embeddingService = EmbeddingService.fromJSON(data, this.nodeMap, this.config.ollamaBaseUrl, this.config.embedModel)
      } catch {
        this.embeddingService = null
      }
    }

    if (this.bm25Engine || this.embeddingService) {
      this.hybridEngine = new HybridSearchEngine(this.bm25Engine, this.embeddingService ?? new EmbeddingService(this.config.ollamaBaseUrl, this.config.embedModel))
    }

    // Load context manifest
    const contextGen = new ContextGenerator(this.config.ollamaBaseUrl, this.config.chatModel)
    this.contextManifest = contextGen.loadManifest(this.projectPath)

    this.loaded = true
  }

  isLoaded(): boolean {
    return this.loaded
  }

  getGraph(): GraphData {
    return this.graphData
  }

  getMeta(): AuraMeta | null {
    return this.metaData
  }

  getNode(id: string): AuraNode | null {
    return this.nodeMap.get(id) ?? null
  }

  private propagateDirection(
    targetId: string,
    adjMap: Map<string, AdjacencyEntry[]>,
  ): DirectionResult {
    const scores = new Map<string, number>()
    scores.set(targetId, 1.0)

    const predecessor = new Map<string, { nodeId: string; edgeType: AuraEdgeType; incomingScore: number }>()

    const MAX_ITERATIONS = 10

    // BFS-frontier: only propagate from nodes whose score changed in the previous iteration
    let frontier = new Set<string>([targetId])

    // Track whether any symbol-level edge (CALLS, IMPORTS, FLOWS_TO, TYPEOF) has already
    // reached a given sourceFile->targetFile pair. If so, a weaker DEPENDS_ON edge for
    // the same pair is redundant and should be skipped to avoid inflating scores.
    const symbolLevelFilesReached = new Set<string>() // "sourceFile->targetFile"

    for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
      if (frontier.size === 0) break

      // Collect incoming edges, deduplicating at two levels:
      // 1. Same source→target pair with multiple edge types (e.g. CALLS + FLOWS_TO):
      //    keep only the strongest edge type per pair
      // 2. Same sourceFile→targetFile pair with DEPENDS_ON vs symbol-level:
      //    skip DEPENDS_ON when symbol-level already exists
      const perPairBest = new Map<string, { targetId: string; incomingScore: number; sourceId: string; edgeType: AuraEdgeType }>()
      // key: "sourceId|targetId"

      for (const nodeId of frontier) {
        const nodeScore = scores.get(nodeId) ?? 0
        if (nodeScore < 0.001) continue

        const neighbors = adjMap.get(nodeId) ?? []
        for (const { edge, neighbor } of neighbors) {
          const transmission = EDGE_TRANSMISSION[edge.type] ?? 0
          if (transmission === 0) continue

          const incomingScore = nodeScore * transmission

          // Deduplicate: skip DEPENDS_ON if a symbol-level edge already reached same file pair
          const sourceFile = nodeId.includes(':') ? nodeId.substring(0, nodeId.indexOf(':')) : nodeId
          const targetFile = neighbor.id.includes(':') ? neighbor.id.substring(0, neighbor.id.indexOf(':')) : neighbor.id
          const fileDedupeKey = `${sourceFile}->${targetFile}`

          if (edge.type === AuraEdgeType.DEPENDS_ON) {
            if (symbolLevelFilesReached.has(fileDedupeKey)) continue
          } else {
            symbolLevelFilesReached.add(fileDedupeKey)
          }

          // Deduplicate: same source→target pair through multiple edge types, keep strongest
          const pairKey = `${nodeId}|${neighbor.id}`
          const existing = perPairBest.get(pairKey)
          if (!existing || incomingScore > existing.incomingScore) {
            perPairBest.set(pairKey, {
              targetId: neighbor.id,
              incomingScore,
              sourceId: nodeId,
              edgeType: edge.type as AuraEdgeType,
            })
          }
        }
      }

      // Combine surviving edges per target via probabilistic OR
      const incomingScores = new Map<string, { combined: number; bestPred: { nodeId: string; edgeType: AuraEdgeType; incomingScore: number } }>()
      for (const { targetId, incomingScore, sourceId, edgeType } of perPairBest.values()) {
        const existing = incomingScores.get(targetId)
        if (existing) {
          existing.combined = 1 - (1 - existing.combined) * (1 - incomingScore)
          if (incomingScore > existing.bestPred.incomingScore) {
            existing.bestPred = { nodeId: sourceId, edgeType, incomingScore }
          }
        } else {
          incomingScores.set(targetId, {
            combined: incomingScore,
            bestPred: { nodeId: sourceId, edgeType, incomingScore },
          })
        }
      }

      // Apply updates: combine incoming scores with existing scores via probabilistic OR
      const newFrontier = new Set<string>()
      for (const [nodeId, { combined, bestPred }] of incomingScores) {
        const existingScore = scores.get(nodeId) ?? 0
        const newScore = 1 - (1 - existingScore) * (1 - combined)

        if (newScore > existingScore + 0.001) {
          scores.set(nodeId, newScore)
          predecessor.set(nodeId, bestPred)
          newFrontier.add(nodeId)
        }
      }

      frontier = newFrontier
    }

    const tracePaths = new Map<string, TraceStep[]>()
    for (const nodeId of scores.keys()) {
      if (nodeId === targetId) continue
      const path: TraceStep[] = []
      let current = nodeId
      while (current !== targetId) {
        const pred = predecessor.get(current)
        if (!pred) break
        const node = this.nodeMap.get(pred.nodeId)
        if (!node) break
        path.unshift({
          id: node.id,
          name: node.name,
          kind: node.kind,
          edgeType: pred.edgeType,
          filePath: node.filePath,
        })
        current = pred.nodeId
      }
      tracePaths.set(nodeId, path)
    }

    const fileMap = new Map<string, SymbolImpact[]>()
    for (const [nodeId, score] of scores) {
      if (nodeId === targetId) continue
      if (score < 0.001) continue

      const node = this.nodeMap.get(nodeId)
      if (!node) continue

      const symbol: SymbolImpact = {
        id: node.id,
        name: node.name,
        kind: node.kind,
        score: Math.round(score * 1000) / 1000,
        severity: scoreToSeverity(score),
        tracePath: tracePaths.get(nodeId) ?? [],
        range: node.range,
      }

      const existing = fileMap.get(node.filePath) ?? []
      existing.push(symbol)
      fileMap.set(node.filePath, existing)
    }

    const files: FileImpact[] = []
    for (const [filePath, symbols] of fileMap) {
      symbols.sort((a, b) => b.score - a.score)
      const maxScore = symbols[0].score
      files.push({
        filePath,
        severity: scoreToSeverity(maxScore),
        score: maxScore,
        symbols,
      })
    }

    files.sort((a, b) => b.score - a.score)

    const summary = {
      totalFiles: files.length,
      critical: files.filter(f => f.severity === 'critical').length,
      moderate: files.filter(f => f.severity === 'moderate').length,
      low: files.filter(f => f.severity === 'low').length,
    }

    return { files, summary }
  }

  impact(targetId: string): ImpactResult | null {
    if (!this.nodeMap.has(targetId)) return null

    return {
      target: targetId,
      downstream: this.propagateDirection(targetId, this.reverseAdjacency),
      upstream: this.propagateDirection(targetId, this.adjacency),
    }
  }

  context(nodeId: string): NodeContext | null {
    const node = this.nodeMap.get(nodeId)
    if (!node) return null

    const incoming: { node: AuraNode; edgeType: AuraEdgeType }[] = []
    const outgoing: { node: AuraNode; edgeType: AuraEdgeType }[] = []
    const members: AuraNode[] = []
    let containedBy: AuraNode | null = null
    const hierarchy: { node: AuraNode; relation: string }[] = []

    // Incoming edges (who references this node)
    const reverseEdges = this.reverseAdjacency.get(nodeId) ?? []
    for (const { edge, neighbor } of reverseEdges) {
      if (edge.type === AuraEdgeType.CONTAINS) {
        // CONTAINS in reverse means this node is contained by the neighbor
        containedBy = neighbor
        continue
      }
      if (edge.type === AuraEdgeType.EXTENDS || edge.type === AuraEdgeType.IMPLEMENTS) {
        // Hierarchy edges go in the hierarchy list, not incoming
        hierarchy.push({ node: neighbor, relation: edge.type === AuraEdgeType.EXTENDS ? 'extended by' : 'implemented by' })
        continue
      }
      incoming.push({ node: neighbor, edgeType: edge.type })
    }

    // Outgoing edges (who this node references)
    const forwardEdges = this.adjacency.get(nodeId) ?? []
    for (const { edge, neighbor } of forwardEdges) {
      if (edge.type === AuraEdgeType.CONTAINS) {
        // CONTAINS in forward means this node contains the neighbor
        members.push(neighbor)
        continue
      }
      if (edge.type === AuraEdgeType.EXTENDS || edge.type === AuraEdgeType.IMPLEMENTS) {
        // Hierarchy edges go in the hierarchy list, not outgoing
        hierarchy.push({ node: neighbor, relation: edge.type === AuraEdgeType.EXTENDS ? 'extends' : 'implements' })
        continue
      }
      outgoing.push({ node: neighbor, edgeType: edge.type })
    }

    return {
      node,
      incoming,
      outgoing,
      members,
      containedBy,
      hierarchy,
    }
  }

  setSearchEngines(bm25: BM25SearchEngine | null, embedding: EmbeddingService | null): void {
    this.bm25Engine = bm25
    this.embeddingService = embedding
    if (bm25 || embedding) {
      this.hybridEngine = new HybridSearchEngine(bm25, embedding ?? new EmbeddingService(this.config.ollamaBaseUrl, this.config.embedModel))
    } else {
      this.hybridEngine = null
    }
  }

  getContextManifest(): ContextManifest | null {
    return this.contextManifest
  }

  getContextForFolder(folderPath: string): string | null {
    const contextGen = new ContextGenerator(this.config.ollamaBaseUrl, this.config.chatModel)
    return contextGen.getContextForFolder(this.projectPath, folderPath)
  }

  getAllFolderContexts(): Record<string, string> {
    const contextGen = new ContextGenerator(this.config.ollamaBaseUrl, this.config.chatModel)
    return contextGen.getAllContexts(this.projectPath)
  }

  getProcesses(): ProcessInfo[] {
    const processes = this.graphData.nodes.filter(n => n.kind === AuraNodeKind.Process)
    return processes.map(node => ({
      id: node.id,
      name: node.name,
      method: (node.metadata?.method as string) ?? '',
      path: (node.metadata?.path as string) ?? '',
      stepCount: (node.metadata?.stepCount as number) ?? 0,
      entryRouteId: (node.metadata?.entryRouteId as string) ?? '',
    }))
  }

  getProcessDetail(processId: string): ProcessDetail | null {
    const processNode = this.nodeMap.get(processId)
    if (!processNode || processNode.kind !== AuraNodeKind.Process) return null

    const steps = this.adjacency.get(processId)
      ?.filter(e => e.edge.type === AuraEdgeType.STEP_IN_PROCESS)
      .sort((a, b) => ((a.edge.metadata?.stepOrder as number) ?? 0) - ((b.edge.metadata?.stepOrder as number) ?? 0))
      .map(e => ({
        order: (e.edge.metadata?.stepOrder as number) ?? 0,
        label: (e.edge.metadata?.stepLabel as string) ?? 'call',
        nodeId: e.neighbor.id,
        name: e.neighbor.name,
        kind: e.neighbor.kind,
      })) ?? []

    return {
      id: processId,
      name: processNode.name,
      steps,
    }
  }

  async search(query: string, options?: { limit?: number; kinds?: string[]; mode?: SearchMode }): Promise<SearchResult[]> {
    const mode = options?.mode ?? 'hybrid'
    if (this.hybridEngine) {
      return this.hybridEngine.search(query, mode, this.basicSearch.bind(this), options)
    }
    return this.basicSearch(query, options)
  }

  private basicSearch(query: string, options?: { limit?: number; kinds?: string[] }): SearchResult[] {
    const limit = options?.limit ?? 50
    const kinds = options?.kinds
    const lowerQuery = query.toLowerCase()
    const results: SearchResult[] = []

    for (const node of this.graphData.nodes) {
      if (kinds && kinds.length > 0 && !kinds.includes(node.kind)) continue

      const lowerName = node.name.toLowerCase()
      const lowerPath = node.filePath.toLowerCase()

      let score = 0

      if (lowerName === lowerQuery) {
        score = 1.0
      } else if (lowerName.startsWith(lowerQuery)) {
        score = 0.85
      } else if (lowerName.includes(lowerQuery)) {
        score = 0.7
      } else if (this.isFuzzyMatch(lowerQuery, lowerName)) {
        score = 0.5
      } else if (lowerPath.includes(lowerQuery)) {
        score = 0.3
      }

      if (score > 0) {
        if (node.exported) score = Math.min(score * 1.1, 1.0)
        results.push({ node, score })
      }
    }

    results.sort((a, b) => b.score - a.score)
    return results.slice(0, limit)
  }

  private isFuzzyMatch(query: string, target: string): boolean {
    let qi = 0
    for (let ti = 0; ti < target.length && qi < query.length; ti++) {
      if (target[ti] === query[qi]) qi++
    }
    return qi === query.length
  }

  dependents(nodeId: string, depth: number = Infinity): AuraNode[] {
    const result: AuraNode[] = []
    const visited = new Set<string>([nodeId])
    let currentLevelIds = [nodeId]

    for (let d = 0; d < depth; d++) {
      const nextLevelIds: string[] = []

      for (const currentId of currentLevelIds) {
        const neighbors = this.reverseAdjacency.get(currentId) ?? []
        for (const { edge, neighbor } of neighbors) {
          if (visited.has(neighbor.id)) continue
          if (
            edge.type === AuraEdgeType.CONTAINS ||
            edge.type === AuraEdgeType.HAS_METHOD ||
            edge.type === AuraEdgeType.HAS_PROPERTY
          ) continue

          visited.add(neighbor.id)
          nextLevelIds.push(neighbor.id)
          result.push(neighbor)
        }
      }

      if (nextLevelIds.length === 0) break
      currentLevelIds = nextLevelIds
    }

    return result
  }

  dependencies(nodeId: string, depth: number = Infinity): AuraNode[] {
    const result: AuraNode[] = []
    const visited = new Set<string>([nodeId])
    let currentLevelIds = [nodeId]

    for (let d = 0; d < depth; d++) {
      const nextLevelIds: string[] = []

      for (const currentId of currentLevelIds) {
        const neighbors = this.adjacency.get(currentId) ?? []
        for (const { edge, neighbor } of neighbors) {
          if (visited.has(neighbor.id)) continue
          if (
            edge.type === AuraEdgeType.CONTAINS ||
            edge.type === AuraEdgeType.HAS_METHOD ||
            edge.type === AuraEdgeType.HAS_PROPERTY
          ) continue

          visited.add(neighbor.id)
          nextLevelIds.push(neighbor.id)
          result.push(neighbor)
        }
      }

      if (nextLevelIds.length === 0) break
      currentLevelIds = nextLevelIds
    }

    return result
  }

  // ── Change Detection ─────────────────────────────────────────────────────

  mapHunksToSymbols(fileDiffs: FileDiff[]): ChangedSymbol[] {
    const changedSymbols: ChangedSymbol[] = []

    for (const fileDiff of fileDiffs) {
      const symbols = this.fileToSymbolsMap.get(fileDiff.filePath) ?? []

      for (const symbol of symbols) {
        if (!symbol.range) continue

        const overlappingHunks: typeof fileDiff.hunks = []
        for (const hunk of fileDiff.hunks) {
          if (symbol.range.startLine <= hunk.endLine && symbol.range.endLine >= hunk.startLine) {
            overlappingHunks.push(hunk)
          }
        }

        if (overlappingHunks.length > 0 || fileDiff.status === 'added' || fileDiff.status === 'deleted') {
          let changeType: ChangedSymbol['changeType']
          if (fileDiff.status === 'added') changeType = 'added'
          else if (fileDiff.status === 'deleted') changeType = 'deleted'
          else changeType = 'modified'

          changedSymbols.push({
            nodeId: symbol.id,
            name: symbol.name,
            kind: symbol.kind,
            filePath: symbol.filePath,
            range: symbol.range,
            changeType,
            hunks: overlappingHunks,
          })
        }
      }
    }

    return changedSymbols
  }

  detectChanges(fileDiffs: FileDiff[]): ChangeDetectionResult {
    const changedSymbols = this.mapHunksToSymbols(fileDiffs)

    if (changedSymbols.length === 0) {
      return {
        files: fileDiffs,
        changedSymbols: [],
        impact: null,
        summary: {
          totalFiles: fileDiffs.length,
          totalSymbols: 0,
          criticalFiles: 0,
          moderateFiles: 0,
          lowFiles: 0,
        },
      }
    }

    // Merge impact results from all changed symbols
    const mergedDownstream = new Map<string, SymbolImpact>()
    const mergedUpstream = new Map<string, SymbolImpact>()

    for (const symbol of changedSymbols) {
      const result = this.impact(symbol.nodeId)
      if (!result) continue

      for (const file of result.downstream.files) {
        for (const sym of file.symbols) {
          const existing = mergedDownstream.get(sym.id)
          if (!existing || sym.score > existing.score) {
            mergedDownstream.set(sym.id, sym)
          }
        }
      }

      for (const file of result.upstream.files) {
        for (const sym of file.symbols) {
          const existing = mergedUpstream.get(sym.id)
          if (!existing || sym.score > existing.score) {
            mergedUpstream.set(sym.id, sym)
          }
        }
      }
    }

    // Build merged file impacts from downstream
    const downstreamFiles = this.buildFileImpacts(mergedDownstream)
    const upstreamFiles = this.buildFileImpacts(mergedUpstream)

    const impact: ImpactResult = {
      target: '__changes__',
      downstream: {
        files: downstreamFiles,
        summary: {
          totalFiles: downstreamFiles.length,
          critical: downstreamFiles.filter(f => f.severity === 'critical').length,
          moderate: downstreamFiles.filter(f => f.severity === 'moderate').length,
          low: downstreamFiles.filter(f => f.severity === 'low').length,
        },
      },
      upstream: {
        files: upstreamFiles,
        summary: {
          totalFiles: upstreamFiles.length,
          critical: upstreamFiles.filter(f => f.severity === 'critical').length,
          moderate: upstreamFiles.filter(f => f.severity === 'moderate').length,
          low: upstreamFiles.filter(f => f.severity === 'low').length,
        },
      },
    }

    const allAffectedFiles = new Set([
      ...downstreamFiles.map(f => f.filePath),
      ...upstreamFiles.map(f => f.filePath),
    ])

    return {
      files: fileDiffs,
      changedSymbols,
      impact,
      summary: {
        totalFiles: fileDiffs.length,
        totalSymbols: changedSymbols.length,
        criticalFiles: allAffectedFiles.size > 0 ? impact.downstream.summary.critical + impact.upstream.summary.critical : 0,
        moderateFiles: allAffectedFiles.size > 0 ? impact.downstream.summary.moderate + impact.upstream.summary.moderate : 0,
        lowFiles: allAffectedFiles.size > 0 ? impact.downstream.summary.low + impact.upstream.summary.low : 0,
      },
    }
  }

  private buildFileImpacts(impacts: Map<string, SymbolImpact>): FileImpact[] {
    const fileMap = new Map<string, SymbolImpact[]>()

    for (const sym of impacts.values()) {
      const node = this.nodeMap.get(sym.id)
      if (!node) continue
      const list = fileMap.get(node.filePath) ?? []
      list.push(sym)
      fileMap.set(node.filePath, list)
    }

    const files: FileImpact[] = []
    for (const [filePath, symbols] of fileMap) {
      symbols.sort((a, b) => b.score - a.score)
      const maxScore = symbols[0].score
      files.push({
        filePath,
        severity: scoreToSeverity(maxScore),
        score: maxScore,
        symbols,
      })
    }

    files.sort((a, b) => b.score - a.score)
    return files
  }

  // ── Rename ────────────────────────────────────────────────────────────────

  async rename(nodeId: string, newName: string, dryRun: boolean): Promise<RenameResult> {
    const node = this.nodeMap.get(nodeId)
    if (!node) {
      return {
        symbolId: nodeId,
        symbolName: '',
        newName,
        edits: [],
        summary: { totalEdits: 0, graphEdits: 0, textSearchEdits: 0, filesAffected: 0 },
        dryRun,
      }
    }

    const oldName = node.name
    const { graphEdits, textSearchEdits } = this.findReferencesForRename(nodeId, oldName, newName)

    const allEdits = [...graphEdits, ...textSearchEdits]

    if (!dryRun && allEdits.length > 0) {
      await this.applyEdits(allEdits)
    }

    return {
      symbolId: nodeId,
      symbolName: oldName,
      newName,
      edits: allEdits,
      summary: {
        totalEdits: allEdits.length,
        graphEdits: graphEdits.length,
        textSearchEdits: textSearchEdits.length,
        filesAffected: new Set(allEdits.map(e => e.filePath)).size,
      },
      dryRun,
    }
  }

  private findReferencesForRename(
    nodeId: string,
    oldName: string,
    newName: string,
  ): { graphEdits: RenameEdit[]; textSearchEdits: RenameEdit[] } {
    const node = this.nodeMap.get(nodeId)
    if (!node) return { graphEdits: [], textSearchEdits: [] }

    const REFERENCE_EDGE_TYPES = new Set([
      AuraEdgeType.CALLS,
      AuraEdgeType.IMPORTS,
      AuraEdgeType.EXTENDS,
      AuraEdgeType.IMPLEMENTS,
      AuraEdgeType.DEPENDS_ON,
      AuraEdgeType.TYPEOF,
      AuraEdgeType.TYPE_ALIAS,
      AuraEdgeType.FLOWS_TO,
    ])

    const graphEdits: RenameEdit[] = []
    const filesWithGraphEdits = new Set<string>()

    // Definition edit
    if (node.range) {
      graphEdits.push({
        filePath: node.filePath,
        line: node.range.startLine,
        column: 0,
        oldText: oldName,
        newText: newName,
        confidence: 'graph',
      })
      filesWithGraphEdits.add(node.filePath)
    }

    // Incoming references
    const reverseEdges = this.reverseAdjacency.get(nodeId) ?? []
    for (const { edge } of reverseEdges) {
      if (!REFERENCE_EDGE_TYPES.has(edge.type)) continue
      const sourceNode = this.nodeMap.get(edge.source)
      if (!sourceNode || !sourceNode.range) continue

      graphEdits.push({
        filePath: sourceNode.filePath,
        line: sourceNode.range.startLine,
        column: 0,
        oldText: oldName,
        newText: newName,
        confidence: 'graph',
      })
      filesWithGraphEdits.add(sourceNode.filePath)
    }

    // Text search edits across all files in the graph
    const textSearchEdits: RenameEdit[] = []
    const escapedName = oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const regex = new RegExp(`\\b${escapedName}\\b`, 'g')

    for (const n of this.graphData.nodes) {
      if (n.kind !== AuraNodeKind.File) continue
      if (filesWithGraphEdits.has(n.filePath)) continue

      const absolutePath = path.join(this.projectPath, n.filePath)
      try {
        const content = fsSync.readFileSync(absolutePath, 'utf-8')
        const lines = content.split('\n')
        for (let i = 0; i < lines.length; i++) {
          regex.lastIndex = 0
          let match: RegExpExecArray | null
          while ((match = regex.exec(lines[i])) !== null) {
            textSearchEdits.push({
              filePath: n.filePath,
              line: i + 1,
              column: match.index + 1,
              oldText: oldName,
              newText: newName,
              confidence: 'text_search',
            })
          }
        }
      } catch {
        // Skip unreadable files
      }
    }

    return { graphEdits, textSearchEdits }
  }

  private async applyEdits(edits: RenameEdit[]): Promise<void> {
    // Group edits by file
    const editsByFile = new Map<string, RenameEdit[]>()
    for (const edit of edits) {
      const list = editsByFile.get(edit.filePath) ?? []
      list.push(edit)
      list.push(edit)
      editsByFile.set(edit.filePath, list)
    }

    // Deduplicate: keep one edit per (file, line, column)
    for (const [filePath, fileEdits] of editsByFile) {
      const unique = new Map<string, RenameEdit>()
      for (const edit of fileEdits) {
        const key = `${edit.line}:${edit.column}`
        if (!unique.has(key)) unique.set(key, edit)
      }
      editsByFile.set(filePath, Array.from(unique.values()))
    }

    // Apply edits bottom-to-top within each file to avoid line drift
    for (const [filePath, fileEdits] of editsByFile) {
      const absolutePath = path.join(this.projectPath, filePath)
      let content: string
      try {
        content = await fs.readFile(absolutePath, 'utf-8')
      } catch {
        continue
      }

      const lines = content.split('\n')
      // Sort by line descending, then column descending
      const sorted = [...fileEdits].sort((a, b) => b.line - a.line || b.column - a.column)

      for (const edit of sorted) {
        const lineIdx = edit.line - 1
        if (lineIdx < 0 || lineIdx >= lines.length) continue
        const escapedName = edit.oldText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const regex = new RegExp(`\\b${escapedName}\\b`, 'g')
        lines[lineIdx] = lines[lineIdx].replace(regex, edit.newText)
      }

      await fs.writeFile(absolutePath, lines.join('\n'), 'utf-8')
    }
  }

  // ── API-Aware Tools ─────────────────────────────────────────────────────────

  routeMap(): RouteMapResult {
    const routes = this.graphData.nodes.filter(n => n.kind === AuraNodeKind.Route && (n.metadata as Record<string, unknown> | undefined)?.toolType !== 'mcp')
    const apiCalls = this.graphData.nodes.filter(n => n.kind === AuraNodeKind.ApiCall)
    const apiEdgeTypes = new Set([AuraEdgeType.HANDLES, AuraEdgeType.FETCHES, AuraEdgeType.MIDDLEWARE])
    const edges = this.graphData.edges.filter(e => apiEdgeTypes.has(e.type as AuraEdgeType))
    return { routes, apiCalls, edges }
  }

  toolMap(): McpToolMapResult {
    const tools = this.graphData.nodes.filter(n => n.kind === AuraNodeKind.Route && (n.metadata as Record<string, unknown> | undefined)?.toolType === 'mcp')
    const handleEdges = this.graphData.edges.filter(e => e.type === AuraEdgeType.HANDLES && tools.some(t => t.id === e.target))
    return { tools, edges: handleEdges }
  }

  shapeCheck(routeId: string): ShapeCheckResult | null {
    const route = this.nodeMap.get(routeId)
    if (!route || route.kind !== AuraNodeKind.Route) return null

    const meta = route.metadata as Record<string, unknown> | undefined
    const responseShape = (meta?.responseShape as ResponseShapeField[] | undefined) ?? []
    const routePath = (meta?.path as string) ?? route.name
    const routeMethod = (meta?.method as string) ?? 'GET'

    // Find consumers via FETCHES edges targeting this route
    const consumers: ShapeConsumer[] = []
    const reverseEdges = this.reverseAdjacency.get(routeId) ?? []
    const fetchesEdges = reverseEdges.filter(e => e.edge.type === AuraEdgeType.FETCHES)

    for (const { edge, neighbor } of fetchesEdges) {
      const consumerMeta = neighbor.metadata as Record<string, unknown> | undefined
      const accessedFields = (consumerMeta?.accessedFields as string[] | undefined) ?? []
      consumers.push({
        nodeId: neighbor.id,
        name: neighbor.name,
        kind: neighbor.kind,
        filePath: neighbor.filePath,
        accessedFields,
        confidence: edge.confidence,
      })
    }

    // Compare consumer fields against response shape
    const responseKeys = new Set(responseShape.map(f => f.key))
    const mismatches: ShapeMismatch[] = []

    for (const consumer of consumers) {
      for (const field of consumer.accessedFields) {
        if (!responseKeys.has(field)) {
          const existing = mismatches.find(m => m.field === field)
          if (existing) {
            existing.accessedBy.push(consumer.nodeId)
          } else {
            mismatches.push({
              field,
              accessedBy: [consumer.nodeId],
              kind: 'missing_from_response',
              description: `Field "${field}" is accessed by ${consumer.name} but not found in the route's response shape`,
            })
          }
        }
      }
    }

    const status: ShapeCheckResult['status'] = responseShape.length === 0
      ? 'unknown'
      : mismatches.length > 0
        ? 'mismatch'
        : 'ok'

    return {
      routeId,
      routePath,
      routeMethod,
      responseShape,
      consumers,
      mismatches,
      status,
    }
  }

  apiImpact(routeId: string): ApiImpactResult | null {
    const route = this.nodeMap.get(routeId)
    if (!route || route.kind !== AuraNodeKind.Route) return null

    const meta = route.metadata as Record<string, unknown> | undefined
    const responseShape = (meta?.responseShape as ResponseShapeField[] | undefined) ?? []

    // Get shape check results
    const shapeCheck = this.shapeCheck(routeId)

    // Get impact analysis using existing method
    const downstreamImpact = this.impact(routeId)

    // Collect consumers via FETCHES edges
    const consumers: ApiImpactResult['consumers'] = []
    const reverseEdges = this.reverseAdjacency.get(routeId) ?? []
    for (const { edge, neighbor } of reverseEdges) {
      if (edge.type === AuraEdgeType.FETCHES) {
        const consumerMeta = neighbor.metadata as Record<string, unknown> | undefined
        const accessedFields = (consumerMeta?.accessedFields as string[] | undefined) ?? []
        consumers.push({
          nodeId: neighbor.id,
          name: neighbor.name,
          kind: neighbor.kind,
          filePath: neighbor.filePath,
          accessedFields,
        })
      }
    }

    // Collect middleware via MIDDLEWARE edges
    const middleware: RouteMiddleware[] = []
    for (const { edge, neighbor } of reverseEdges) {
      if (edge.type === AuraEdgeType.MIDDLEWARE) {
        middleware.push({
          name: neighbor.name,
          filePath: neighbor.filePath,
          range: neighbor.range ?? undefined,
        })
      }
    }

    // Determine risk level
    const riskFactors: string[] = []
    let riskLevel: ApiImpactResult['riskLevel'] = 'low'

    if (shapeCheck && shapeCheck.mismatches.length > 0) {
      riskLevel = 'critical'
      riskFactors.push(`${shapeCheck.mismatches.length} field mismatch(es) between response shape and consumer access`)
    }

    if (riskLevel !== 'critical' && consumers.length >= 3) {
      riskLevel = 'high'
      riskFactors.push(`${consumers.length} consumers depend on this route`)
    }

    if (downstreamImpact) {
      const maxDownstream = downstreamImpact.downstream.summary
      if (maxDownstream.critical > 0) {
        if (riskLevel === 'low') riskLevel = 'high'
        riskFactors.push(`${maxDownstream.critical} critical downstream dependencies`)
      }
    }

    if (riskLevel === 'low' && consumers.length > 0) {
      riskLevel = 'medium'
      riskFactors.push(`${consumers.length} consumer(s) of this route`)
    }

    if (riskFactors.length === 0) {
      riskFactors.push('No consumers found for this route')
    }

    return {
      routeId,
      route: route,
      consumers,
      responseShape,
      shapeCheck,
      downstreamImpact,
      middleware,
      riskLevel,
      riskFactors,
    }
  }
}