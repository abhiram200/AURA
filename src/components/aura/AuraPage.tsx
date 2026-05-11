import { useState, useCallback } from 'react'
import type { AuraNodeData, AuraGraphData, AuraIndexingStatus, AuraNodeContext, AuraImpactResult, AuraSearchResult } from '../../hooks/useAura'
import { AuraPanel } from './AuraPanel'
import { AuraToolbar } from './AuraToolbar'
import { AuraGraph } from './AuraGraph'
import { AuraProgress } from './AuraProgress'

// ── Constants ──────────────────────────────────────────────────────────────────

const ALL_NODE_KINDS = new Set(['File', 'Folder', 'Function', 'Class', 'Interface', 'Method', 'Variable'])
const ALL_EDGE_TYPES = new Set(['IMPORTS', 'CALLS', 'EXTENDS', 'IMPLEMENTS', 'CONTAINS', 'DEPENDS_ON', 'HAS_METHOD', 'HAS_PROPERTY', 'TYPEOF', 'TYPE_ALIAS', 'FLOWS_TO'])

// ── Props ──────────────────────────────────────────────────────────────────────

interface AuraPageProps {
  projectId: string
  projectName: string
  workspacePath: string
  onFileOpen?: (filePath: string, startLine?: number) => void
  graphData: AuraGraphData | null
  indexingStatus: AuraIndexingStatus | null
  selectedNode: AuraNodeData | null
  nodeContext: AuraNodeContext | null
  impactResult: AuraImpactResult | null
  loading: boolean
  error: string | null
  searchResults: AuraSearchResult[]
  startIndexing: (projectId: string) => void
  search: (query: string, options?: { limit?: number; kinds?: string[] }) => void
  selectNode: (node: AuraNodeData | null) => void
  isLightMode?: boolean
}

// ── Component ───────────────────────────────────────────────────────────────────

export function AuraPage({
  projectId,
  onFileOpen,
  graphData,
  indexingStatus,
  selectedNode,
  nodeContext,
  impactResult,
  loading,
  error,
  searchResults,
  startIndexing,
  search,
  selectNode,
  isLightMode = false,
}: AuraPageProps) {
  const [nodeFilters, setNodeFilters] = useState<Set<string>>(new Set(ALL_NODE_KINDS))
  const [edgeFilters, setEdgeFilters] = useState<Set<string>>(new Set(ALL_EDGE_TYPES))
  const [hoveredNode, setHoveredNode] = useState<AuraNodeData | null>(null)

  const handleNodeClick = useCallback((node: AuraNodeData | null) => {
    selectNode(node)
  }, [selectNode])

  const handleNodeHover = useCallback((node: AuraNodeData | null) => {
    setHoveredNode(node)
  }, [])

  const handleClosePanel = useCallback(() => {
    selectNode(null)
  }, [selectNode])

  const handleReindex = useCallback(() => {
    startIndexing(projectId)
  }, [startIndexing, projectId])

  const handleSearch = useCallback((query: string, options?: { limit?: number; kinds?: string[] }) => {
    search(query, options)
  }, [search])

  const handleSearchResultClick = useCallback((node: AuraNodeData) => {
    selectNode(node)
  }, [selectNode])

  // Empty state — no data and not loading
  if (!graphData && !loading && !indexingStatus) {
    return (
      <div className="aura-page">
        <div className="aura-page__empty">
          <div className="aura-page__empty-brand">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="2" />
              <circle cx="6" cy="6" r="2" />
              <circle cx="18" cy="6" r="2" />
              <circle cx="6" cy="18" r="2" />
              <circle cx="18" cy="18" r="2" />
              <line x1="12" y1="10" x2="7" y2="7.4" />
              <line x1="12" y1="10" x2="17" y2="7.4" />
              <line x1="12" y1="14" x2="7" y2="16.6" />
              <line x1="12" y1="14" x2="17" y2="16.6" />
            </svg>
            <h2>AURA</h2>
            <p>Code intelligence for your project</p>
          </div>
          {error && <div className="aura-page__error">{error}</div>}
          <button className="aura-page__index-btn" onClick={handleReindex}>
            Index Project
          </button>
        </div>
      </div>
    )
  }

  const nodes = graphData?.nodes ?? []
  const edges = graphData?.edges ?? []

  return (
    <div className="aura-page">
      <AuraToolbar
        nodeCount={nodes.length}
        edgeCount={edges.length}
        nodeFilters={nodeFilters}
        edgeFilters={edgeFilters}
        onNodeFilterChange={setNodeFilters}
        onEdgeFilterChange={setEdgeFilters}
        onSearch={handleSearch}
        onSearchResultClick={handleSearchResultClick}
        searchResults={searchResults}
        onReindex={handleReindex}
        isIndexing={loading}
      />

      {loading && !graphData ? (
        <div className="aura-page__loading">
          <div className="aura-page__loading-spinner" />
          <span>Loading graph...</span>
        </div>
      ) : (
        <div className="aura-page__content">
          <div className="aura-page__side-panel">
            <AuraPanel
              selectedNode={selectedNode}
              nodeContext={nodeContext}
              impactResult={impactResult}
              onClose={handleClosePanel}
              onFileOpen={onFileOpen}
            />
          </div>

          <div className="aura-graph-wrapper">
            <AuraGraph
              nodes={nodes}
              edges={edges}
              selectedNodeId={selectedNode?.id ?? null}
              onNodeClick={handleNodeClick}
              onNodeHover={handleNodeHover}
              nodeFilters={nodeFilters}
              edgeFilters={edgeFilters}
              isLightMode={isLightMode}
            />
          </div>
        </div>
      )}

      <AuraProgress status={indexingStatus} />

      {/* Hover tooltip */}
      {hoveredNode && (
        <div className="aura-tooltip">
          <div className="aura-tooltip__name">{hoveredNode.name}</div>
          <div className="aura-tooltip__path">{hoveredNode.filePath}</div>
          <div className="aura-tooltip__kind">{hoveredNode.kind}</div>
        </div>
      )}

      {error && !graphData && (
        <div className="aura-page__error-bar">{error}</div>
      )}
    </div>
  )
}