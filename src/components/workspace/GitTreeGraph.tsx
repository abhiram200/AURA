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

  // Second pass: commits without explicit refs inherit from first parent
  for (const commit of commits) {
    if (commitLanes.has(commit.hash)) continue
    if (commit.parentHashes.length > 0) {
      const parentLane = commitLanes.get(commit.parentHashes[0])
      if (parentLane !== undefined) {
        commitLanes.set(commit.hash, parentLane)
      } else {
        commitLanes.set(commit.hash, 0)
      }
    } else {
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

  const svgWidth = Math.max(numLanes * LANE_WIDTH + 220, 340)
  const svgHeight = commits.length * COMMIT_SPACING + 40

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

  if (commits.length === 0) {
    return <div className="git-tree-graph__empty">No commits found</div>
  }

  return (
    <div className="git-tree-graph">
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

          {/* Inline lane lines (connecting each commit to its neighbors on the same lane) */}
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