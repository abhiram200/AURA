import { useEffect, useRef, useCallback } from 'react'
import Graph from 'graphology'
import forceAtlas2 from 'graphology-layout-forceatlas2'
import Sigma from 'sigma/sigma'
import type { DependencyNode, DependencyEdge, Cluster } from '../../hooks/useDependencies'

const CLUSTER_PALETTE = [
  '#6c63ff', '#ff6b6b', '#4ecdc4', '#ffd93d', '#f093fb',
  '#45b7d1', '#96ceb4', '#ff8a5c', '#a29bfe', '#fd79a8',
]

interface DepGraphProps {
  nodes: DependencyNode[]
  edges: DependencyEdge[]
  clusters: Cluster[]
  selectedNodeId: string | null
  onNodeClick: (nodeId: string) => void
  clusterFilter: string | null
  edgeFilter: string | null
  searchResults: Set<string> | null
}

export function DepGraph({
  nodes,
  edges,
  clusters,
  selectedNodeId,
  onNodeClick,
  clusterFilter,
  edgeFilter,
  searchResults,
}: DepGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const sigmaRef = useRef<Sigma | null>(null)
  const graphRef = useRef<Graph | null>(null)

  const getClusterColor = useCallback(
    (clusterName?: string): string => {
      if (!clusterName) return '#666666'
      const idx = clusters.findIndex((c) => c.name === clusterName)
      return CLUSTER_PALETTE[idx % CLUSTER_PALETTE.length] ?? '#666666'
    },
    [clusters]
  )

  useEffect(() => {
    if (!containerRef.current || nodes.length === 0) return

    if (sigmaRef.current) {
      sigmaRef.current.kill()
      sigmaRef.current = null
    }

    const graph = new Graph()

    const clusterColorMap = new Map<string, string>()
    clusters.forEach((c, i) => {
      clusterColorMap.set(c.name, CLUSTER_PALETTE[i % CLUSTER_PALETTE.length])
    })

    for (const node of nodes) {
      if (clusterFilter && node.cluster !== clusterFilter) continue

      const isSelected = node.id === selectedNodeId
      const isInSearch = searchResults ? searchResults.has(node.id) : true
      const color = clusterColorMap.get(node.cluster ?? '') ?? '#666666'

      graph.addNode(node.id, {
        x: Math.random() * 100,
        y: Math.random() * 100,
        size: isSelected ? 15 : isInSearch ? 8 : 5,
        label: node.label,
        color: isSelected ? '#ffffff' : isInSearch ? color : `${color}44`,
        originalColor: color,
        cluster: node.cluster ?? '',
        filePath: node.filePath ?? '',
        nodeType: node.type,
      })
    }

    for (const edge of edges) {
      if (edgeFilter && edge.type !== edgeFilter) continue
      if (!graph.hasNode(edge.source) || !graph.hasNode(edge.target)) continue

      const isSelectedEdge =
        selectedNodeId === edge.source || selectedNodeId === edge.target

      graph.addEdge(edge.source, edge.target, {
        type: edge.type,
        color: isSelectedEdge ? '#ffffff88' : '#ffffff22',
        size: isSelectedEdge ? 2 : 1,
      })
    }

    const settings = forceAtlas2.inferSettings(graph)
    forceAtlas2.assign(graph, {
      iterations: 100,
      settings,
    })

    const sigma = new Sigma(graph, containerRef.current, {
      renderLabels: true,
      labelFont: 'Inter, sans-serif',
      labelSize: 12,
      labelWeight: '500',
      labelRenderedSizeThreshold: 6,
      defaultEdgeColor: '#ffffff22',
      defaultNodeColor: '#6c63ff',
    })

    sigma.on('clickNode', ({ node }) => {
      onNodeClick(node)
    })

    sigmaRef.current = sigma
    graphRef.current = graph

    return () => {
      sigma.kill()
      sigmaRef.current = null
      graphRef.current = null
    }
  }, [nodes, edges, clusters, selectedNodeId, clusterFilter, edgeFilter, searchResults, onNodeClick, getClusterColor])

  return <div ref={containerRef} className="dep-graph__container" />
}