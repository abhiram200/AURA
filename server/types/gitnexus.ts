// server/types/gitnexus.ts

export type IndexingStatus =
  | { status: 'idle' }
  | { status: 'indexing'; phase: string; percent: number }
  | { status: 'ready'; stats: { files: number; nodes: number; edges: number; clusters: number } }
  | { status: 'error'; error: string }

export interface DependencyNode {
  id: string
  label: string
  type: string // 'file' | 'module' | 'function' | 'class'
  cluster?: string
  filePath?: string
}

export interface DependencyEdge {
  source: string
  target: string
  type: string // 'imports' | 'calls' | 'extends' | 'implements'
}

export interface Cluster {
  name: string
  color: string
  members: string[]
}

export interface GraphData {
  nodes: DependencyNode[]
  edges: DependencyEdge[]
  clusters: Cluster[]
}

export interface NodeContext {
  name: string
  kind: string
  filePath: string
  cluster: string | null
  imports: string[]
  importedBy: string[]
  calls: string[]
  calledBy: string[]
  processes: string[]
}

export interface ImpactResult {
  target: string
  direct: number
  transitive: number
  affectedFiles: string[]
  affectedProcesses: string[]
}