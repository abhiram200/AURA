import { motion } from 'framer-motion'
import type { IndexingStatus } from '../../hooks/useDependencies'

interface NotInstalledProps {
  onCheckAgain: () => void
}

export function DepNotInstalled({ onCheckAgain }: NotInstalledProps) {
  return (
    <div className="dep-state dep-state--not-installed">
      <svg className="dep-state__icon" width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="var(--accent-primary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
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
      <h3 className="dep-state__title">GitNexus Not Found</h3>
      <p className="dep-state__description">
        Install GitNexus to visualize dependency graphs and get structural context.
      </p>
      <div className="dep-state__code">npm install -g gitnexus</div>
      <button className="dep-state__button" onClick={onCheckAgain}>
        Check Again
      </button>
    </div>
  )
}

interface IndexingProps {
  status: Extract<IndexingStatus, { status: 'indexing' }>
}

export function DepIndexing({ status }: IndexingProps) {
  return (
    <div className="dep-state dep-state--indexing">
      <motion.div
        className="dep-state__spinner"
        animate={{ rotate: 360 }}
        transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
      />
      <h3 className="dep-state__title">Indexing Project</h3>
      <p className="dep-state__description">Analyzing dependency graph...</p>
      <div className="dep-state__progress-bar">
        <motion.div
          className="dep-state__progress-fill"
          initial={{ width: '0%' }}
          animate={{ width: `${status.percent}%` }}
          transition={{ duration: 0.5 }}
        />
      </div>
      <div className="dep-state__progress-info">
        <span className="dep-state__phase">{status.phase}</span>
        <span className="dep-state__percent">{status.percent}%</span>
      </div>
      <p className="dep-state__hint">This may take 10-30 seconds depending on project size.</p>
    </div>
  )
}

interface ErrorProps {
  error: string
  onRetry: () => void
}

export function DepError({ error, onRetry }: ErrorProps) {
  return (
    <div className="dep-state dep-state--error">
      <svg className="dep-state__icon" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--error, #ff6b6b)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
      <h3 className="dep-state__title">Indexing Failed</h3>
      <p className="dep-state__description">GitNexus encountered an error while analyzing this project.</p>
      <p className="dep-state__error-text">{error}</p>
      <div className="dep-state__actions">
        <button className="dep-state__button dep-state__button--primary" onClick={onRetry}>
          Retry
        </button>
      </div>
    </div>
  )
}