import type { AuraIndexingStatus } from '../../hooks/useAura'

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

interface IndexingOverlayProps {
  status: AuraIndexingStatus | null
}

export function IndexingOverlay({ status }: IndexingOverlayProps) {
  if (!status) return null
  if (status.phase === 'idle' || status.phase === 'complete' || status.phase === 'watching') return null

  const isError = status.phase === 'error'
  const label = PHASE_LABELS[status.phase] ?? status.phase
  const pct = Math.round(status.progress * 100)

  return (
    <div className="indexing-overlay">
      <div className="indexing-overlay__content">
        {isError ? (
          <>
            <div className="indexing-overlay__icon indexing-overlay__icon--error">!</div>
            <div className="indexing-overlay__title">Indexing failed</div>
            <div className="indexing-overlay__message">{status.error ?? 'An unknown error occurred'}</div>
          </>
        ) : (
          <>
            <div className="indexing-overlay__spinner" />
            <div className="indexing-overlay__title">Indexing your codebase</div>
            <div className="indexing-overlay__phase">{label}</div>
            <div className="indexing-overlay__bar-track">
              <div className="indexing-overlay__bar-fill" style={{ width: `${pct}%` }} />
            </div>
            <div className="indexing-overlay__row">
              <span className="indexing-overlay__stats">
                {status.filesProcessed}/{status.totalFiles} files &middot; {status.nodesFound} nodes &middot; {status.edgesFound} edges
              </span>
              <span className="indexing-overlay__pct">{pct}%</span>
            </div>
          </>
        )}
      </div>
    </div>
  )
}