import type { SynapseIndexingStatus } from '../../hooks/useSynapse'

// ── Phase Labels ───────────────────────────────────────────────────────────────

const PHASE_LABELS: Record<string, string> = {
  scanning: 'Scanning files',
  parsing: 'Parsing source code',
  resolving: 'Resolving imports',
  aggregating: 'Building dependencies',
  saving: 'Saving graph',
  complete: 'Indexing complete',
  error: 'Indexing failed',
}

// ── Props ──────────────────────────────────────────────────────────────────────

interface SynapseProgressProps {
  status: SynapseIndexingStatus | null
}

// ── Component ───────────────────────────────────────────────────────────────────

export function SynapseProgress({ status }: SynapseProgressProps) {
  if (!status) return null
  if (status.phase === 'idle') return null
  if (status.phase === 'complete') return null

  const isError = status.phase === 'error'
  const label = PHASE_LABELS[status.phase] ?? status.phase
  const pct = Math.round(status.progress * 100)

  return (
    <div className="synapse-progress">
      {isError ? (
        <div className="synapse-progress__error">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="15" y1="9" x2="9" y2="15" />
            <line x1="9" y1="9" x2="15" y2="15" />
          </svg>
          <span>{status.error ?? label}</span>
        </div>
      ) : (
        <>
          <div className="synapse-progress__bar-track">
            <div className="synapse-progress__bar-fill" style={{ width: `${pct}%` }} />
          </div>
          <div className="synapse-progress__info">
            <span className="synapse-progress__phase">{label}</span>
            <span className="synapse-progress__stats">
              {status.filesProcessed}/{status.totalFiles} files &middot; {status.nodesFound} nodes &middot; {status.edgesFound} edges
            </span>
            <span className="synapse-progress__pct">{pct}%</span>
          </div>
        </>
      )}
    </div>
  )
}