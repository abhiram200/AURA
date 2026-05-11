# SYNAPSE — Synaptic Yielding of Nodal Associations for Pattern Synthesis and Extraction

## Overview

A native code intelligence system for A.U.R.A. that indexes project codebases into a dependency graph, provides impact analysis, 360-degree context, and visual graph exploration. Built as Express services — no child processes, no JSON-RPC relay. **Built standalone first with its own routes and services, not integrated into existing chat/context services until all tests pass.**

## Features (MVP)

1. Auto-index project on startup (TypeScript/JavaScript only)
2. Full codebase context for AI (what depends on what, change impact)
3. Impact analysis with depth grouping and confidence scoring
4. Visual graph representation (Sigma.js + Graphology)
5. 360-degree symbol context (incoming/outgoing references, members, hierarchy)
6. Basic text search (name/path matching)

## Features (Deferred)

- BM25 text search
- Ollama semantic search (embeddings)
- Auto re-index on file changes (chokidar)
- AI context files (`.aura-context.md` per folder)
- MCP server for external AI agents
- Python language support

## Architecture

### Services (server/services/synapse/)

| Service | File | Responsibility |
|---------|------|---------------|
| `SynapseIndexer` | `indexer.ts` | Scans files, parses with web-tree-sitter, builds graph, runs pipeline |
| `SynapseQueryService` | `graph.ts` | Loads graph, answers queries (impact, context, dependents, dependencies) |

### Routes (server/routes/)

| Route Prefix | File | Purpose |
|--------------|------|---------|
| `/api/synapse` | `synapse.ts` | Index, status, graph data, context, impact, search |

### Frontend (src/components/synapse/)

| Component | File | Purpose |
|-----------|------|---------|
| `SynapsePage` | `SynapsePage.tsx` | Replaces placeholder — full graph view |
| `SynapseGraph` | `SynapseGraph.tsx` | Sigma.js + Graphology WebGL graph renderer |
| `SynapsePanel` | `SynapsePanel.tsx` | Left sidebar — node info, references, impact, 360° context |
| `SynapseToolbar` | `SynapseToolbar.tsx` | Search, filters, view toggles, re-index |
| `SynapseProgress` | `SynapseProgress.tsx` | Progress bar with phase indicators |

### Hook (src/hooks/)

| Hook | File | Purpose |
|-----------|------|---------|
| `useSynapse` | `useSynapse.ts` | Dependency data, indexing status, search, selected node |

### Styles (src/styles/)

| File | Purpose |
|------|---------|
| `synapse.css` | All SYNAPSE component styles |

## Data Model

### Storage

All graph data stored as JSON in `<project-path>/.synapse/`:

```
.synapse/
  graph.json          # Full dependency graph (nodes + edges)
  meta.json           # lastCommit, indexedAt, stats
```

### Node Types

| Type | Represents |
|------|-----------|
| `File` | A source file |
| `Folder` | A directory |
| `Function` | A standalone function |
| `Class` | A class declaration |
| `Interface` | An interface or type declaration |
| `Method` | A method on a class/interface |
| `Variable` | An exported variable/const |

### Edge Types

| Type | Meaning |
|------|---------|
| `CONTAINS` | Folder → File, File → Symbol |
| `IMPORTS` | Symbol/File imports from another |
| `CALLS` | Symbol calls another symbol |
| `EXTENDS` | Class extends another class |
| `IMPLEMENTS` | Class implements an interface |
| `HAS_METHOD` | Class/Interface defines a method |
| `HAS_PROPERTY` | Class/Interface defines a property |
| `DEPENDS_ON` | File-level aggregated dependency |

### Node Schema

```typescript
interface SynapseNode {
  id: string;           // "src/hooks/useChat:useChat" or "src/index.ts"
  kind: SynapseNodeKind;    // File | Folder | Function | Class | Interface | Method | Variable
  name: string;         // Symbol name or file/folder name
  filePath: string;     // Relative path from project root
  range?: { startLine: number; endLine: number };
  exported: boolean;
  metadata?: Record<string, any>;
}
```

### Edge Schema

```typescript
interface SynapseEdge {
  source: string;       // Node id
  target: string;       // Node id
  type: SynapseEdgeType;
  confidence: number;   // 0.0 - 1.0
  metadata?: Record<string, any>;
}
```

### Confidence Scoring (import resolution tiers)

| Tier | Confidence | Method |
|------|-----------|--------|
| Same-file | 0.95 | Symbol table for caller's file |
| Import-scoped | 0.9 | Named import map chains |
| Global fallback | 0.5 | O(1) global index lookup |

## Indexing Pipeline

### Phases

1. **Scan** — Walk file tree, respect `.gitignore` + hardcoded ignore list (node_modules, dist, .git, build, coverage, .next, target, vendor, __pycache__, .terraform). Collect file paths and sizes.

2. **Parse** — For each TS/JS source file, use `web-tree-sitter` to:
   - Load the TypeScript/JavaScript WASM grammar
   - Extract symbol declarations (functions, classes, interfaces, methods, variables)
   - Extract imports (what this file imports and from where)
   - Extract calls (what functions/methods this symbol calls)
   - Extract heritage (extends, implements)
   - Mark exports

3. **Resolve** — Cross-file resolution:
   - Match imports to source files (3-tier: same-file → import-scoped → global)
   - Connect CALLS edges from callers to callees
   - Connect EXTENDS/IMPLEMENTS to parent classes/interfaces
   - Assign confidence scores

4. **Aggregate** — Build file-level DEPENDS_ON edges by rolling up symbol-level IMPORTS/CALLS to file level.

5. **Save** — Write `graph.json` and `meta.json` to `.synapse/` directory.

### Language Support (MVP)

TypeScript and JavaScript only. Additional languages (Python, etc.) deferred to follow-up.

### Auto-Index on Project Creation

When a project is opened/created, `SynapseIndexer.indexProject(projectPath)` is called automatically. The pipeline runs asynchronously and reports progress via SSE events.

### Incremental Re-Index (Deferred)

File watching and incremental re-indexing deferred. MVP uses manual re-index trigger.

## Query Engine

### Impact Analysis

Given a target symbol or file, traverse the graph outward by depth:

| Depth | Label | Meaning |
|-------|-------|---------|
| d=1 | WILL BREAK | Direct dependents |
| d=2 | LIKELY AFFECTED | Indirect dependents |
| d=3 | MAY NEED TESTING | Transitive dependents |

Directions:
- **Downstream** (default): "If I change X, what breaks?" — follows DEPENDS_ON, IMPORTS, CALLS forward
- **Upstream**: "What does X depend on?" — follows edges backward

Returns: grouped results with confidence scores, file paths, edge types per level.

### 360-Degree Context

Given a symbol or file, return:
- **Incoming references** — who imports/calls/extends this (grouped by type)
- **Outgoing references** — what this imports/calls/extends (grouped by type)
- **Definition** — file path, line range
- **Members** — methods and properties (for classes/interfaces)
- **Hierarchy** — extends/implements chain

### Basic Text Search (MVP)

Simple name/path matching for nodes:
- Case-insensitive substring match on node name and file path
- Returns: node id, name, kind, file path, relevance score

## Frontend

### SynapsePage

Replaces current placeholder in ProjectModeBuilderPage. Layout:
- **Top**: SynapseToolbar
- **Left**: SynapsePanel (node info, references, impact, 360° context)
- **Center**: SynapseGraph (Sigma.js WebGL canvas)
- **Bottom**: SynapseProgress (during indexing)

### SynapseGraph (Sigma.js v3 + Graphology)

- **ForceAtlas2** force-directed layout
- **Noverlap** post-layout cleanup
- **Curved edges** via `@sigma/edge-curve`
- Node colors by type: File=blue, Function=green, Class=orange, Interface=purple, Method=yellow, Variable=pink
- Node size proportional to degree (connection count)
- Edge colors by type: IMPORTS=blue, CALLS=violet, EXTENDS=orange, IMPLEMENTS=pink, CONTAINS=green, DEPENDS_ON=gray
- Hover node → highlight connections, dim rest
- Click node → populate SynapsePanel
- Two view modes: file-level (DEPENDS_ON edges) and symbol-level (all edge types)

### SynapsePanel (Left Sidebar)

- Node info: name, kind, file path, line range, exported status
- Incoming references list (who depends on this)
- Outgoing references list (what this depends on)
- Impact analysis with depth grouping
- 360° context summary
- Collapsible sections

### SynapseToolbar

- Search box with name/path matching
- Filter by node type (checkboxes)
- Filter by edge type (checkboxes)
- Zoom to fit / reset layout buttons
- Toggle file-level / symbol-level view
- Re-index button

### SynapseProgress

- Progress bar showing current phase (Scanning → Parsing → Resolving → Aggregating → Saving)
- Live node/edge count

### useSynapse Hook

- Fetches graph data from `/api/synapse/graph`
- Polls indexing status from `/api/synapse/status`
- Provides search function (calls `/api/synapse/search`)
- Provides impact/context query functions
- Manages selected node state

## API Routes

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/synapse/index/:projectId` | Start indexing |
| GET | `/api/synapse/status/:projectId` | Indexing progress |
| GET | `/api/synapse/graph/:projectId` | Full graph data (nodes + edges) |
| POST | `/api/synapse/search/:projectId` | Search nodes by name/path |
| POST | `/api/synapse/context/:projectId` | 360° context for a symbol |
| POST | `/api/synapse/impact/:projectId` | Impact analysis |

## File Structure

```
server/services/synapse/
  types.ts              — SynapseNode, SynapseEdge, enums, GraphData, ImpactResult, NodeContext
  indexer.ts            — SynapseIndexer: scan, parse, resolve, aggregate, save
  graph.ts             — SynapseGraph: load, impact, context, dependents, dependencies
  parser.ts             — Tree-sitter parsing utilities (language loaders, query helpers)

server/routes/
  synapse.ts            — Express router wiring all /api/synapse endpoints

src/components/synapse/
  SynapsePage.tsx
  SynapseGraph.tsx
  SynapsePanel.tsx
  SynapseToolbar.tsx
  SynapseProgress.tsx

src/hooks/
  useSynapse.ts         — Hook for synapse data, indexing status, search

src/styles/
  synapse.css           — All SYNAPSE component styles

src/pages/builder/
  DependenciesPage.tsx  — Updated to import and render Synapse components
```

## New Dependencies

| Package | Purpose |
|---------|---------|
| `web-tree-sitter` | WASM-based Tree-sitter parsing (no native compilation) |
| `sigma` | Sigma.js v3 WebGL graph renderer |
| `graphology` | Graph data structure |
| `graphology-types` | TypeScript types for Graphology |
| `graphology-layout-forceatlas2` | Force-directed layout |
| `graphology-layout-noverlap` | Overlap resolution |
| `@sigma/edge-curve` | Curved edge rendering |

## Implementation Order

1. **Types** — `server/services/synapse/types.ts`
2. **Parser** — `server/services/synapse/parser.ts` (Tree-sitter WASM loading, query helpers)
3. **SynapseIndexer** — `server/services/synapse/indexer.ts` (scan, parse, resolve, aggregate, save)
4. **SynapseQueryService** — `server/services/synapse/graph.ts` (load, impact, context, dependents, dependencies)
5. **API routes** — `server/routes/synapse.ts`
6. **Frontend** — SynapsePage, SynapseGraph, SynapsePanel, SynapseToolbar, SynapseProgress, useSynapse hook

## Testing Strategy

- **SynapseIndexer**: unit tests for each pipeline phase, integration test for full pipeline on sample TS/JS files
- **SynapseGraph**: unit tests for impact analysis, 360° context, traversal with known graph fixtures
- **API routes**: integration tests with supertest
- **Frontend**: component tests with sample graph data