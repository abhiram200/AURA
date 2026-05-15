export enum AuraNodeKind {
  File = 'File',
  Folder = 'Folder',
  Function = 'Function',
  Class = 'Class',
  Interface = 'Interface',
  TypeAlias = 'TypeAlias',
  Method = 'Method',
  Variable = 'Variable',
  Route = 'Route',
  ApiCall = 'ApiCall',
  Process = 'Process',
}

export enum AuraEdgeType {
  CONTAINS = 'CONTAINS',
  IMPORTS = 'IMPORTS',
  CALLS = 'CALLS',
  EXTENDS = 'EXTENDS',
  IMPLEMENTS = 'IMPLEMENTS',
  HAS_METHOD = 'HAS_METHOD',
  HAS_PROPERTY = 'HAS_PROPERTY',
  DEPENDS_ON = 'DEPENDS_ON',
  TYPEOF = 'TYPEOF',
  TYPE_ALIAS = 'TYPE_ALIAS',
  FLOWS_TO = 'FLOWS_TO',
  HANDLES = 'HANDLES',
  FETCHES = 'FETCHES',
  MIDDLEWARE = 'MIDDLEWARE',
  STEP_IN_PROCESS = 'STEP_IN_PROCESS',
}

export interface AuraNode {
  id: string // "src/hooks/useChat:useChat" or "src/index.ts"
  kind: AuraNodeKind
  name: string // Symbol name or file/folder name
  filePath: string // Relative path from project root
  range?: { startLine: number; endLine: number }
  exported: boolean
  metadata?: Record<string, unknown>
}

export interface AuraEdge {
  source: string // Node id
  target: string // Node id
  type: AuraEdgeType
  confidence: number // 0.0 - 1.0
  metadata?: Record<string, unknown>
}

export interface GraphData {
  nodes: AuraNode[]
  edges: AuraEdge[]
}

export type IndexingPhase =
  | 'idle'
  | 'scanning'
  | 'parsing'
  | 'resolving'
  | 'typeResolving'
  | 'aggregating'
  | 'apiAnalysis'
  | 'processTracing'
  | 'searchIndexing'
  | 'saving'
  | 'watching'
  | 'complete'
  | 'error'

export interface IndexingStatus {
  phase: IndexingPhase
  progress: number
  filesProcessed: number
  totalFiles: number
  nodesFound: number
  edgesFound: number
  message: string
  error?: string
}

// ── Phase-weighted progress config ──────────────────────────────────────────────

export interface IndexingPhaseConfig {
  phase: Exclude<IndexingPhase, 'idle' | 'complete' | 'watching' | 'error'>
  weight: number
  label: string
}

export const INDEXING_PHASE_CONFIG: readonly IndexingPhaseConfig[] = [
  { phase: 'scanning',       weight: 2, label: 'Scanning files' },
  { phase: 'parsing',        weight: 8, label: 'Parsing source code' },
  { phase: 'resolving',      weight: 2, label: 'Resolving imports' },
  { phase: 'typeResolving',  weight: 2, label: 'Resolving types' },
  { phase: 'aggregating',    weight: 1, label: 'Building dependencies' },
  { phase: 'apiAnalysis',    weight: 1, label: 'Analyzing API routes' },
  { phase: 'processTracing', weight: 1, label: 'Tracing execution flows' },
  { phase: 'searchIndexing', weight: 10, label: 'Building search index' },
  { phase: 'saving',         weight: 1, label: 'Saving graph' },
] as const

export function computeProgress(phase: IndexingPhase, subProgress: number = 0): number {
  if (phase === 'error') return 0
  if (phase === 'watching' || phase === 'complete') return 1.0
  if (phase === 'idle') return 0

  const totalWeight = INDEXING_PHASE_CONFIG.reduce((sum, p) => sum + p.weight, 0)
  let cumulativeWeight = 0
  let phaseWeight = 0

  for (const entry of INDEXING_PHASE_CONFIG) {
    if (entry.phase === phase) {
      phaseWeight = entry.weight
      break
    }
    cumulativeWeight += entry.weight
  }

  if (phaseWeight === 0) return 0

  const phaseStart = cumulativeWeight / totalWeight
  const phaseEnd = (cumulativeWeight + phaseWeight) / totalWeight
  const clamped = Math.max(0, Math.min(1, subProgress))

  return phaseStart + (phaseEnd - phaseStart) * clamped
}

export interface TraceStep {
  id: string
  name: string
  kind: AuraNodeKind
  edgeType: AuraEdgeType
  filePath?: string
}

export interface SymbolImpact {
  id: string
  name: string
  kind: AuraNodeKind
  score: number
  severity: 'critical' | 'moderate' | 'low'
  tracePath: TraceStep[]
  range?: { startLine: number; endLine: number }
}

export interface FileImpact {
  filePath: string
  severity: 'critical' | 'moderate' | 'low'
  score: number
  symbols: SymbolImpact[]
}

export interface DirectionResult {
  files: FileImpact[]
  summary: {
    totalFiles: number
    critical: number
    moderate: number
    low: number
  }
}

export interface ImpactResult {
  target: string
  downstream: DirectionResult
  upstream: DirectionResult
}

export interface NodeContext {
  node: AuraNode
  incoming: { node: AuraNode; edgeType: AuraEdgeType }[]
  outgoing: { node: AuraNode; edgeType: AuraEdgeType }[]
  members: AuraNode[]
  containedBy: AuraNode | null
  hierarchy: { node: AuraNode; relation: string }[]
}

export type SearchMode = 'hybrid' | 'bm25' | 'basic'

export interface SearchResult {
  node: AuraNode
  score: number
  mode?: SearchMode
  bm25Score?: number
  semanticScore?: number
}

// ── BM25 / Semantic Search types ──────────────────────────────────────────────

export interface BM25IndexData {
  version: number
  corpusSize: number
  avgDocLength: number
  docLengths: Record<string, number>
  terms: Record<string, { idf: number; postings: Array<{ docId: string; tf: number }> }>
}

export interface EmbeddingStoreData {
  version: number
  model: string
  dimension: number
  generatedAt: string
  ollamaWasAvailable: boolean
  embeddings: Record<string, number[]>
}

// ── AI Context Files types ────────────────────────────────────────────────────

export interface FolderContextData {
  folderPath: string
  files: Array<{
    filePath: string
    name: string
    exported: boolean
    kind: string
    symbols: Array<{ name: string; kind: string; exported: boolean }>
  }>
  importsFrom: string[]
  importsTo: string[]
  dependsOn: string[]
  dependedBy: string[]
  keyTypes: Array<{ name: string; kind: string; exported: boolean }>
  routes: Array<{ method: string; path: string; handler: string }>
  apiCalls: Array<{ method: string; url: string; caller: string }>
  symbolCount: number
  edgeCount: number
}

export interface ProjectContextData {
  folders: Array<{
    path: string
    fileCount: number
    symbolCount: number
    exportsCount: number
    role: string
  }>
  folderDependencies: Array<{ from: string; to: string; type: 'imports' | 'depends_on' }>
  totalFiles: number
  totalSymbols: number
  totalEdges: number
  totalRoutes: number
  totalApiCalls: number
  entryPoints: Array<{ filePath: string; name: string; kind: string }>
  techStack: string[]
  keyExportedTypes: Array<{ name: string; kind: string; folder: string }>
}

export interface ContextManifest {
  version: number
  generatedAt: string
  ollamaWasAvailable: boolean
  model: string
  folders: Record<string, {
    contextFile: string
    generatedAt: string
    fileHashes: Record<string, string>
  }>
}

export interface FileHashEntry {
  hash: string
  mtime: number
}

export interface AuraMeta {
  indexedAt: string
  lastCommit: string | null
  fileHashes: Record<string, FileHashEntry>
  stats: {
    totalFiles: number
    totalNodes: number
    totalEdges: number
    nodesByKind: Record<string, number>
    edgesByType: Record<string, number>
  }
}

// ── detect_changes types ────────────────────────────────────────────────────

export type GitDiffScope = 'unstaged' | 'staged' | 'all' | 'compare'

export interface GitDiffOptions {
  scope: GitDiffScope
  base?: string
  head?: string
}

export interface HunkRange {
  startLine: number
  endLine: number
}

export interface FileDiff {
  filePath: string
  status: 'added' | 'modified' | 'deleted' | 'renamed'
  hunks: HunkRange[]
  oldFilePath?: string
}

export interface ChangedSymbol {
  nodeId: string
  name: string
  kind: AuraNodeKind
  filePath: string
  range?: { startLine: number; endLine: number }
  changeType: 'modified' | 'added' | 'deleted'
  hunks: HunkRange[]
}

export interface ChangeDetectionResult {
  files: FileDiff[]
  changedSymbols: ChangedSymbol[]
  impact: ImpactResult | null
  summary: {
    totalFiles: number
    totalSymbols: number
    criticalFiles: number
    moderateFiles: number
    lowFiles: number
  }
}

// ── rename types ─────────────────────────────────────────────────────────────

export type RenameConfidence = 'graph' | 'text_search'

export interface RenameEdit {
  filePath: string
  line: number
  column: number
  oldText: string
  newText: string
  confidence: RenameConfidence
}

export interface RenameResult {
  symbolId: string
  symbolName: string
  newName: string
  edits: RenameEdit[]
  summary: {
    totalEdits: number
    graphEdits: number
    textSearchEdits: number
    filesAffected: number
  }
  dryRun: boolean
}

// ── API-aware tools types ─────────────────────────────────────────────────────

export interface RouteMiddleware {
  name: string
  filePath: string
  range?: { startLine: number; endLine: number }
}

export interface RouteMapResult {
  routes: AuraNode[]
  apiCalls: AuraNode[]
  edges: AuraEdge[]
  handlerNodes: AuraNode[]
}

export interface McpToolMapResult {
  tools: AuraNode[]
  edges: AuraEdge[]
}

export interface ResponseShapeField {
  key: string
  valueType: string
  source: 'response_literal' | 'return_type' | 'res_json' | 'inferred'
  confidence: number
}

export interface ShapeConsumer {
  nodeId: string
  name: string
  kind: string
  filePath: string
  accessedFields: string[]
  confidence: number
}

export interface ShapeMismatch {
  field: string
  accessedBy: string[]
  kind: 'missing_from_response' | 'type_mismatch' | 'possibly_null'
  description: string
}

export interface ShapeCheckResult {
  routeId: string
  routePath: string
  routeMethod: string
  responseShape: ResponseShapeField[]
  consumers: ShapeConsumer[]
  mismatches: ShapeMismatch[]
  status: 'ok' | 'mismatch' | 'unknown'
}

export interface ApiImpactResult {
  routeId: string
  route: AuraNode
  consumers: { nodeId: string; name: string; kind: string; filePath: string; accessedFields: string[] }[]
  responseShape: ResponseShapeField[]
  shapeCheck: ShapeCheckResult | null
  downstreamImpact: ImpactResult | null
  middleware: RouteMiddleware[]
  riskLevel: 'low' | 'medium' | 'high' | 'critical'
  riskFactors: string[]
}

// ── Process Tracing types ────────────────────────────────────────────────────

export interface ProcessInfo {
  id: string
  name: string
  method: string
  path: string
  stepCount: number
  entryRouteId: string
}

export interface ProcessStep {
  order: number
  label: string
  nodeId: string
  name: string
  kind: string
}

export interface ProcessDetail {
  id: string
  name: string
  steps: ProcessStep[]
}

// ── Group types ───────────────────────────────────────────────────────────────

export interface Group {
  id: string
  name: string
  description: string
  memberProjectIds: string[]
  createdAt: string
  updatedAt: string
}

export interface HttpContract {
  id: string
  providerProjectId: string
  method: string
  path: string
  pathPattern: string
  responseShape: ResponseShapeField[]
  consumerProjectId: string | null
  consumerNodeId: string | null
  sourceRouteNodeId: string | null
  matched: boolean
  matchConfidence: number
}

export interface CrossProjectEdge {
  sourceProjectId: string
  sourceNodeId: string
  targetProjectId: string
  targetNodeId: string
  edgeType: AuraEdgeType
  confidence: number
  metadata?: Record<string, unknown>
}

export interface ContractRegistry {
  groupId: string
  contracts: HttpContract[]
  crossProjectEdges: CrossProjectEdge[]
  syncedAt: string
  stats: {
    totalContracts: number
    matchedContracts: number
    unmatchedContracts: number
    crossProjectEdges: number
  }
}

export interface GroupQueryResult {
  results: Array<{
    projectId: string
    projectName: string
    node: AuraNode
    score: number
    rank: number
  }>
  mergedScore: number
}

export interface GroupImpactResult {
  target: { projectId: string; nodeId: string; nodeName: string; nodeKind: string }
  downstream: {
    withinProject: ImpactResult
    crossProject: Array<{
      targetProjectId: string
      sourceProjectId: string
      edge: CrossProjectEdge
      downstream: DirectionResult
    }>
  }
  upstream: {
    withinProject: ImpactResult
    crossProject: Array<{
      targetProjectId: string
      sourceProjectId: string
      edge: CrossProjectEdge
      upstream: DirectionResult
    }>
  }
}

export interface GroupContextResult {
  target: { projectId: string; node: AuraNode }
  memberResults: Array<{
    projectId: string
    projectName: string
    context: NodeContext | null
  }>
  crossProjectReferences: Array<{
    sourceProjectId: string
    sourceNodeId: string
    sourceNodeName: string
    targetProjectId: string
    targetNodeId: string
    edgeType: AuraEdgeType
    confidence: number
  }>
}

export interface GroupStatusResult {
  groupId: string
  groupName: string
  members: Array<{
    projectId: string
    projectName: string
    indexed: boolean
    lastIndexedAt: string | null
    nodeCount: number
    edgeCount: number
    stale: boolean
  }>
  contractRegistry: {
    synced: boolean
    syncedAt: string | null
    totalContracts: number
    matchedContracts: number
    stale: boolean
  }
}