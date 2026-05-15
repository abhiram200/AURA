export enum SynapseNodeKind {
  File = 'File',
  Folder = 'Folder',
  Function = 'Function',
  Class = 'Class',
  Interface = 'Interface',
  TypeAlias = 'TypeAlias',
  Method = 'Method',
  Variable = 'Variable',
}

export enum SynapseEdgeType {
  CONTAINS = 'CONTAINS',
  IMPORTS = 'IMPORTS',
  CALLS = 'CALLS',
  EXTENDS = 'EXTENDS',
  IMPLEMENTS = 'IMPLEMENTS',
  HAS_METHOD = 'HAS_METHOD',
  HAS_PROPERTY = 'HAS_PROPERTY',
  DEPENDS_ON = 'DEPENDS_ON',
}

export interface SynapseNode {
  id: string // "src/hooks/useChat:useChat" or "src/index.ts"
  kind: SynapseNodeKind
  name: string // Symbol name or file/folder name
  filePath: string // Relative path from project root
  range?: { startLine: number; endLine: number }
  exported: boolean
  metadata?: Record<string, unknown>
}

export interface SynapseEdge {
  source: string // Node id
  target: string // Node id
  type: SynapseEdgeType
  confidence: number // 0.0 - 1.0
  metadata?: Record<string, unknown>
}

export interface GraphData {
  nodes: SynapseNode[]
  edges: SynapseEdge[]
}

export type IndexingPhase =
  | 'idle'
  | 'scanning'
  | 'parsing'
  | 'resolving'
  | 'aggregating'
  | 'saving'
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

export interface ImpactLevel {
  depth: number
  label: string
  nodes: ImpactNode[]
}

export interface ImpactNode {
  id: string
  name: string
  kind: SynapseNodeKind
  filePath: string
  edgeType: SynapseEdgeType
  confidence: number
}

export interface ImpactResult {
  target: string
  direction: 'downstream' | 'upstream'
  levels: ImpactLevel[]
}

export interface NodeContext {
  node: SynapseNode
  incoming: { node: SynapseNode; edgeType: SynapseEdgeType }[]
  outgoing: { node: SynapseNode; edgeType: SynapseEdgeType }[]
  members: SynapseNode[]
  hierarchy: { node: SynapseNode; relation: string }[]
}

export interface SearchResult {
  node: SynapseNode
  score: number
}

export interface SynapseMeta {
  indexedAt: string
  lastCommit: string | null
  stats: {
    totalFiles: number
    totalNodes: number
    totalEdges: number
    nodesByKind: Record<string, number>
    edgesByType: Record<string, number>
  }
}