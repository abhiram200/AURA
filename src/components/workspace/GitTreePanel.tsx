import { useState, useEffect, useMemo, useRef } from 'react'
import { useGitTree } from '../../hooks/useGitTree'
import type { GitCommit, GitBranch } from '../../hooks/useGitTree'
import { ConfirmModal } from './ConfirmModal'
import { GitTreeGraph } from './GitTreeGraph'

type ViewMode = 'graph' | 'list'

interface GitTreePanelProps {
  projectId: string
  open: boolean
  onClose: () => void
  onBranchChange?: () => void
}

const BRANCH_COLORS = [
  '#00f0ff', '#8b5cf6', '#f093fb', '#4ecdc4', '#ffd93d',
  '#ff6b6b', '#45b7d1', '#96ceb4', '#ff8a5c', '#6c63ff',
]

function formatRelativeTime(timestamp: number): string {
  const now = Date.now() / 1000
  const diff = now - timestamp
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  if (diff < 2592000) return `${Math.floor(diff / 86400)}d ago`
  return new Date(timestamp * 1000).toLocaleDateString()
}

export function GitTreePanel({ projectId, open, onClose, onBranchChange }: GitTreePanelProps) {
  const gitTree = useGitTree(projectId)
  const [viewMode, setViewMode] = useState<ViewMode>('graph')
  const [selectedHash, setSelectedHash] = useState<string | null>(null)
  const [confirmAction, setConfirmAction] = useState<{ commitHash: string; strategy: 'revert' | 'reset'; message: string } | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [checkingOut, setCheckingOut] = useState<string | null>(null)
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  // Fetch log when panel opens
  useEffect(() => {
    if (open) {
      gitTree.fetchLog()
      gitTree.fetchCurrentBranch()
      setSelectedHash(null)
      setConfirmAction(null)
      setActionError(null)
      setViewMode('graph')
    }
  }, [open])

  // Close on Escape
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  // Close on backdrop click
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handler)
    }, 50)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('mousedown', handler)
    }
  }, [open, onClose])

  // Lane assignment for branch tags (shared between list and graph)
  const { laneMap, localBranches } = useMemo(() => {
    if (!gitTree.data) return { laneMap: new Map<string, number>(), localBranches: [] as GitBranch[] }
    const locals = gitTree.data.branches.filter(b => !b.isRemote)
    const map = new Map<string, number>()
    locals.forEach((b, i) => {
      map.set(b.name, i % BRANCH_COLORS.length)
    })
    gitTree.data.branches.filter(b => b.isRemote).forEach(b => {
      const localName = b.name.replace(/^remotes\/[^/]+\//, '')
      if (map.has(localName)) {
        map.set(b.name, map.get(localName)!)
      } else {
        map.set(b.name, map.size % BRANCH_COLORS.length)
      }
    })
    return { laneMap: map, localBranches: locals }
  }, [gitTree.data])

  const handleCheckout = async (branchName: string) => {
    setActionError(null)
    setCheckingOut(branchName)
    const result = await gitTree.checkout(branchName)
    setCheckingOut(null)
    if (result.success) {
      onBranchChange?.()
    } else {
      setActionError(result.error || 'Checkout failed')
    }
  }

  const handleCommitClick = (hash: string) => {
    setSelectedHash(selectedHash === hash ? null : hash)
  }

  const handleCopyHash = (hash: string) => {
    navigator.clipboard.writeText(hash).then(() => {
      setCopyFeedback(hash)
      setTimeout(() => setCopyFeedback(null), 2000)
    })
  }

  const handleRevert = async () => {
    if (!confirmAction) return
    setActionError(null)
    const result = await gitTree.revert(confirmAction.commitHash, confirmAction.strategy)
    if (result.success) {
      setConfirmAction(null)
      setSelectedHash(null)
      onBranchChange?.()
    } else {
      setActionError(result.error || 'Action failed')
    }
  }

  if (!open) return null

  const currentBranch = gitTree.currentBranch
  const commits = gitTree.data?.commits ?? []
  const selectedCommit = commits.find(c => c.hash === selectedHash)

  return (
    <>
      <div className="git-tree-panel__backdrop" />
      <div className="git-tree-panel" ref={panelRef}>
        <div className="git-tree-panel__header">
          <h2 className="git-tree-panel__title">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 6, verticalAlign: 'middle' }}>
              <line x1="6" y1="3" x2="6" y2="15" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M18 9a9 9 0 0 1-9 9" />
            </svg>
            Git Tree
          </h2>
          <div className="git-tree-panel__header-actions">
            <div className="git-tree-panel__view-toggle">
              <button
                className={`git-tree-panel__view-btn${viewMode === 'graph' ? ' git-tree-panel__view-btn--active' : ''}`}
                onClick={() => setViewMode('graph')}
                title="Graph view"
              >
                🔀 Graph
              </button>
              <button
                className={`git-tree-panel__view-btn${viewMode === 'list' ? ' git-tree-panel__view-btn--active' : ''}`}
                onClick={() => setViewMode('list')}
                title="List view"
              >
                📋 List
              </button>
            </div>
            <button className="git-tree-panel__close" onClick={onClose} title="Close">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        {gitTree.loading && !gitTree.data && (
          <div className="git-tree-panel__loading">
            <div className="git-tree-panel__spinner" />
            Loading git history...
          </div>
        )}

        {actionError && (
          <div className="git-tree-panel__error">
            {actionError}
            <button className="git-tree-panel__error-dismiss" onClick={() => setActionError(null)}>×</button>
          </div>
        )}

        {viewMode === 'graph' ? (
          <GitTreeGraph
            commits={commits}
            branches={gitTree.data?.branches ?? []}
            currentBranch={currentBranch}
            selectedHash={selectedHash}
            onCommitClick={handleCommitClick}
            onBranchClick={handleCheckout}
            checkingOut={checkingOut}
          />
        ) : (
          <>
            {localBranches.length > 0 && (
              <div className="git-tree-panel__branches">
                {localBranches.map(branch => (
                  <button
                    key={branch.name}
                    className={`git-tree-panel__branch-tag${branch.name === currentBranch ? ' git-tree-panel__branch-tag--active' : ''}`}
                    style={{ '--branch-color': BRANCH_COLORS[laneMap.get(branch.name) ?? 0] } as React.CSSProperties}
                    onClick={() => handleCheckout(branch.name)}
                    disabled={checkingOut !== null}
                    title={branch.name === currentBranch ? `Current branch: ${branch.name}` : `Switch to ${branch.name}`}
                  >
                    <span className="git-tree-panel__branch-dot" />
                    {branch.name}
                    {branch.isHead && <span className="git-tree-panel__head-badge">HEAD</span>}
                    {checkingOut === branch.name && <span className="git-tree-panel__checkout-spinner" />}
                  </button>
                ))}
              </div>
            )}
            <div className="git-tree-panel__commits">
              {commits.map(commit => {
                const isHead = commit.refs.some(r => r.startsWith('HEAD'))
                const branchRefs = commit.refs.filter(r => !r.startsWith('HEAD'))
                const lane = branchRefs.length > 0 ? (laneMap.get(branchRefs[0]) ?? 0) : 0
                return (
                  <div
                    key={commit.hash}
                    className={`git-tree-panel__commit${isHead ? ' git-tree-panel__commit--head' : ''}${selectedHash === commit.hash ? ' git-tree-panel__commit--selected' : ''}`}
                    style={{ '--lane-color': BRANCH_COLORS[lane] } as React.CSSProperties}
                    onClick={() => handleCommitClick(commit.hash)}
                  >
                    <div className="git-tree-panel__commit-lane">
                      <div className="git-tree-panel__lane-line" />
                      <div className="git-tree-panel__commit-dot" />
                    </div>
                    <div className="git-tree-panel__commit-info">
                      <div className="git-tree-panel__commit-msg">{commit.message}</div>
                      <div className="git-tree-panel__commit-meta">
                        <span className="git-tree-panel__commit-hash">{commit.shortHash}</span>
                        <span className="git-tree-panel__commit-author">{commit.author}</span>
                        <span className="git-tree-panel__commit-time">{formatRelativeTime(commit.date)}</span>
                      </div>
                      {branchRefs.length > 0 && (
                        <div className="git-tree-panel__commit-refs">
                          {branchRefs.map(ref => (
                            <span key={ref} className="git-tree-panel__ref-tag" style={{ background: `${BRANCH_COLORS[laneMap.get(ref) ?? 0]}18`, color: BRANCH_COLORS[laneMap.get(ref) ?? 0], borderColor: `${BRANCH_COLORS[laneMap.get(ref) ?? 0]}40` }}>
                              {ref}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
              {commits.length === 0 && !gitTree.loading && (
                <div className="git-tree-panel__empty">No commits found</div>
              )}
            </div>
          </>
        )}

        {/* Selected commit action strip */}
        {selectedCommit && (
          <div className="git-tree-panel__action-strip">
            <div className="git-tree-panel__action-strip-info">
              <span className="git-tree-panel__action-strip-hash">{selectedCommit.shortHash}</span>
              <span className="git-tree-panel__action-strip-msg">{selectedCommit.message}</span>
            </div>
            <div className="git-tree-panel__action-strip-btns">
              <button className="git-tree-panel__action-strip-btn" onClick={() => {
                setConfirmAction({
                  commitHash: selectedCommit.hash,
                  strategy: 'revert',
                  message: `Revert commit ${selectedCommit.shortHash}: "${selectedCommit.message}"?\n\nThis creates a new commit that undoes the changes from the selected commit.`,
                })
              }}>
                ↩ Revert
              </button>
              <button className="git-tree-panel__action-strip-btn git-tree-panel__action-strip-btn--danger" onClick={() => {
                setConfirmAction({
                  commitHash: selectedCommit.hash,
                  strategy: 'reset',
                  message: `Soft reset to commit ${selectedCommit.shortHash}: "${selectedCommit.message}"?\n\nThis moves HEAD to the selected commit. Uncommitted changes are preserved, but commits after this point will no longer be in the branch history.`,
                })
              }}>
                ⟲ Reset here
              </button>
              <button className="git-tree-panel__action-strip-btn git-tree-panel__action-strip-btn--muted" onClick={() => handleCopyHash(selectedCommit.hash)}>
                📋 {copyFeedback === selectedCommit.hash ? 'Copied!' : 'Copy hash'}
              </button>
              <button className="git-tree-panel__action-strip-close" onClick={() => setSelectedHash(null)}>×</button>
            </div>
          </div>
        )}
      </div>

      {confirmAction && (
        <ConfirmModal
          open={true}
          title={confirmAction.strategy === 'revert' ? 'Revert Commit' : 'Reset to Commit'}
          message={confirmAction.message}
          confirmLabel={confirmAction.strategy === 'revert' ? 'Revert' : 'Reset'}
          danger={confirmAction.strategy === 'reset'}
          onConfirm={handleRevert}
          onCancel={() => setConfirmAction(null)}
        />
      )}
    </>
  )
}