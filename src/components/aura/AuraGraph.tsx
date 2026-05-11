import { useState, useCallback } from 'react'
import type { AuraNodeData, AuraEdgeData } from '../../hooks/useAura'
import { GraphScene } from './GraphScene'
import { OptimizingIndicator } from './OptimizingIndicator'

interface AuraGraphProps {
  nodes: AuraNodeData[]
  edges: AuraEdgeData[]
  selectedNodeId: string | null
  onNodeClick: (node: AuraNodeData | null) => void
  onNodeHover: (node: AuraNodeData | null) => void
  nodeFilters: Set<string>
  edgeFilters: Set<string>
  isLightMode?: boolean
}

export function AuraGraph({
  nodes,
  edges,
  selectedNodeId,
  onNodeClick,
  onNodeHover,
  nodeFilters,
  edgeFilters,
  isLightMode = false,
}: AuraGraphProps) {
  const [isStable, setIsStable] = useState(false)

  const handleStableChange = useCallback((stable: boolean) => {
    setIsStable(stable)
  }, [])

  const handleNodeHover = useCallback((node: AuraNodeData | null) => {
    onNodeHover(node)
  }, [onNodeHover])

  if (nodes.length === 0) return null

  return (
    <div className="aura-graph-wrapper" style={{ position: 'relative' }}>
      <GraphScene
        nodes={nodes}
        edges={edges}
        viewMode="file"
        selectedNodeId={selectedNodeId}
        nodeFilters={nodeFilters}
        edgeFilters={edgeFilters}
        onNodeClick={onNodeClick}
        onNodeHover={handleNodeHover}
        onStableChange={handleStableChange}
        isLightMode={isLightMode}
      />
      <OptimizingIndicator visible={!isStable} />
    </div>
  )
}