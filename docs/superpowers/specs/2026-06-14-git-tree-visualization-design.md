# Git Tree Visualization — Design Spec

**Date:** 2026-06-14

## Context

The GitTreePanel currently shows a flat list of commits with colored dots. The user wants a proper DAG (directed acyclic graph) visualization alongside this list view — with parallel branch lanes, bezier merge/fork curves, and topology-aware layout. The existing list view is kept as a toggle option.

## Design Decisions

### Two-mode panel with toggle
- **Graph mode** (default): Vertical top-down DAG with parallel branch lanes and bezier curves
- **List mode**: Current flat list (already implemented)
- Toggle via segmented control in the panel header: `🔀 Graph` | `📋 List`

### Graph layout algorithm
- **Top-down vertical**: Commits flow top→bottom, branch lanes are columns left→right
- **Lane assignment**: Local branches get sequential lane indices (0, 1, 2, ...). Remote branches map to their local counterpart's lane (e.g. `origin/main` shares `main`'s lane)
- **Lane widths**: Fixed 100px per lane, with the panel scrolling horizontally if many branches exist
- **Fork lines**: Bezier curves from parent lane to child lane when a commit's parents span multiple lanes
- **Merge lines**: Bezier curves from child lane to parent lane for merge commits
- **Commit dots**: Filled circle for HEAD, ring-with-inner-circle for merge commits, standard filled dot otherwise. Each dot colored by its lane color.

### Actions (no diff view)
- **Branch checkout**: Click branch tag in the tags row
- **Commit actions**: Click a commit dot → show action panel with:
  - **Revert** — creates a new revert commit (`git revert --no-edit`)
  - **Reset here** — soft reset to that commit (`git reset --soft`)
  - **Copy hash** — copies the full commit hash to clipboard
- Both Revert and Reset show a confirmation modal before executing

### Inline commit info
- When a commit is selected, a small detail strip appears at the bottom showing:
  - Short hash + commit message
  - Three action buttons (Revert, Reset here, Copy hash)
  - Close button (×)

### Colors
- 10-color palette for branch lanes (same as current: `#00f0ff`, `#8b5cf6`, `#f093fb`, `#4ecdc4`, `#ffd93d`, `#ff6b6b`, `#45b7d1`, `#96ceb4`, `#ff8a5c`, `#6c63ff`)
- Lane lines at 15% opacity, curves at 50% opacity, dots at full color
- HEAD commit dot gets a glow/box-shadow in its lane color

## Architecture

### New server endpoint
- `GET /api/workspace/:id/git-log` — already implemented, returns `{ commits, branches }` with `parentHashes` field needed for DAG layout

### New client component
- `src/components/workspace/GitTreeGraph.tsx` — The SVG-based DAG graph renderer
  - Takes `commits`, `branches`, `currentBranch` as props
  - Computes lane assignments and vertical positions
  - Renders SVG with lane lines, bezier curves, commit dots, and labels
  - Emits `onCommitClick(hash)` and `onBranchClick(name)` events

### Modified component
- `GitTreePanel.tsx` — Adds view mode state (`graph` | `list`), renders toggle in header, conditionally renders either `GitTreeGraph` or the existing list view

### Layout algorithm (in GitTreeGraph)
1. Assign lanes: local branches → 0..N, remotes → counterpart lane
2. Build a hash→commit map for parent lookup
3. For each commit (top→bottom), determine which lane it sits on:
   - If it has refs matching a branch, use that branch's lane
   - Otherwise, find the lane of its first parent
4. Track lane connections: for each commit, draw bezier curves from each parent's lane to the commit's lane if they differ
5. Merge commits (2+ parents) get a dual-circle indicator and curves from each parent lane

### SVG rendering
- Canvas width = `numLanes * 100 + 200` (lanes + label space)
- Canvas height = `commits.length * 40 + 40` (spacing per commit)
- Lane lines: vertical `<line>` at `x = laneIndex * 100 + 30`
- Fork curves: `<path d="M x1,y1 C x1,y1+dy/2 x2,y2-dy/2 x2,y2">` (cubic bezier)
- Commit dots: `<circle>` at lane position, colored by lane
- Labels: `<text>` positioned right of the dot
- Scrollable via CSS `overflow-y: auto` on the container

## Files to modify/create

| File | Change |
|------|--------|
| `src/components/workspace/GitTreeGraph.tsx` | New — SVG DAG graph component |
| `src/components/workspace/GitTreePanel.tsx` | Add view mode toggle, render GitTreeGraph in graph mode |
| `src/styles/workspace.css` | Add GitTreeGraph SVG styles, view toggle styles |

No server changes needed — the existing `git-log` endpoint already returns `parentHashes` which the DAG algorithm needs.

## Verification

1. Open git tree panel → default to Graph mode
2. See vertical lanes with colored lane lines
3. Fork/merge curves connect lanes correctly
4. Click branch tag → checkout confirmation → branch switches
5. Click commit dot → action strip appears at bottom with Revert/Reset/Copy
6. Click Copy hash → hash copied to clipboard with toast feedback
7. Toggle to List mode → existing list view renders
8. Toggle back to Graph mode → graph re-renders
9. Light mode renders correctly