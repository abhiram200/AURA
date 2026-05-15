import { useState } from 'react'
import type { AuraNodeData, AuraNodeContext, AuraImpactResult, AuraFileImpact, AuraSymbolImpact, AuraDirectionResult } from '../../hooks/useAura'

// ── Kind Badge Colors ─────────────────────────────────────────────────────────

const KIND_COLORS: Record<string, string> = {
  Function: '#4ec9b0',
  Class: '#e8a855',
  Interface: '#b57edc',
  TypeAlias: '#9b7edc',
  Method: '#f5d76e',
  Variable: '#f48fb1',
  File: '#5b8def',
  Folder: '#8b8b8b',
}

// ── Impact Level Colors ────────────────────────────────────────────────────────

const SEVERITY_COLORS: Record<string, string> = {
  critical: '#ff4444',
  moderate: '#ffaa33',
  low: '#5b8def',
}

const SEVERITY_LABELS: Record<string, string> = {
  critical: 'BREAK',
  moderate: 'RISK',
  low: 'INFO',
}

// ── Edge Type Display ───────────────────────────────────────────────────────────

const EDGE_TYPE_ORDER = ['CALLS', 'IMPORTS', 'EXTENDS', 'IMPLEMENTS', 'DEPENDS_ON', 'TYPEOF', 'TYPE_ALIAS', 'FLOWS_TO']

function edgeTypeLabel(type: string): string {
  switch (type) {
    case 'CALLS': return 'calls'
    case 'IMPORTS': return 'imports'
    case 'EXTENDS': return 'extends'
    case 'IMPLEMENTS': return 'implements'
    case 'DEPENDS_ON': return 'depends'
    case 'CONTAINS': return 'contains'
    case 'TYPEOF': return 'type of'
    case 'TYPE_ALIAS': return 'alias of'
    case 'FLOWS_TO': return 'flows to'
    default: return type.toLowerCase()
  }
}

// ── Props ──────────────────────────────────────────────────────────────────────

interface AuraPanelProps {
  selectedNode: AuraNodeData | null
  nodeContext: AuraNodeContext | null
  impactResult: AuraImpactResult | null
  onClose: () => void
  onFileOpen?: (filePath: string, startLine?: number) => void
}

// ── Collapsible Section ────────────────────────────────────────────────────────

function Section({ title, count, defaultOpen = true, children }: {
  title: string
  count?: number
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="aura-panel__section">
      <button className="aura-panel__section-header" onClick={() => setOpen(!open)}>
        <span className="aura-panel__section-toggle">{open ? '▾' : '▸'}</span>
        <span className="aura-panel__section-title">{title}</span>
        {count !== undefined && <span className="aura-panel__section-count">{count}</span>}
      </button>
      {open && <div className="aura-panel__section-body">{children}</div>}
    </div>
  )
}

// ── Clickable Path ──────────────────────────────────────────────────────────────

function ClickablePath({ filePath, startLine, onFileOpen }: { filePath: string; startLine?: number; onFileOpen?: (filePath: string, startLine?: number) => void }) {
  if (onFileOpen) {
    return (
      <button
        className="aura-panel__info-value aura-panel__info-value--mono aura-panel__info-value--clickable"
        onClick={() => onFileOpen(filePath, startLine)}
        title={`Open ${filePath}${startLine ? ` at line ${startLine}` : ''}`}
      >
        {filePath}
      </button>
    )
  }
  return <span className="aura-panel__info-value aura-panel__info-value--mono">{filePath}</span>
}

// ── Grouped Reference ───────────────────────────────────────────────────────────

interface GroupedRef {
  node: AuraNodeData
  edgeTypes: string[]
}

function groupReferences(refs: { node: AuraNodeData; edgeType: string }[]): GroupedRef[] {
  const map = new Map<string, GroupedRef>()
  for (const ref of refs) {
    const key = ref.node.id
    if (map.has(key)) {
      map.get(key)!.edgeTypes.push(ref.edgeType)
    } else {
      map.set(key, { node: ref.node, edgeTypes: [ref.edgeType] })
    }
  }
  // Sort edge types within each group by priority
  const sorted = [...map.values()]
  for (const g of sorted) {
    g.edgeTypes.sort((a, b) => {
      const ai = EDGE_TYPE_ORDER.indexOf(a)
      const bi = EDGE_TYPE_ORDER.indexOf(b)
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)
    })
    // Deduplicate
    g.edgeTypes = [...new Set(g.edgeTypes)]
  }
  return sorted
}

function GroupedRefItem({ group, onFileOpen }: { group: GroupedRef; onFileOpen?: (filePath: string, startLine?: number) => void }) {
  const primaryEdge = group.edgeTypes[0]
  const rangeText = group.node.range
    ? (group.node.range.startLine === group.node.range.endLine
      ? `L${group.node.range.startLine}`
      : `L${group.node.range.startLine}–${group.node.range.endLine}`)
    : (group.node.kind === 'File' ? 'full file' : '')

  const handleClick = onFileOpen
    ? () => onFileOpen(group.node.filePath, group.node.range?.startLine)
    : undefined

  return (
    <div className="aura-panel__ref-item" onClick={handleClick} style={handleClick ? { cursor: 'pointer' } : undefined}>
      <span className="aura-panel__kind-badge" data-kind={group.node.kind}>{group.node.kind}</span>
      <span className="aura-panel__ref-name">{group.node.name}</span>
      <div className="aura-panel__ref-edge-tags">
        {group.edgeTypes.map(et => (
          <span key={et} className="aura-panel__ref-edge-tag" data-primary={et === primaryEdge}>
            {edgeTypeLabel(et)}
          </span>
        ))}
      </div>
      {rangeText && (
        <span className="aura-panel__ref-range">{rangeText}</span>
      )}
      <span className="aura-panel__ref-path" title={group.node.filePath}>{group.node.filePath}</span>
    </div>
  )
}

// ── Impact Display ──────────────────────────────────────────────────────────────

function SymbolImpactRow({ symbol }: { symbol: AuraSymbolImpact }) {
  const rangeText = symbol.range
    ? (symbol.range.startLine === symbol.range.endLine
      ? `L${symbol.range.startLine}`
      : `L${symbol.range.startLine}–${symbol.range.endLine}`)
    : (symbol.kind === 'File' ? 'entire file' : '')

  return (
    <div className="aura-panel__impact-symbol">
      <div className="aura-panel__impact-symbol-header">
        <span className="aura-panel__kind-badge" data-kind={symbol.kind}>{symbol.kind}</span>
        <span className="aura-panel__impact-symbol-name">{symbol.name}</span>
        {rangeText && (
          <span className="aura-panel__impact-range">{rangeText}</span>
        )}
        <span className="aura-panel__impact-score-bar">
          <span className="aura-panel__impact-score-fill" style={{ width: `${symbol.score * 100}%`, background: SEVERITY_COLORS[symbol.severity] }} />
        </span>
      </div>
      {symbol.tracePath.length > 0 && (
        <div className="aura-panel__impact-trace">
          {symbol.tracePath.map((step, i) => (
            <span key={`${step.id}-${i}`} className="aura-panel__impact-trace-step">
              <span className="aura-panel__impact-trace-node">{step.name}</span>
              {step.filePath && (
                <span className="aura-panel__impact-trace-file">{step.filePath.split('/').pop()}</span>
              )}
              <span className="aura-panel__impact-trace-edge">{edgeTypeLabel(step.edgeType)}</span>
            </span>
          ))}
          <span className="aura-panel__impact-trace-node">{symbol.name}</span>
        </div>
      )}
    </div>
  )
}

function FileImpactRow({ file, defaultOpen, onFileOpen }: { file: AuraFileImpact; defaultOpen: boolean; onFileOpen?: (filePath: string, startLine?: number) => void }) {
  const [open, setOpen] = useState(defaultOpen)
  const color = SEVERITY_COLORS[file.severity]
  const label = SEVERITY_LABELS[file.severity]

  return (
    <div className="aura-panel__impact-file" style={{ borderLeftColor: color }}>
      <button className="aura-panel__impact-file-header" onClick={() => setOpen(!open)}>
        <span className="aura-panel__impact-severity-badge" style={{ background: color }}>
          {label}
        </span>
        {onFileOpen ? (
          <span
            className="aura-panel__impact-file-path aura-panel__impact-file-path--clickable"
            onClick={(e) => { e.stopPropagation(); onFileOpen(file.filePath) }}
            title={`Open ${file.filePath}`}
          >
            {file.filePath}
          </span>
        ) : (
          <span className="aura-panel__impact-file-path">{file.filePath}</span>
        )}
        <span className="aura-panel__impact-score">{file.score.toFixed(2)}</span>
      </button>
      {open && (
        <div className="aura-panel__impact-symbols">
          {file.symbols.map(sym => (
            <SymbolImpactRow key={sym.id} symbol={sym} />
          ))}
        </div>
      )}
    </div>
  )
}

function DirectionSection({ title, subtitle, direction, onFileOpen }: { title: string; subtitle: string; direction: AuraDirectionResult; onFileOpen?: (filePath: string, startLine?: number) => void }) {
  if (direction.files.length === 0) return null

  return (
    <div className="aura-panel__impact-direction">
      <div className="aura-panel__impact-direction-header">
        <span className="aura-panel__impact-direction-title">{title}</span>
        <span className="aura-panel__impact-direction-subtitle">{subtitle}</span>
      </div>
      <div className="aura-panel__impact-files">
        {direction.files.map((file, i) => (
          <FileImpactRow
            key={`${file.filePath}-${i}`}
            file={file}
            defaultOpen={file.severity !== 'low'}
            onFileOpen={onFileOpen}
          />
        ))}
      </div>
    </div>
  )
}

// ── Component ───────────────────────────────────────────────────────────────────

export function AuraPanel({ selectedNode, nodeContext, impactResult, onClose, onFileOpen }: AuraPanelProps) {
  if (!selectedNode) {
    return (
      <div className="aura-panel aura-panel--empty">
        <div className="aura-panel__placeholder">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
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
          <p>Select a node to view details</p>
        </div>
      </div>
    )
  }

  const kindColor = KIND_COLORS[selectedNode.kind] ?? '#8b8b8b'
  const incoming = nodeContext?.incoming ?? []
  const outgoing = nodeContext?.outgoing ?? []
  const members = nodeContext?.members ?? []
  const containedBy = nodeContext?.containedBy ?? null
  const hierarchy = nodeContext?.hierarchy ?? []

  const ancestors = hierarchy.filter((h) => h.relation === 'extends' || h.relation === 'implements')
  const descendants = hierarchy.filter((h) => h.relation === 'extended by' || h.relation === 'implemented by')

  const groupedIncoming = groupReferences(incoming)
  const groupedOutgoing = groupReferences(outgoing)

  const hasImpact = impactResult && (impactResult.downstream.files.length > 0 || impactResult.upstream.files.length > 0)

  return (
    <div className="aura-panel">
      <div className="aura-panel__header">
        <div className="aura-panel__header-info">
          <span className="aura-panel__kind-badge" data-kind={selectedNode.kind} style={{ backgroundColor: kindColor }}>
            {selectedNode.kind}
          </span>
          <h3 className="aura-panel__node-name">{selectedNode.name}</h3>
        </div>
        <button className="aura-panel__close" onClick={onClose} title="Close panel">
          &times;
        </button>
      </div>

      {/* Node Info */}
      <Section title="Info" defaultOpen={true}>
        <div className="aura-panel__info-grid">
          <div className="aura-panel__info-row">
            <span className="aura-panel__info-label">Path</span>
            <ClickablePath filePath={selectedNode.filePath} startLine={selectedNode.range?.startLine} onFileOpen={onFileOpen} />
          </div>
          {selectedNode.range && (
            <div className="aura-panel__info-row">
              <span className="aura-panel__info-label">Lines</span>
              <span className="aura-panel__info-value">{selectedNode.range.startLine}&ndash;{selectedNode.range.endLine}</span>
            </div>
          )}
          <div className="aura-panel__info-row">
            <span className="aura-panel__info-label">Exported</span>
            <span className="aura-panel__info-value">{selectedNode.exported ? 'Yes' : 'No'}</span>
          </div>
          {containedBy && (
          <div className="aura-panel__info-row">
            <span className="aura-panel__info-label">Inside</span>
            <span className="aura-panel__info-value">
              <span className="aura-panel__kind-badge" data-kind={containedBy.kind} style={{ backgroundColor: KIND_COLORS[containedBy.kind] ?? '#8b8b8b' }}>{containedBy.kind}</span>
              {containedBy.name}
            </span>
          </div>
          )}
        </div>
      </Section>

      {/* Incoming References — grouped by symbol */}
      {groupedIncoming.length > 0 && (
        <Section title="Used By" count={groupedIncoming.length} defaultOpen={true}>
          <div className="aura-panel__ref-list">
            {groupedIncoming.map((g) => (
              <GroupedRefItem key={g.node.id} group={g} onFileOpen={onFileOpen} />
            ))}
          </div>
        </Section>
      )}

      {/* Outgoing References — grouped by symbol */}
      {groupedOutgoing.length > 0 && (
        <Section title="Depends On" count={groupedOutgoing.length} defaultOpen={true}>
          <div className="aura-panel__ref-list">
            {groupedOutgoing.map((g) => (
              <GroupedRefItem key={g.node.id} group={g} onFileOpen={onFileOpen} />
            ))}
          </div>
        </Section>
      )}

      {/* Members (for Class/Interface) */}
      {members.length > 0 && (
        <Section title="Members" count={members.length} defaultOpen={false}>
          <div className="aura-panel__ref-list">
            {members.map((m) => (
              <div key={m.id} className="aura-panel__ref-item">
                <span className="aura-panel__kind-badge" data-kind={m.kind}>{m.kind}</span>
                <span className="aura-panel__ref-name">{m.name}</span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Impact Analysis */}
      {hasImpact && (
        <Section title="Impact Analysis" defaultOpen={true}>
          <div className="aura-panel__impact">
            <div className="aura-panel__impact-summary">
              {(() => {
                const d = impactResult.downstream.summary
                const u = impactResult.upstream.summary
                const crit = d.critical + u.critical
                const mod = d.moderate + u.moderate
                const low = d.low + u.low
                return (
                  <div className="aura-panel__impact-summary-stats">
                    <div className="aura-panel__impact-stat aura-panel__impact-stat--critical">
                      <span className="aura-panel__impact-stat-num">{crit}</span>
                      <span className="aura-panel__impact-stat-label">Critical</span>
                    </div>
                    <div className="aura-panel__impact-stat aura-panel__impact-stat--moderate">
                      <span className="aura-panel__impact-stat-num">{mod}</span>
                      <span className="aura-panel__impact-stat-label">Moderate</span>
                    </div>
                    <div className="aura-panel__impact-stat aura-panel__impact-stat--low">
                      <span className="aura-panel__impact-stat-num">{low}</span>
                      <span className="aura-panel__impact-stat-label">Low</span>
                    </div>
                  </div>
                )
              })()}
            </div>

            <DirectionSection
              title="Downstream"
              subtitle="Who depends on this"
              direction={impactResult.downstream}
              onFileOpen={onFileOpen}
            />
            <DirectionSection
              title="Upstream"
              subtitle="What this depends on"
              direction={impactResult.upstream}
              onFileOpen={onFileOpen}
            />
          </div>
        </Section>
      )}

      {/* Hierarchy */}
      {(ancestors.length > 0 || descendants.length > 0) && (
        <Section title="Hierarchy" defaultOpen={false}>
          <div className="aura-panel__hierarchy">
            {ancestors.length > 0 && (
              <div className="aura-panel__hierarchy-group">
                <span className="aura-panel__hierarchy-label">Extends / Implements</span>
                {ancestors.map((h, i) => (
                  <div key={`anc-${i}`} className="aura-panel__ref-item">
                    <span className="aura-panel__kind-badge" data-kind={h.node.kind}>{h.node.kind}</span>
                    <span className="aura-panel__ref-name">{h.node.name}</span>
                    <span className="aura-panel__ref-edge">{h.relation}</span>
                  </div>
                ))}
              </div>
            )}
            {descendants.length > 0 && (
              <div className="aura-panel__hierarchy-group">
                <span className="aura-panel__hierarchy-label">Extended By / Implemented By</span>
                {descendants.map((h, i) => (
                  <div key={`desc-${i}`} className="aura-panel__ref-item">
                    <span className="aura-panel__kind-badge" data-kind={h.node.kind}>{h.node.kind}</span>
                    <span className="aura-panel__ref-name">{h.node.name}</span>
                    <span className="aura-panel__ref-edge">{h.relation}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Section>
      )}
    </div>
  )
}