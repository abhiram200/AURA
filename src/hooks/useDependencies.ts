import { useState, useEffect, useCallback, useRef } from 'react'

export interface DependencyNode {
  id: string
  label: string
  type: string
  cluster?: string
  filePath?: string
}

export interface DependencyEdge {
  source: string
  target: string
  type: string
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

export type IndexingStatus =
  | { status: 'idle' }
  | { status: 'indexing'; phase: string; percent: number }
  | { status: 'ready'; stats: { files: number; nodes: number; edges: number; clusters: number } }
  | { status: 'error'; error: string }

export function useDependencies(projectId: string) {
  const [indexingStatus, setIndexingStatus] = useState<IndexingStatus>({ status: 'idle' })
  const [installed, setInstalled] = useState<boolean | null>(null)
  const [graphData, setGraphData] = useState<GraphData | null>(null)
  const [selectedNode, setSelectedNode] = useState<DependencyNode | null>(null)
  const [nodeContext, setNodeContext] = useState<NodeContext | null>(null)
  const [error, setError] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    const checkInstalled = async () => {
      try {
        const res = await fetch(`/api/dependencies/${projectId}/installed`)
        if (res.ok) {
          const data = await res.json()
          setInstalled(data.installed)
        } else {
          setInstalled(false)
        }
      } catch {
        setInstalled(false)
      }
    }
    checkInstalled()
  }, [projectId])

  useEffect(() => {
    if (indexingStatus.status === 'indexing') {
      pollRef.current = setInterval(async () => {
        try {
          const res = await fetch(`/api/dependencies/${projectId}/status`)
          if (res.ok) {
            const status = await res.json()
            setIndexingStatus(status)
          }
        } catch {
          // Continue polling
        }
      }, 2000)
    } else {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    }
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    }
  }, [indexingStatus.status, projectId])

  useEffect(() => {
    if (indexingStatus.status === 'ready' && !graphData) {
      fetchGraph()
    }
  }, [indexingStatus.status])

  useEffect(() => {
    if (installed === true && indexingStatus.status === 'idle') {
      triggerIndex()
    }
  }, [installed])

  const triggerIndex = useCallback(async () => {
    try {
      setError(null)
      setIndexingStatus({ status: 'indexing', phase: 'scanning', percent: 0 })
      const res = await fetch(`/api/dependencies/${projectId}/index`, { method: 'POST' })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to start indexing')
      }
    } catch (err: any) {
      setError(err.message)
      setIndexingStatus({ status: 'error', error: err.message })
    }
  }, [projectId])

  const fetchGraph = useCallback(async () => {
    try {
      setError(null)
      const res = await fetch(`/api/dependencies/${projectId}/graph`)
      if (res.ok) {
        const data = await res.json()
        setGraphData(data)
      } else {
        const data = await res.json()
        setError(data.error || 'Failed to fetch graph')
      }
    } catch (err: any) {
      setError(err.message)
    }
  }, [projectId])

  const selectNode = useCallback(async (nodeId: string) => {
    if (!graphData) return
    const node = graphData.nodes.find((n) => n.id === nodeId)
    if (!node) return
    setSelectedNode(node)

    try {
      const filePath = node.filePath ?? node.id
      const params = new URLSearchParams({ file: filePath })
      if (node.label && node.type !== 'file') params.set('name', node.label)
      const res = await fetch(`/api/dependencies/${projectId}/context?${params}`)
      if (res.ok) {
        const context = await res.json()
        setNodeContext(context)
      }
    } catch {
      // Context fetch failed
    }
  }, [graphData, projectId])

  const refreshGraph = useCallback(async () => {
    setGraphData(null)
    await fetchGraph()
  }, [fetchGraph])

  const searchNodes = useCallback((query: string): DependencyNode[] => {
    if (!graphData || !query.trim()) return graphData?.nodes ?? []
    const lower = query.toLowerCase()
    return graphData.nodes.filter(
      (n) => n.label.toLowerCase().includes(lower) || n.filePath?.toLowerCase().includes(lower)
    )
  }, [graphData])

  return {
    installed,
    indexingStatus,
    graphData,
    selectedNode,
    nodeContext,
    selectNode,
    triggerIndex,
    refreshGraph,
    searchNodes,
    error,
  }
}