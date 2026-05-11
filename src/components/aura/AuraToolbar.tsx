import { useState, useRef, useEffect, useCallback } from 'react'
import type { AuraNodeData, AuraSearchResult } from '../../hooks/useAura'

// ── Constants ──────────────────────────────────────────────────────────────────

const NODE_KINDS = ['File', 'Folder', 'Function', 'Class', 'Interface', 'Method', 'Variable'] as const
const EDGE_TYPES = ['IMPORTS', 'CALLS', 'EXTENDS', 'IMPLEMENTS', 'CONTAINS', 'DEPENDS_ON', 'HAS_METHOD', 'HAS_PROPERTY', 'TYPEOF', 'TYPE_ALIAS', 'FLOWS_TO'] as const

const KIND_COLORS: Record<string, string> = {
  File: '#58a6ff',
  Folder: '#8b949e',
  Function: '#3fb950',
  Class: '#d29922',
  Interface: '#bc8cff',
  Method: '#f0883e',
  Variable: '#f778ba',
  Route: '#ff6b6b',
  ApiCall: '#ffa94d',
}

// ── Props ──────────────────────────────────────────────────────────────────────

interface AuraToolbarProps {
  nodeCount: number
  edgeCount: number
  nodeFilters: Set<string>
  edgeFilters: Set<string>
  onNodeFilterChange: (filters: Set<string>) => void
  onEdgeFilterChange: (filters: Set<string>) => void
  onSearch: (query: string, options?: { limit?: number; kinds?: string[] }) => void
  onSearchResultClick: (node: AuraNodeData) => void
  searchResults: AuraSearchResult[]
  onReindex: () => void
  isIndexing: boolean
}

// ── Component ───────────────────────────────────────────────────────────────────

export function AuraToolbar({
  nodeCount,
  edgeCount,
  nodeFilters,
  edgeFilters,
  onNodeFilterChange,
  onEdgeFilterChange,
  onSearch,
  onSearchResultClick,
  searchResults,
  onReindex,
  isIndexing,
}: AuraToolbarProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [searchFocused, setSearchFocused] = useState(false)
  const [searchKindFilter, setSearchKindFilter] = useState<Set<string>>(new Set())
  const [kindFilterOpen, setKindFilterOpen] = useState(false)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const searchRef = useRef<HTMLDivElement>(null)
  const filtersRef = useRef<HTMLDivElement>(null)
  const kindFilterRef = useRef<HTMLDivElement>(null)

  // Close search results when clicking outside
  useEffect(() => {
    if (!searchFocused) return
    function handleClickOutside(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setSearchFocused(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [searchFocused])

  // Close filters dropdown when clicking outside
  useEffect(() => {
    if (!filtersOpen) return
    function handleClickOutside(e: MouseEvent) {
      if (filtersRef.current && !filtersRef.current.contains(e.target as Node)) {
        setFiltersOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [filtersOpen])

  // Close kind filter dropdown when clicking outside
  useEffect(() => {
    if (!kindFilterOpen) return
    function handleClickOutside(e: MouseEvent) {
      if (kindFilterRef.current && !kindFilterRef.current.contains(e.target as Node)) {
        setKindFilterOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [kindFilterOpen])

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault()
    const kinds = searchKindFilter.size > 0 ? Array.from(searchKindFilter) : undefined
    onSearch(searchQuery, kinds ? { kinds } : undefined)
  }

  function toggleSearchKind(kind: string) {
    setSearchKindFilter((prev) => {
      const next = new Set(prev)
      if (next.has(kind)) next.delete(kind)
      else next.add(kind)
      return next
    })
  }

  function handleResultClick(node: AuraNodeData) {
    onSearchResultClick(node)
    setSearchFocused(false)
  }

  function toggleNodeKind(kind: string) {
    const next = new Set(nodeFilters)
    if (next.has(kind)) next.delete(kind)
    else next.add(kind)
    onNodeFilterChange(next)
  }

  function toggleEdgeType(type: string) {
    const next = new Set(edgeFilters)
    if (next.has(type)) next.delete(type)
    else next.add(type)
    onEdgeFilterChange(next)
  }

  function selectAllNodeKinds() {
    onNodeFilterChange(new Set(NODE_KINDS))
  }

  function deselectAllNodeKinds() {
    onNodeFilterChange(new Set())
  }

  function selectAllEdgeTypes() {
    onEdgeFilterChange(new Set(EDGE_TYPES))
  }

  function deselectAllEdgeTypes() {
    onEdgeFilterChange(new Set())
  }

  const showSearchResults = searchFocused && searchQuery.length > 0 && searchResults.length > 0

  return (
    <div className="aura-toolbar">
      {/* Brand */}
      <div className="aura-toolbar__brand">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
        <span>AURA</span>
      </div>

      {/* Search */}
      <div className="aura-toolbar__search-wrapper" ref={searchRef}>
        <form className="aura-toolbar__search" onSubmit={handleSearchSubmit}>
          <input
            className="aura-toolbar__search-input"
            type="text"
            placeholder="Search nodes..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value)
              if (e.target.value.length > 0) {
                const kinds = searchKindFilter.size > 0 ? Array.from(searchKindFilter) : undefined
                onSearch(e.target.value, kinds ? { kinds } : undefined)
              }
            }}
            onFocus={() => setSearchFocused(true)}
          />
          <div className="aura-toolbar__search-filter" ref={kindFilterRef}>
            <button
              type="button"
              className={`aura-toolbar__search-filter-btn ${searchKindFilter.size > 0 ? 'aura-toolbar__search-filter-btn--active' : ''}`}
              onClick={() => setKindFilterOpen(!kindFilterOpen)}
              title="Filter by kind"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
              </svg>
              {searchKindFilter.size > 0 && <span>{searchKindFilter.size}</span>}
            </button>
            {kindFilterOpen && (
              <div className="aura-toolbar__search-kinds">
                {NODE_KINDS.map((kind) => (
                  <label key={kind} className="aura-toolbar__search-kind">
                    <input
                      type="checkbox"
                      checked={searchKindFilter.has(kind)}
                      onChange={() => toggleSearchKind(kind)}
                    />
                    <span style={{ color: KIND_COLORS[kind] ?? '#8b949e' }}>{kind}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        </form>
        {showSearchResults && (
          <div className="aura-toolbar__search-results">
            {searchResults.map((result, i) => (
              <button
                key={result.node.id}
                className="aura-toolbar__search-result"
                onClick={() => handleResultClick(result.node)}
              >
                <span
                  className="aura-toolbar__search-result-kind"
                  style={{ backgroundColor: KIND_COLORS[result.node.kind] ?? '#8b949e' }}
                >
                  {result.node.kind}
                </span>
                {result.node.exported && (
                  <span className="aura-toolbar__search-result-exported">E</span>
                )}
                <span className="aura-toolbar__search-result-name">{result.node.name}</span>
                <span className="aura-toolbar__search-result-path" title={result.node.filePath}>
                  {result.node.filePath}
                </span>
                {result.node.range && (
                  <span className="aura-toolbar__search-result-range">
                    {result.node.range.startLine === result.node.range.endLine
                      ? `L${result.node.range.startLine}`
                      : `L${result.node.range.startLine}-${result.node.range.endLine}`}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Stats */}
      <div className="aura-toolbar__stats">
        <span className="aura-toolbar__stat">{nodeCount} nodes</span>
        <span className="aura-toolbar__stat-sep">&middot;</span>
        <span className="aura-toolbar__stat">{edgeCount} edges</span>
      </div>

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Filters */}
      <div className="aura-toolbar__filters-wrapper" ref={filtersRef}>
        <button
          className="aura-toolbar__icon-btn"
          onClick={() => setFiltersOpen(!filtersOpen)}
          title="Filters"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
          </svg>
        </button>
        {filtersOpen && (
          <div className="aura-toolbar__filters">
            <div className="aura-toolbar__filter-group">
              <div className="aura-toolbar__filter-group-header">
                <span className="aura-toolbar__filter-group-title">Node Kinds</span>
                <div className="aura-toolbar__filter-group-actions">
                  <button className="aura-toolbar__filter-mini-btn" onClick={selectAllNodeKinds}>All</button>
                  <button className="aura-toolbar__filter-mini-btn" onClick={deselectAllNodeKinds}>None</button>
                </div>
              </div>
              <div className="aura-toolbar__filter-list">
                {NODE_KINDS.map((kind) => (
                  <label key={kind} className="aura-toolbar__filter-item">
                    <input
                      type="checkbox"
                      checked={nodeFilters.has(kind)}
                      onChange={() => toggleNodeKind(kind)}
                    />
                    <span>{kind}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="aura-toolbar__filter-group">
              <div className="aura-toolbar__filter-group-header">
                <span className="aura-toolbar__filter-group-title">Edge Types</span>
                <div className="aura-toolbar__filter-group-actions">
                  <button className="aura-toolbar__filter-mini-btn" onClick={selectAllEdgeTypes}>All</button>
                  <button className="aura-toolbar__filter-mini-btn" onClick={deselectAllEdgeTypes}>None</button>
                </div>
              </div>
              <div className="aura-toolbar__filter-list">
                {EDGE_TYPES.map((type) => (
                  <label key={type} className="aura-toolbar__filter-item">
                    <input
                      type="checkbox"
                      checked={edgeFilters.has(type)}
                      onChange={() => toggleEdgeType(type)}
                    />
                    <span>{type}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Re-index */}
      <button
        className="aura-toolbar__icon-btn"
        onClick={onReindex}
        disabled={isIndexing}
        title="Re-index project"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={isIndexing ? { animation: 'aura-spin 1s linear infinite' } : undefined}>
          <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.3" />
        </svg>
      </button>
    </div>
  )
}