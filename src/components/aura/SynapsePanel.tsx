import { useState } from 'react'
import type { SynapseNodeData, SynapseNodeContext, SynapseImpactResult } from '../../hooks/useSynapse'

// ── Kind Badge Colors ─────────────────────────────────────────────────────────

const KIND_COLORS: Record<string, string> = {
  Function: '#4ec9b0',
  Class: '#e8a855',
  Interface: '#b57edc',
  Method: '#f5d76e',
  Variable: '#f48fb1',
  File: '#5b8def',
  Folder: '#8b8b8b',
}

// ── Impact Level Colors ────────────────────────────────────────────────────────

const IMPACT_COLORS: Record<string, string> = {
  'WILL BREAK': '#ff4444',
  'LIKELY AFFECTED': '#ffaa33',
  'MAY NEED TESTING': '#5b8def',
}

// ── Props ──────────────────────────────────────────────────────────────────────

interface SynapsePanelProps {
  selectedNode: SynapseNodeData | null
  nodeContext: SynapseNodeContext | null
  impactResult: SynapseImpactResult | null
  onClose: () => void
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
    <div className="synapse-panel__section">
      <button className="synapse-panel__section-header" onClick={() => setOpen(!open)}>
        <span className="synapse-panel__section-toggle">{open ? '▼' : '▶'}</span>
        <span className="synapse-panel__section-title">{title}</span>
        {count !== undefined && <span className="synapse-panel__section-count">{count}</span>}
      </button>
      {open && <div className="synapse-panel__section-body">{children}</div>}
    </div>
  )
}

// ── Reference Item ─────────────────────────────────────────────────────────────

function RefItem({ node, edgeType }: { node: SynapseNodeData; edgeType: string }) {
  return (
    <div className="synapse-panel__ref-item">
      <span className="synapse-panel__kind-badge" data-kind={node.kind}>{node.kind}</span>
      <span className="synapse-panel__ref-name">{node.name}</span>
      <span className="synapse-panel__ref-edge">{edgeType}</span>
      <span className="synapse-panel__ref-path" title={node.filePath}>{node.filePath}</span>
    </div>
  )
}

// ── Component ───────────────────────────────────────────────────────────────────

export function SynapsePanel({ selectedNode, nodeContext, impactResult, onClose }: SynapsePanelProps) {
  if (!selectedNode) {
    return (
      <div className="synapse-panel synapse-panel--empty">
        <div className="synapse-panel__placeholder">
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
  const hierarchy = nodeContext?.hierarchy ?? []

  const ancestors = hierarchy.filter((h) => h.relation === 'extends' || h.relation === 'implements')
  const descendants = hierarchy.filter((h) => h.relation === 'extendedBy' || h.relation === 'implementedBy')

  return (
    <div className="synapse-panel">
      <div className="synapse-panel__header">
        <div className="synapse-panel__header-info">
          <span className="synapse-panel__kind-badge" data-kind={selectedNode.kind} style={{ backgroundColor: kindColor }}>
            {selectedNode.kind}
          </span>
          <h3 className="synapse-panel__node-name">{selectedNode.name}</h3>
        </div>
        <button className="synapse-panel__close" onClick={onClose} title="Close panel">
          &times;
        </button>
      </div>

      {/* Node Info */}
      <Section title="Node Info" defaultOpen={true}>
        <div className="synapse-panel__info-grid">
          <div className="synapse-panel__info-row">
            <span className="synapse-panel__info-label">Path</span>
            <span className="synapse-panel__info-value synapse-panel__info-value--mono">{selectedNode.filePath}</span>
          </div>
          {selectedNode.range && (
            <div className="synapse-panel__info-row">
              <span className="synapse-panel__info-label">Lines</span>
              <span className="synapse-panel__info-value">{selectedNode.range.startLine}&ndash;{selectedNode.range.endLine}</span>
            </div>
          )}
          <div className="synapse-panel__info-row">
            <span className="synapse-panel__info-label">Exported</span>
            <span className="synapse-panel__info-value">{selectedNode.exported ? 'Yes' : 'No'}</span>
          </div>
        </div>
      </Section>

      {/* Incoming References */}
      {incoming.length > 0 && (
        <Section title="Incoming References" count={incoming.length} defaultOpen={true}>
          <div className="synapse-panel__ref-list">
            {incoming.map((ref, i) => (
              <RefItem key={`in-${i}`} node={ref.node} edgeType={ref.edgeType} />
            ))}
          </div>
        </Section>
      )}

      {/* Outgoing References */}
      {outgoing.length > 0 && (
        <Section title="Outgoing References" count={outgoing.length} defaultOpen={true}>
          <div className="synapse-panel__ref-list">
            {outgoing.map((ref, i) => (
              <RefItem key={`out-${i}`} node={ref.node} edgeType={ref.edgeType} />
            ))}
          </div>
        </Section>
      )}

      {/* Members (for Class/Interface) */}
      {members.length > 0 && (
        <Section title="Members" count={members.length} defaultOpen={false}>
          <div className="synapse-panel__ref-list">
            {members.map((m) => (
              <div key={m.id} className="synapse-panel__ref-item">
                <span className="synapse-panel__kind-badge" data-kind={m.kind}>{m.kind}</span>
                <span className="synapse-panel__ref-name">{m.name}</span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Impact Analysis */}
      {impactResult && impactResult.levels.length > 0 && (
        <Section title="Impact Analysis" defaultOpen={false}>
          <div className="synapse-panel__impact">
            {impactResult.levels.map((level) => {
              const color = IMPACT_COLORS[level.label] ?? '#8b8b8b'
              return (
                <div key={level.depth} className="synapse-panel__impact-level">
                  <div className="synapse-panel__impact-level-header">
                    <span className="synapse-panel__impact-label" style={{ color }}>{level.label}</span>
                    <span className="synapse-panel__impact-depth">Depth {level.depth}</span>
                  </div>
                  <div className="synapse-panel__impact-nodes">
                    {level.nodes.map((node) => (
                      <div key={node.id} className="synapse-panel__impact-node">
                        <span className="synapse-panel__kind-badge" data-kind={node.kind}>{node.kind}</span>
                        <span className="synapse-panel__ref-name">{node.name}</span>
                        <span className="synapse-panel__ref-path" title={node.filePath}>{node.filePath}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </Section>
      )}

      {/* Hierarchy */}
      {(ancestors.length > 0 || descendants.length > 0) && (
        <Section title="Hierarchy" defaultOpen={false}>
          <div className="synapse-panel__hierarchy">
            {ancestors.length > 0 && (
              <div className="synapse-panel__hierarchy-group">
                <span className="synapse-panel__hierarchy-label">Extends / Implements</span>
                {ancestors.map((h, i) => (
                  <div key={`anc-${i}`} className="synapse-panel__ref-item">
                    <span className="synapse-panel__kind-badge" data-kind={h.node.kind}>{h.node.kind}</span>
                    <span className="synapse-panel__ref-name">{h.node.name}</span>
                    <span className="synapse-panel__ref-edge">{h.relation}</span>
                  </div>
                ))}
              </div>
            )}
            {descendants.length > 0 && (
              <div className="synapse-panel__hierarchy-group">
                <span className="synapse-panel__hierarchy-label">Extended By / Implemented By</span>
                {descendants.map((h, i) => (
                  <div key={`desc-${i}`} className="synapse-panel__ref-item">
                    <span className="synapse-panel__kind-badge" data-kind={h.node.kind}>{h.node.kind}</span>
                    <span className="synapse-panel__ref-name">{h.node.name}</span>
                    <span className="synapse-panel__ref-edge">{h.relation}</span>
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