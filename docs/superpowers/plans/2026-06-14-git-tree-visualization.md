# Git Tree Visualization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a vertical DAG graph visualization mode to the existing GitTreePanel, with parallel branch lanes, bezier merge/fork curves, and a view toggle between Graph and List modes.

**Architecture:** A new `GitTreeGraph` component renders an SVG DAG using lane-assignment logic and bezier curves. The existing `GitTreePanel` adds a `viewMode` state and a segmented toggle in the header, conditionally rendering either `GitTreeGraph` or the existing list. No server changes — the `git-log` endpoint already returns `parentHashes`.

**Tech Stack:** React, TypeScript, inline SVG, CSS custom properties for theming

---

### Task 1: Create GitTreeGraph component

**Files:**
- Create: `src/components/workspace/GitTreeGraph.tsx`

- [ ] **Step 1: Create the GitTreeGraph component with layout algorithm, SVG rendering, and interaction handlers**

Create `src/components/workspace/GitTreeGraph.tsx` with the following complete implementation:

```tsx
import { useMemo } from 'react'
import type { GitCommit, GitBranch } from '../../hooks/useGitTree'

const BRANCH_COLORS = [
  '#00f0ff', '#8b5cf6', '#f093fb', '#4ecdc4', '#ffd93d',
  '#ff6b6b', '#45b7d1', '#96ceb4', '#ff8a5c', '#6c63ff',
]

const LANE_WIDTH = 100
const COMMIT_SPACING = 44
const DOT_RADIUS = 5
const MERGE_DOT_RADIUS = 6
const LABEL_X_OFFSET = 16
const SVG_LEFT_PAD = 30

function formatRelativeTime(timestamp: number): string {
  const now = Date.now() / 1000
  const diff = now - timestamp
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  if (diff < 2592000) return `${Math.floor(diff / 86400)}d ago`
  return new Date(timestamp * 1000).toLocaleDateString()
}

interface GitTreeGraphProps {
  commits: GitCommit[]
  branches: GitBranch[]
  currentBranch: string | null
  selectedHash: string | null
  onCommitClick: (hash: string) => void
  onBranchClick: (branchName: string) => void
  checkingOut: string | null
}

interface LaneAssignment {
  laneMap: Map<string, number>
  commitLanes: Map<string, number>
  numLanes: number
}

function assignLanes(commits: GitCommit[], branches: GitBranch[]): LaneAssignment {
  // Map branch names to lane indices
  const laneMap = new Map<string, number>()
  const locals = branches.filter(b => !b.isRemote)
  locals.forEach((b, i) => {
    laneMap.set(b.name, i % BRANCH_COLORS.length)
  })
  branches.filter(b => b.isRemote).forEach(b => {
    const localName = b.name.replace(/^remotes\/[^/]+\//, '')
    if (laneMap.has(localName)) {
      laneMap.set(b.name, laneMap.get(localName)!)
    } else {
      laneMap.set(b.name, laneMap.size % BRANCH_COLORS.length)
    }
  })

  // Build commit hash -> commit map for parent lookup
  const commitMap = new Map<string, GitCommit>()
  for (const c of commits) {
    commitMap.set(c.hash, c)
  }

  // Assign each commit to a lane
  const commitLanes = new Map<string, number>()

  // First pass: assign commits that have explicit branch refs
  for (const commit of commits) {
    const branchRefs = commit.refs.filter(r => !r.startsWith('HEAD'))
    for (const ref of branchRefs) {
      const refName = ref.replace(/^HEAD -> /, '')
      if (laneMap.has(refName)) {
        commitLanes.set(commit.hash, laneMap.get(refName)!)
        break
      }
    }
  }

  // Second pass: commits without explicit branch refs inherit from first parent
  for (const commit of commits) {
    if (commitLanes.has(commit.hash)) continue
    if (commit.parentHashes.length > 0) {
      const parentLane = commitLanes.get(commit.parentHashes[0])
      if (parentLane !== undefined) {
        commitLanes.set(commit.hash, parentLane)
      } else {
        // Parent not in our visible range — assign lane 0 (main)
        commitLanes.set(commit.hash, 0)
      }
    } else {
      // Root commit
      commitLanes.set(commit.hash, 0)
    }
  }

  const numLanes = Math.max(laneMap.size, ...Array.from(commitLanes.values())) + 1
  return { laneMap, commitLanes, numLanes }
}

interface Connection {
  fromX: number
  fromY: number
  toX: number
  toY: number
  color: string
}

export function GitTreeGraph({
  commits,
  branches,
  currentBranch,
  selectedHash,
  onCommitClick,
  onBranchClick,
  checkingOut,
}: GitTreeGraphProps) {
  const { laneMap, commitLanes, numLanes } = useMemo(
    () => assignLanes(commits, branches),
    [commits, branches]
  )

  const localBranches = useMemo(() => branches.filter(b => !b.isRemote), [branches])

  // Precompute SVG dimensions
  const svgWidth = Math.max(numLanes * LANE_WIDTH + 220, 340)
  const svgHeight = commits.length * COMMIT_SPACING + 40

  // Build connections (curves from parent to child)
  const connections = useMemo(() => {
    const conns: Connection[] = []
    const commitYMap = new Map<string, number>()
    commits.forEach((c, i) => commitYMap.set(c.hash, i * COMMIT_SPACING + 20))

    for (const commit of commits) {
      const childLane = commitLanes.get(commit.hash) ?? 0
      const childY = commitYMap.get(commit.hash) ?? 0
      const childX = childLane * LANE_WIDTH + SVG_LEFT_PAD

      for (const parentHash of commit.parentHashes) {
        const parentLane = commitLanes.get(parentHash)
        const parentY = commitYMap.get(parentHash)
        if (parentLane === undefined || parentY === undefined) continue

        if (parentLane !== childLane) {
          // Cross-lane connection — draw bezier curve
          const parentX = parentLane * LANE_WIDTH + SVG_LEFT_PAD
          conns.push({
            fromX: parentX,
            fromY: parentY,
            toX: childX,
            toY: childY,
            color: BRANCH_COLORS[parentLane % BRANCH_COLORS.length],
          })
        }
      }
    }
    return conns
  }, [commits, commitLanes])

  // Precompute branch -> commitHash mapping for labels
  const branchHeadMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const b of localBranches) {
      map.set(b.name, b.commitHash)
    }
    return map
  }, [localBranches])

  if (commits.length === 0) {
    return <div className="git-tree-graph__empty">No commits found</div>
  }

  return (
    <div className="git-tree-graph">
      {/* Branch tags row */}
      {localBranches.length > 0 && (
        <div className="git-tree-graph__branches">
          {localBranches.map(branch => (
            <button
              key={branch.name}
              className={`git-tree-graph__branch-tag${branch.name === currentBranch ? ' git-tree-graph__branch-tag--active' : ''}`}
              style={{ '--branch-color': BRANCH_COLORS[laneMap.get(branch.name) ?? 0] } as React.CSSProperties}
              onClick={() => onBranchClick(branch.name)}
              disabled={checkingOut !== null}
              title={branch.name === currentBranch ? `Current branch: ${branch.name}` : `Switch to ${branch.name}`}
            >
              <span className="git-tree-graph__branch-dot" />
              {branch.name}
              {branch.isHead && <span className="git-tree-graph__head-badge">HEAD</span>}
              {checkingOut === branch.name && <span className="git-tree-graph__checkout-spinner" />}
            </button>
          ))}
        </div>
      )}

      {/* SVG graph */}
      <div className="git-tree-graph__scroll">
        <svg width={svgWidth} height={svgHeight} className="git-tree-graph__svg">
          {/* Lane lines */}
          {Array.from({ length: numLanes }, (_, i) => {
            const x = i * LANE_WIDTH + SVG_LEFT_PAD
            const color = BRANCH_COLORS[i % BRANCH_COLORS.length]
            return (
              <line
                key={`lane-${i}`}
                x1={x} y1={0}
                x2={x} y2={svgHeight}
                stroke={color}
                strokeWidth={2}
                strokeOpacity={0.15}
              />
            )
          })}

          {/* Cross-lane connections (bezier curves) */}
          {connections.map((conn, i) => {
            const midY = (conn.fromY + conn.toY) / 2
            return (
              <path
                key={`conn-${i}`}
                d={`M ${conn.fromX} ${conn.fromY} C ${conn.fromX} ${midY}, ${conn.toX} ${midY}, ${conn.toX} ${conn.toY}`}
                fill="none"
                stroke={conn.color}
                strokeWidth={2}
                strokeOpacity={0.5}
              />
            )
          })}

          {/* Inline lane lines (connecting each commit to its lane) */}
          {commits.map((commit, i) => {
            const lane = commitLanes.get(commit.hash) ?? 0
            const x = lane * LANE_WIDTH + SVG_LEFT_PAD
            const y = i * COMMIT_SPACING + 20
            const prevY = i > 0 ? (i - 1) * COMMIT_SPACING + 20 : 0
            const nextY = i < commits.length - 1 ? (i + 1) * COMMIT_SPACING + 20 : svgHeight
            const color = BRANCH_COLORS[lane % BRANCH_COLORS.length]
            return (
              <line
                key={`line-${commit.hash}`}
                x1={x} y1={prevY}
                x2={x} y2={nextY}
                stroke={color}
                strokeWidth={2}
                strokeOpacity={0.15}
              />
            )
          })}

          {/* Commit dots and labels */}
          {commits.map((commit, i) => {
            const lane = commitLanes.get(commit.hash) ?? 0
            const x = lane * LANE_WIDTH + SVG_LEFT_PAD
            const y = i * COMMIT_SPACING + 20
            const color = BRANCH_COLORS[lane % BRANCH_COLORS.length]
            const isHead = commit.refs.some(r => r.startsWith('HEAD'))
            const isMerge = commit.parentHashes.length > 1
            const isSelected = selectedHash === commit.hash
            const branchRefs = commit.refs.filter(r => !r.startsWith('HEAD'))

            return (
              <g key={commit.hash} className={`git-tree-graph__commit-group${isSelected ? ' git-tree-graph__commit-group--selected' : ''}`}>
                {/* Merge dot: outer ring in merge-source color */}
                {isMerge && (
                  <circle
                    cx={x} cy={y}
                    r={MERGE_DOT_RADIUS + 2}
                    fill="none"
                    stroke={BRANCH_COLORS[(lane + 1) % BRANCH_COLORS.length]}
                    strokeWidth={2}
                    strokeOpacity={0.5}
                  />
                )}
                {/* Main dot */}
                <circle
                  cx={x} cy={y}
                  r={isHead ? DOT_RADIUS + 1 : DOT_RADIUS}
                  fill={isHead ? color : '#1e1e2e'}
                  stroke={color}
                  strokeWidth={isHead ? 0 : 2}
                  className="git-tree-graph__dot"
                  style={{ cursor: 'pointer', filter: isHead ? `drop-shadow(0 0 4px ${color})` : 'none' }}
                  onClick={() => onCommitClick(commit.hash)}
                />
                {/* Commit message */}
                <text
                  x={x + LABEL_X_OFFSET}
                  y={y - 4}
                  fill="#e6edf3"
                  fontSize={11}
                  className="git-tree-graph__label"
                  style={{ cursor: 'pointer', pointerEvents: 'all' }}
                  onClick={() => onCommitClick(commit.hash)}
                >
                  {commit.shortHash} {commit.message}
                </text>
                {/* Author + time */}
                <text
                  x={x + LABEL_X_OFFSET}
                  y={y + 10}
                  fill="#8b949e"
                  fontSize={9}
                >
                  {commit.author} · {formatRelativeTime(commit.date)}
                </text>
                {/* Branch ref tags */}
                {branchRefs.map((ref, ri) => {
                  const refColor = BRANCH_COLORS[laneMap.get(ref) ?? lane % BRANCH_COLORS.length]
                  const textWidth = ref.length * 5.5 + 14
                  return (
                    <g key={ri}>
                      <rect
                        x={x + LABEL_X_OFFSET + ri * (textWidth + 4)}
                        y={y - 18}
                        width={textWidth}
                        height={14}
                        rx={7}
                        fill={`${refColor}22`}
                        stroke={`${refColor}55`}
                        strokeWidth={0.5}
                      />
                      <text
                        x={x + LABEL_X_OFFSET + ri * (textWidth + 4) + textWidth / 2}
                        y={y - 9}
                        fill={refColor}
                        fontSize={8}
                        textAnchor="middle"
                        fontWeight={600}
                      >
                        {ref.replace(/^origin\//, '')}
                      </text>
                    </g>
                  )
                })}
              </g>
            )
          })}
        </svg>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors related to GitTreeGraph

- [ ] **Step 3: Commit**

```bash
git add src/components/workspace/GitTreeGraph.tsx
git commit -m "feat: add GitTreeGraph component with SVG DAG layout algorithm"
```

---

### Task 2: Add view mode toggle and integrate GitTreeGraph into GitTreePanel

**Files:**
- Modify: `src/components/workspace/GitTreePanel.tsx`

- [ ] **Step 1: Add viewMode state, import GitTreeGraph, and render conditionally**

The full replacement for `GitTreePanel.tsx` — this keeps the existing list view and adds the graph mode toggle and GitTreeGraph rendering:

```tsx
import { useState, useEffect, useMemo } from 'react'
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
            {/* Branch tags (list mode) */}
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
```

Note: The import of `useRef` must be added back at the top of the file (it was in the original). The full import line should be:
```tsx
import { useState, useEffect, useMemo, useRef } from 'react'
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/components/workspace/GitTreePanel.tsx
git commit -m "feat: add graph/list view toggle and commit action strip to GitTreePanel"
```

---

### Task 3: Add CSS styles for GitTreeGraph, view toggle, and action strip

**Files:**
- Modify: `src/styles/workspace.css`

- [ ] **Step 1: Add GitTreeGraph SVG styles, view toggle styles, action strip styles, and selected commit highlight**

Add the following CSS after the existing `.assistant-page__git-tree-btn:hover` rule and before the `/* === Light Mode Overrides === */` section:

```css
/* === Git Tree Graph === */
.git-tree-graph {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.git-tree-graph__branches {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 10px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  flex-shrink: 0;
}

.git-tree-graph__branch-tag {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 10px;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: none;
  color: var(--text-secondary);
  font-size: 11px;
  cursor: pointer;
  transition: all 0.15s;
  font-family: inherit;
}

.git-tree-graph__branch-tag:hover {
  background: rgba(255, 255, 255, 0.06);
  border-color: var(--branch-color);
  color: var(--text-primary);
}

.git-tree-graph__branch-tag--active {
  border-color: var(--accent-primary);
  color: var(--accent-primary);
  background: rgba(0, 240, 255, 0.06);
}

.git-tree-graph__branch-tag:disabled {
  opacity: 0.6;
  cursor: wait;
}

.git-tree-graph__branch-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--branch-color);
  flex-shrink: 0;
}

.git-tree-graph__head-badge {
  font-size: 9px;
  font-weight: 700;
  padding: 1px 4px;
  border-radius: 3px;
  background: rgba(0, 240, 255, 0.15);
  color: var(--accent-primary);
  margin-left: 2px;
}

.git-tree-graph__checkout-spinner {
  width: 10px;
  height: 10px;
  border: 2px solid rgba(255, 255, 255, 0.1);
  border-top: 2px solid var(--accent-primary);
  border-radius: 50%;
  animation: git-tree-spin 0.8s linear infinite;
}

.git-tree-graph__scroll {
  flex: 1;
  overflow-y: auto;
  overflow-x: auto;
  padding: 0;
}

.git-tree-graph__svg {
  display: block;
}

.git-tree-graph__dot {
  transition: r 0.15s;
}

.git-tree-graph__dot:hover {
  r: 7;
}

.git-tree-graph__label {
  transition: fill 0.1s;
}

.git-tree-graph__label:hover {
  fill: #ffffff !important;
  text-decoration: underline;
}

.git-tree-graph__commit-group--selected .git-tree-graph__dot {
  stroke-width: 3;
}

.git-tree-graph__empty {
  padding: 32px 16px;
  text-align: center;
  color: var(--text-tertiary);
  font-size: 13px;
}

/* View toggle in header */
.git-tree-panel__header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.git-tree-panel__view-toggle {
  display: flex;
  background: rgba(255, 255, 255, 0.06);
  border-radius: 6px;
  padding: 2px;
}

.git-tree-panel__view-btn {
  background: transparent;
  border: none;
  color: rgba(255, 255, 255, 0.4);
  padding: 3px 8px;
  border-radius: 4px;
  font-size: 10px;
  cursor: pointer;
  transition: all 0.15s;
  font-family: inherit;
  white-space: nowrap;
}

.git-tree-panel__view-btn--active {
  background: rgba(0, 240, 255, 0.15);
  border: 1px solid rgba(0, 240, 255, 0.3);
  color: #00f0ff;
}

.git-tree-panel__view-btn:hover:not(.git-tree-panel__view-btn--active) {
  color: var(--text-primary);
  background: rgba(255, 255, 255, 0.06);
}

/* Selected commit action strip */
.git-tree-panel__action-strip {
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  padding: 8px 16px;
  background: rgba(255, 255, 255, 0.03);
  flex-shrink: 0;
}

.git-tree-panel__action-strip-info {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.git-tree-panel__action-strip-hash {
  font-family: 'SF Mono', 'Cascadia Code', 'Consolas', monospace;
  font-size: 11px;
  color: var(--accent-primary);
  opacity: 0.8;
}

.git-tree-panel__action-strip-msg {
  font-size: 11px;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
}

.git-tree-panel__action-strip-btns {
  display: flex;
  gap: 6px;
  align-items: center;
  flex-wrap: wrap;
}

.git-tree-panel__action-strip-btn {
  padding: 4px 10px;
  font-size: 11px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.12);
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.15s;
  font-family: inherit;
  white-space: nowrap;
}

.git-tree-panel__action-strip-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: var(--text-primary);
}

.git-tree-panel__action-strip-btn--danger {
  color: #f14c4c;
  border-color: rgba(241, 76, 76, 0.2);
  background: rgba(241, 76, 76, 0.08);
}

.git-tree-panel__action-strip-btn--danger:hover {
  background: rgba(241, 76, 76, 0.15);
  color: #f14c4c;
}

.git-tree-panel__action-strip-btn--muted {
  color: var(--text-tertiary);
  border-color: rgba(255, 255, 255, 0.06);
}

.git-tree-panel__action-strip-btn--muted:hover {
  color: var(--text-secondary);
  background: rgba(255, 255, 255, 0.06);
}

.git-tree-panel__action-strip-close {
  background: none;
  border: none;
  color: var(--text-tertiary);
  cursor: pointer;
  font-size: 16px;
  padding: 0 4px;
  margin-left: auto;
}

.git-tree-panel__action-strip-close:hover {
  color: var(--text-primary);
}

/* Selected commit highlight (list mode) */
.git-tree-panel__commit--selected {
  background: rgba(0, 240, 255, 0.06) !important;
}
```

Also add the following light mode overrides at the end of the existing `.light` section (before the closing `}` of the last rule or after the last `.light` rule):

```css
/* Git Tree Graph - Light Mode */
.light .git-tree-graph__branch-tag {
  border-color: rgba(0, 0, 0, 0.12);
}

.light .git-tree-graph__branch-tag:hover {
  background: rgba(0, 0, 0, 0.04);
}

.light .git-tree-panel__view-btn--active {
  background: rgba(8, 145, 178, 0.1);
  border-color: rgba(8, 145, 178, 0.3);
  color: #0891b2;
}

.light .git-tree-panel__action-strip {
  border-top-color: rgba(0, 0, 0, 0.08);
  background: rgba(0, 0, 0, 0.02);
}

.light .git-tree-panel__action-strip-btn {
  background: rgba(0, 0, 0, 0.04);
  border-color: rgba(0, 0, 0, 0.1);
  color: #555;
}

.light .git-tree-panel__action-strip-btn:hover {
  background: rgba(0, 0, 0, 0.08);
  color: #222;
}

.light .git-tree-panel__action-strip-btn--danger {
  color: #dc2626;
  border-color: rgba(220, 38, 38, 0.2);
  background: rgba(220, 38, 38, 0.06);
}

.light .git-tree-panel__action-strip-btn--danger:hover {
  background: rgba(220, 38, 38, 0.12);
}

.light .git-tree-panel__commit--selected {
  background: rgba(8, 145, 178, 0.08) !important;
}
```

- [ ] **Step 2: Verify the app loads without CSS errors**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/styles/workspace.css
git commit -m "feat: add GitTreeGraph SVG styles, view toggle, and action strip CSS"
```

---

### Task 4: End-to-end verification

**Files:** None (testing only)

- [ ] **Step 1: Verify the dev server is running**

Run: `npm run dev` (or check it's already running)
Expected: Vite and backend servers start without errors

- [ ] **Step 2: Open a project in the builder, click the branch name in the status bar or the git-tree icon in the Builder tab**

Expected: GitTreePanel opens, defaulting to Graph mode

- [ ] **Step 3: Verify graph mode renders**

Expected: See vertical lane lines with branch colors, bezier curves for forks/merges, commit dots on lanes, branch ref labels, HEAD glow effect

- [ ] **Step 4: Click a commit dot in the graph**

Expected: Action strip appears at the bottom with commit hash, message, and Revert/Reset/Copy buttons

- [ ] **Step 5: Click "📋 Copy hash"**

Expected: Hash is copied to clipboard, button text briefly shows "Copied!"

- [ ] **Step 6: Toggle to List mode**

Expected: Existing list view renders with lane lines and branch tags

- [ ] **Step 7: Toggle back to Graph mode**

Expected: Graph re-renders correctly

- [ ] **Step 8: Click a branch tag in the graph view**

Expected: Checkout attempt runs, branch switches on success

- [ ] **Step 9: Verify light mode**

Switch to light theme and repeat steps 3-6. Expected: Proper contrast and colors.