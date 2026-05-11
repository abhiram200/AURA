import type { AuraIndexingStatus } from '../../hooks/useAura'

// ── Phase Labels ───────────────────────────────────────────────────────────────

const PHASE_LABELS: Record<string, string> = {
  scanning: 'Scanning files',
  parsing: 'Parsing source code',
  resolving: 'Resolving imports',
  typeResolving: 'Resolving types',
  aggregating: 'Building dependencies',
  apiAnalysis: 'Analyzing API routes',
  processTracing: 'Tracing execution flows',
  searchIndexing: 'Building search index',
  saving: 'Saving graph',
  watching: 'Watching for changes',
  complete: 'Indexing complete',
  error: 'Indexing failed',
}

// ── Props ──────────────────────────────────────────────────────────────────────

interface AuraProgressProps {
  status: AuraIndexingStatus | null
}

// ── Component ───────────────────────────────────────────────────────────────────

export function AuraProgress({ status }: AuraProgressProps) {
  if (!status) return null
  if (status.phase === 'idle') return null
  if (status.phase === 'complete') return null

  // Watching mode: show persistent indicator, not a progress bar
  if (status.phase === 'watching') {
    return (
      <div className="aura-progress aura-progress--watching">
        <span className="aura-progress__watch-dot" />
        <span className="aura-progress__phase">{PHASE_LABELS.watching}</span>
      </div>
    )
  }

  const isError = status.phase === 'error'
  const label = PHASE_LABELS[status.phase] ?? status.phase
  const pct = Math.round(status.progress * 100)

  return (
    <div className="aura-progress">
      {isError ? (
        <div className="aura-progress__error">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="15" y1="9" x2="9" y2="15" />
            <line x1="9" y1="9" x2="15" y2="15" />
          </svg>
          <span>{status.error ?? label}</span>
        </div>
      ) : (
        <>
          <div className="aura-progress__bar-track">
            <div className="aura-progress__bar-fill" style={{ width: `${pct}%` }} />
          </div>
          <div className="aura-progress__info">
            <span className="aura-progress__phase">{label}</span>
            <span className="aura-progress__stats">
              {status.filesProcessed}/{status.totalFiles} files &middot; {status.nodesFound} nodes &middot; {status.edgesFound} edges
            </span>
            <span className="aura-progress__pct">{pct}%</span>
          </div>
        </>
      )}
    </div>
  )
}