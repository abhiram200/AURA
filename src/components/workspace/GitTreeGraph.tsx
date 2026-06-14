import { useMemo } from 'react'
import type { GitCommit, GitBranch } from '../../hooks/useGitTree'

const BRANCH_COLORS = [
  '#00f0ff', '#8b5cf6', '#f093fb', '#4ecdc4', '#ffd93d',
  '#ff6b6b', '#45b7d1', '#96ceb4', '#ff8a5c', '#6c63ff',
]

const COMMIT_SPACING = 52
const DOT_RADIUS = 5
const MERGE_DOT_RADIUS = 6
const SVG_LEFT_PAD = 30
const LABEL_OFFSET = 14 // px after the dot center for label start
const MAX_MSG_LEN = 48 // max commit message chars shown in graph

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
  usedLanes: Set<number>
}

function assignLanes(commits: GitCommit[], branches: GitBranch[], currentBranch: string | null): LaneAssignment {
  const laneMap = new Map<string, number>()
  const locals = branches.filter(b => !b.isRemote)

  // Sort local branches: main/master first, then current branch, then alphabetically
  // This ensures the primary branch claims the shared ancestry line
  const sortedLocals = [...locals].sort((a, b) => {
    if (a.name === 'main' || a.name === 'master') return -1
    if (b.name === 'main' || b.name === 'master') return 1
    if (a.name === currentBranch) return -1
    if (b.name === currentBranch) return 1
    return a.name.localeCompare(b.name)
  })

  sortedLocals.forEach((b, i) => {
    laneMap.set(b.name, i)
  })
  branches.filter(b => b.isRemote).forEach(b => {
    // b.name from git for-each-ref %(refname:short) is "origin/main", not "remotes/origin/main"
    const localName = b.name.replace(/^[^/]+\//, '')
    if (laneMap.has(localName)) {
      laneMap.set(b.name, laneMap.get(localName)!)
    } else {
      laneMap.set(b.name, laneMap.size)
    }
  })

  // Build commit lookup for parent traversal
  const commitMap = new Map<string, GitCommit>()
  for (const commit of commits) {
    commitMap.set(commit.hash, commit)
  }

  const commitLanes = new Map<string, number>()

  // Trace first-parent chains from each branch HEAD backward.
  // Process primary branch first so it claims shared ancestry.
  // Each branch claims its HEAD on its own lane so the branch has a dot,
  // then traces first-parent ancestry, stopping at already-claimed commits.
  for (const branch of sortedLocals) {
    const lane = laneMap.get(branch.name)!
    commitLanes.set(branch.commitHash, lane)
    let currentHash: string | undefined = branch.commitHash
    let isFirst = true
    while (currentHash) {
      if (!isFirst && commitLanes.has(currentHash)) break // shared ancestor — stop
      if (!isFirst) commitLanes.set(currentHash, lane)
      isFirst = false
      const commit = commitMap.get(currentHash)
      if (!commit || commit.parentHashes.length === 0) break
      currentHash = commit.parentHashes[0] // follow first parent
    }
  }

  // Fix merge commits: a merge commit (2+ parents) should be on the lane
  // of its first parent (the "main line"), not on a sub-branch's lane.
  // This ensures the merge dot appears on the primary branch lane with
  // a curve connecting from the sub-branch.
  for (const commit of commits) {
    if (commit.parentHashes.length > 1) {
      const firstParentLane = commitLanes.get(commit.parentHashes[0])
      if (firstParentLane !== undefined) {
        commitLanes.set(commit.hash, firstParentLane)
      }
    }
  }

  // Also trace remote branches onto their local branch's lane
  for (const branch of branches.filter(b => b.isRemote)) {
    const lane = laneMap.get(branch.name)
    if (lane === undefined) continue
    // Only trace if the remote HEAD is different from local HEAD
    const localName = branch.name.replace(/^[^/]+\//, '')
    const localBranch = sortedLocals.find(b => b.name === localName)
    if (localBranch && branch.commitHash === localBranch.commitHash) continue
    const existingLane = commitLanes.get(branch.commitHash)
    if (existingLane === undefined || existingLane > lane) {
      commitLanes.set(branch.commitHash, lane)
    }
    let currentHash: string | undefined = branch.commitHash
    let isFirst = true
    while (currentHash) {
      if (!isFirst && commitLanes.has(currentHash)) break
      if (!isFirst) commitLanes.set(currentHash, lane)
      isFirst = false
      const commit = commitMap.get(currentHash)
      if (!commit || commit.parentHashes.length === 0) break
      currentHash = commit.parentHashes[0]
    }
  }

  const usedLanes = new Set(commitLanes.values())
  return { laneMap, commitLanes, usedLanes }
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
  const { laneMap, commitLanes, usedLanes } = useMemo(
    () => assignLanes(commits, branches, currentBranch),
    [commits, branches, currentBranch]
  )

  const localBranches = useMemo(() => branches.filter(b => !b.isRemote), [branches])

  // Invert: commit hash -> list of local branch names that point to it
  const commitBranchLabels = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const b of localBranches) {
      const list = map.get(b.commitHash) ?? []
      list.push(b.name)
      map.set(b.commitHash, list)
    }
    return map
  }, [localBranches])

  // Compute lane X positions: spread used lanes evenly
  const laneXMap = useMemo(() => {
    const sortedLanes = Array.from(usedLanes).sort((a, b) => a - b)
    const map = new Map<number, number>()
    sortedLanes.forEach((lane, i) => {
      map.set(lane, i * 80 + SVG_LEFT_PAD)
    })
    return map
  }, [usedLanes])

  // SVG width: rightmost lane + room for truncated text
  const svgWidth = useMemo(() => {
    let maxX = SVG_LEFT_PAD
    for (const x of laneXMap.values()) {
      if (x > maxX) maxX = x
    }
    return maxX + LABEL_OFFSET + MAX_MSG_LEN * 6 + 16
  }, [laneXMap])
  const svgHeight = commits.length * COMMIT_SPACING + 40

  function truncateMsg(msg: string): string {
    return msg.length > MAX_MSG_LEN ? msg.slice(0, MAX_MSG_LEN) + '…' : msg
  }

  const connections = useMemo(() => {
    const conns: Connection[] = []
    const commitYMap = new Map<string, number>()
    commits.forEach((c, i) => commitYMap.set(c.hash, i * COMMIT_SPACING + 20))

    for (const commit of commits) {
      const childLane = commitLanes.get(commit.hash) ?? 0
      const childY = commitYMap.get(commit.hash) ?? 0
      const childX = laneXMap.get(childLane) ?? SVG_LEFT_PAD

      for (const parentHash of commit.parentHashes) {
        const parentLane = commitLanes.get(parentHash)
        const parentY = commitYMap.get(parentHash)
        if (parentLane === undefined || parentY === undefined) continue

        if (parentLane !== childLane) {
          const parentX = laneXMap.get(parentLane) ?? SVG_LEFT_PAD
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
  }, [commits, commitLanes, laneXMap])

  // Build same-lane vertical segments
  const sameLaneSegments = useMemo(() => {
    const laneCommits = new Map<number, { y: number; hash: string }[]>()
    commits.forEach((commit, i) => {
      const lane = commitLanes.get(commit.hash) ?? 0
      if (!laneCommits.has(lane)) laneCommits.set(lane, [])
      laneCommits.get(lane)!.push({ y: i * COMMIT_SPACING + 20, hash: commit.hash })
    })

    const segments: { lane: number; y1: number; y2: number }[] = []
    for (const [lane, items] of laneCommits) {
      if (items.length === 1) {
        segments.push({ lane, y1: items[0].y - 15, y2: items[0].y + 15 })
      } else {
        segments.push({ lane, y1: items[0].y, y2: items[items.length - 1].y })
      }
    }
    return segments
  }, [commits, commitLanes])

  if (commits.length === 0) {
    return <div className="git-tree-graph__empty">No commits found</div>
  }

  return (
    <div className="git-tree-graph">
      {localBranches.length > 0 && (
        <div className="git-tree-graph__branches">
          {localBranches.map(branch => {
            const lane = laneMap.get(branch.name) ?? 0
            const color = BRANCH_COLORS[lane % BRANCH_COLORS.length]
            return (
              <button
                key={branch.name}
                className={`git-tree-graph__branch-tag${branch.name === currentBranch ? ' git-tree-graph__branch-tag--active' : ''}`}
                style={{ '--branch-color': color } as React.CSSProperties}
                onClick={() => onBranchClick(branch.name)}
                disabled={checkingOut !== null}
                title={branch.name === currentBranch ? `Current branch: ${branch.name}` : `Switch to ${branch.name}`}
              >
                <span className="git-tree-graph__branch-dot" />
                {branch.name}
                {branch.isHead && <span className="git-tree-graph__head-badge">HEAD</span>}
                {checkingOut === branch.name && <span className="git-tree-graph__checkout-spinner" />}
              </button>
            )
          })}
        </div>
      )}

      <div className="git-tree-graph__scroll">
        <svg width={svgWidth} height={svgHeight} className="git-tree-graph__svg">
          {/* Same-lane vertical line segments */}
          {sameLaneSegments.map((seg, i) => {
            const x = laneXMap.get(seg.lane) ?? SVG_LEFT_PAD
            const color = BRANCH_COLORS[seg.lane % BRANCH_COLORS.length]
            return (
              <line
                key={`lane-${i}`}
                x1={x} y1={seg.y1}
                x2={x} y2={seg.y2}
                stroke={color}
                strokeWidth={2}
                strokeOpacity={0.2}
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

          {/* Commit dots and labels */}
          {commits.map((commit, i) => {
            const lane = commitLanes.get(commit.hash) ?? 0
            const x = laneXMap.get(lane) ?? SVG_LEFT_PAD
            const y = i * COMMIT_SPACING + 20
            const color = BRANCH_COLORS[lane % BRANCH_COLORS.length]
            const isHead = commit.refs.some(r => r.startsWith('HEAD'))
            const isMerge = commit.parentHashes.length > 1
            const isSelected = selectedHash === commit.hash

            // Only show local branch labels on their HEAD commit
            const branchLabels = commitBranchLabels.get(commit.hash) ?? []

            // Show remote refs that are NOT the tracking branch of a local label
            // (e.g., show "origin/gh-pages" but not "origin/main" if "main" is already shown)
            const localBranchSet = new Set(branchLabels)
            const remoteLabels = commit.refs
              .filter(r => !r.startsWith('HEAD'))
              .filter(r => {
                if (r.startsWith('origin/')) {
                  const shortName = r.replace(/^origin\//, '')
                  // Skip if a local branch with that name is already shown
                  return !localBranchSet.has(shortName)
                }
                return false
              })

            // Whether this commit row needs extra height for branch labels
            const hasLabels = branchLabels.length > 0 || remoteLabels.length > 0

            // Label start X: right next to the dot
            const labelX = x + LABEL_OFFSET

            return (
              <g key={commit.hash} className={`git-tree-graph__commit-group${isSelected ? ' git-tree-graph__commit-group--selected' : ''}`}>
                {/* Merge dot: outer ring */}
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

                {/* Branch labels (only on branch HEAD commits) — positioned next to dot */}
                {hasLabels && (
                  <g>
                    {branchLabels.map((name, ri) => {
                      const refColor = BRANCH_COLORS[(laneMap.get(name) ?? lane) % BRANCH_COLORS.length]
                      const textWidth = name.length * 5.5 + 14
                      const pillX = labelX + ri * (textWidth + 4)
                      return (
                        <g key={`local-${name}`}>
                          <rect
                            x={pillX}
                            y={y - 12}
                            width={textWidth}
                            height={14}
                            rx={7}
                            fill={`${refColor}22`}
                            stroke={`${refColor}55`}
                            strokeWidth={0.5}
                          />
                          <text
                            x={pillX + textWidth / 2}
                            y={y - 3}
                            fill={refColor}
                            fontSize={8}
                            textAnchor="middle"
                            fontWeight={600}
                          >
                            {name}
                          </text>
                        </g>
                      )
                    })}
                    {remoteLabels.map((ref, ri) => {
                      const refColor = BRANCH_COLORS[(laneMap.get(ref) ?? lane) % BRANCH_COLORS.length]
                      const displayName = ref.replace(/^origin\//, '')
                      const textWidth = displayName.length * 5.5 + 14
                      const offset = (branchLabels.length + ri) * (textWidth + 4)
                      const pillX = labelX + offset
                      return (
                        <g key={`remote-${ref}`}>
                          <rect
                            x={pillX}
                            y={y - 12}
                            width={textWidth}
                            height={14}
                            rx={7}
                            fill={`${refColor}22`}
                            stroke={`${refColor}55`}
                            strokeWidth={0.5}
                          />
                          <text
                            x={pillX + textWidth / 2}
                            y={y - 3}
                            fill={refColor}
                            fontSize={8}
                            textAnchor="middle"
                            fontWeight={600}
                          >
                            {displayName}
                          </text>
                        </g>
                      )
                    })}
                  </g>
                )}

                {/* Commit message — positioned next to dot */}
                <text
                  x={labelX}
                  y={hasLabels ? y + 10 : y + 4}
                  fill="#e6edf3"
                  fontSize={11}
                  className="git-tree-graph__label"
                  style={{ cursor: 'pointer', pointerEvents: 'all' }}
                  onClick={() => onCommitClick(commit.hash)}
                >
                  {commit.shortHash} {truncateMsg(commit.message)}
                </text>
                {/* Author + time */}
                <text
                  x={labelX}
                  y={hasLabels ? y + 22 : y + 16}
                  fill="#8b949e"
                  fontSize={9}
                >
                  {commit.author} · {formatRelativeTime(commit.date)}
                </text>
              </g>
            )
          })}
        </svg>
      </div>
    </div>
  )
}