import { useState } from 'react'
import type { Cluster } from '../../hooks/useDependencies'

interface DepToolbarProps {
  nodeCount: number
  edgeCount: number
  clusters: Cluster[]
  onSearch: (query: string) => void
  onClusterFilter: (cluster: string | null) => void
  onEdgeFilter: (edgeType: string | null) => void
  onRefresh: () => void
  onReindex: () => void
}

export function DepToolbar({
  nodeCount,
  edgeCount,
  clusters,
  onSearch,
  onClusterFilter,
  onEdgeFilter,
  onRefresh,
  onReindex,
}: DepToolbarProps) {
  const [searchQuery, setSearchQuery] = useState('')

  const handleSearch = (value: string) => {
    setSearchQuery(value)
    onSearch(value)
  }

  return (
    <div className="dep-toolbar">
      <div className="dep-toolbar__search">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          type="text"
          placeholder="Search nodes..."
          value={searchQuery}
          onChange={(e) => handleSearch(e.target.value)}
          className="dep-toolbar__search-input"
        />
      </div>

      <div className="dep-toolbar__filters">
        <select
          className="dep-toolbar__filter-select"
          onChange={(e) => onClusterFilter(e.target.value || null)}
          defaultValue=""
        >
          <option value="">All clusters</option>
          {clusters.map((c) => (
            <option key={c.name} value={c.name}>{c.name}</option>
          ))}
        </select>

        <select
          className="dep-toolbar__filter-select"
          onChange={(e) => onEdgeFilter(e.target.value || null)}
          defaultValue=""
        >
          <option value="">All edges</option>
          <option value="imports">Imports</option>
          <option value="calls">Calls</option>
          <option value="extends">Extends</option>
          <option value="implements">Implements</option>
        </select>
      </div>

      <div className="dep-toolbar__stats">
        {nodeCount} nodes · {edgeCount} edges
      </div>

      <div className="dep-toolbar__actions">
        <button className="dep-toolbar__button" onClick={onRefresh} title="Refresh graph">
          ↻ Refresh
        </button>
        <button className="dep-toolbar__button dep-toolbar__button--primary" onClick={onReindex} title="Re-index project">
          ⟳ Re-index
        </button>
      </div>
    </div>
  )
}