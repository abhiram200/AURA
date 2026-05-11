# Dependency Graph & Code Intelligence System

## Overview

A standalone code intelligence system for A.U.R.A. that indexes project codebases into a dependency graph, provides impact analysis, 360-degree context, BM25 + semantic search, and visual graph exploration. Exposes tools via MCP for external AI agents. Generates per-folder AI context files.

Built as native services inside A.U.R.A.'s Express server — no child processes, no JSON-RPC. **Built standalone first with its own routes and services, not integrated into existing chat/context services until all tests pass.** File watching built into IndexingService independently, not dependent on existing WorkspaceService.

## Features

1. Auto-index all files on project startup
2. Auto re-index when files change (incremental for single files, full for git changes)
3. Full codebase context for AI (what depends on what, change impact)
4. Impact analysis with depth grouping and confidence scoring
5. Visual graph representation (Sigma.js + Graphology)
6. AI-ready context files per folder (`.aura-context.md`)
7. Query the codebase ("Find where this function is used")
8. 360-degree symbol context (incoming/outgoing references, members, hierarchy)
9. BM25 text search (find by name)
10. Semantic search via Ollama embeddings (find code "like this" with different words)

## Architecture

### Services (server/services/)

| Service | Responsibility |
|---------|---------------|
| `IndexingService` | Scans files, parses with web-tree-sitter, builds graph, runs pipeline |
| `GraphService` | Loads graph, answers queries (impact, context, dependents, dependencies) |
| `SearchService` | BM25 text search + Ollama embedding semantic search |
| `McpService` | Exposes tools via MCP stdio protocol for external AI agents |

### Routes (server/routes/)

| Route Prefix | Purpose |
|--------------|---------|
| `/api/dependencies` | Index, re-index, status, graph data for frontend |

### Frontend

| Component | Purpose |
|-----------|---------|
| `DependenciesPage` | Replaces placeholder — full graph view |
| `DepGraph` | Sigma.js + Graphology WebGL graph renderer |
| `DepDetailPanel` | Left sidebar — node info, references, impact analysis, 360° context |
| `DepToolbar` | Search, filters, view toggles, re-index |
| `DepIndexingProgress` | Progress bar with phase indicators |
| `useDependencies` | Hook for dependency data, indexing status, search |

## Data Model

### Storage

All graph data stored as JSON in `<project-path>/.aura-deps/`:

```
.aura-deps/
  graph.json          # Full dependency graph (nodes + edges)
  index.json          # BM25 search index (inverted index)
  embeddings.json     # Cached embedding vectors (keyed by content hash)
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
interface DepNode {
  id: string;           // "src/hooks/useChat:useChat" or "src/index.ts"
  kind: DepNodeKind;    // File | Folder | Function | Class | Interface | Method | Variable
  name: string;         // Symbol name or file/folder name
  filePath: string;     // Relative path from project root
  range?: { startLine: number; endLine: number };
  exported: boolean;
  metadata?: Record<string, any>;
}
```

### Edge Schema

```typescript
interface DepEdge {
  source: string;       // Node id
  target: string;       // Node id
  type: DepEdgeType;
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

2. **Parse** — For each source file, use `web-tree-sitter` to:
   - Load the appropriate language grammar (WASM)
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

5. **Index** — Build BM25 inverted index (names, paths, exported symbols). Save alongside graph.

### Language Support

Phase 1: TypeScript, JavaScript, Python.
Additional languages via Tree-sitter WASM grammars (extensible).

### Auto-Index on Project Creation

When a project is created via `ProjectService`, `IndexingService.indexProject(projectPath)` is called automatically. The pipeline runs asynchronously and reports progress via SSE events.

### File-Change Re-Indexing

IndexingService manages its own file watching (using `chokidar` or `fs.watch`), independent of existing WorkspaceService:
- **File change/create**: Incremental re-index — re-parse only the changed file, update its nodes/edges in the graph
- **File delete**: Remove that file's nodes/edges from the graph
- **Bulk change** (git pull, branch switch): Full re-index triggered by `lastCommit` mismatch

`meta.json` stores `lastCommit`. On project open, if git HEAD differs, full re-index runs.

### AI Context Files

For each folder, generate `.aura-context.md`:
- Summary of files in this folder and what they export
- Key symbols defined here and where they're used
- What this folder depends on (imports from other folders)
- What depends on this folder (imported by other folders)

Generated during indexing, regenerated on re-index. Sit alongside code so any AI agent can read them without MCP.

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

### BM25 Text Search

- At index time: tokenize node names, file paths, exported symbols
- Store term frequencies and document frequencies in `index.json`
- At query time: BM25 scoring
- Returns: node id, name, kind, file path, relevance score

### Semantic Search (Ollama)

- At index time: for each function/class/method with a body, call `POST http://localhost:11434/api/embeddings` with the configured model
- Cache embeddings in `embeddings.json` keyed by content hash (skip unchanged files on re-index)
- At query time: embed the query, cosine similarity against stored vectors, return top-K
- Embedding model configurable in settings (default: `nomic-embed-text` or whatever Ollama has available)

### Combined Query ("Find where this function is used")

Two-step: text search to find the node → graph traversal for impact/dependents.

## MCP Server

Exposes tools via stdio MCP protocol for external AI agents (Claude Code, Cursor, etc.). Runs as a separate lightweight script that imports shared services.

### MCP Tools

| Tool | Purpose | Key Parameters |
|------|---------|---------------|
| `query` | Search for symbols by name | query, limit, kind |
| `context` | 360° view of a symbol | name, filePath, kind |
| `impact` | Blast radius analysis | target, direction, maxDepth, minConfidence |
| `dependents` | Who depends on X | target, depth |
| `dependencies` | What does X depend on | target, depth |
| `search` | Free-text + semantic search | query, semantic (bool), limit |
| `detect_changes` | Map git changes to affected symbols | baseRef |

## Frontend

### DependenciesPage

Replaces current placeholder. Layout:
- **Top**: DepToolbar
- **Left**: DepDetailPanel (node info, references, impact, 360° context)
- **Center**: DepGraph (Sigma.js WebGL canvas)
- **Bottom**: DepIndexingProgress (during indexing)

### DepGraph (Sigma.js v3 + Graphology)

- **ForceAtlas2** force-directed layout with cluster-based initial positioning
- **Noverlap** post-layout cleanup
- **Curved edges** via `@sigma/edge-curve`
- Node colors by type: File=blue, Function=green, Class=orange, Interface=purple, Method=yellow, Variable=pink
- Node size proportional to degree (connection count)
- Edge colors by type: IMPORTS=blue, CALLS=violet, EXTENDS=orange, IMPLEMENTS=pink, CONTAINS=green, DEPENDS_ON=gray
- Hover node → highlight connections, dim rest
- Click node → populate DepDetailPanel
- Two view modes: file-level (DEPENDS_ON edges) and symbol-level (all edge types)

### DepDetailPanel (Left Sidebar)

- Node info: name, kind, file path, line range, exported status
- Incoming references list (who depends on this)
- Outgoing references list (what this depends on)
- Impact analysis with depth grouping
- 360° context summary
- Collapsible sections

### DepToolbar

- Search box with BM25/semantic toggle
- Filter by node type (checkboxes)
- Filter by edge type (checkboxes)
- Zoom to fit / reset layout buttons
- Toggle file-level / symbol-level view
- Re-index button

### DepIndexingProgress

- Progress bar showing current phase (Scanning → Parsing → Resolving → Aggregating → Indexing)
- Live node/edge count
- Estimated time remaining

### useDependencies Hook

- Fetches graph data from `/api/dependencies/graph`
- Polls indexing status from `/api/dependencies/status`
- Provides search function (calls `/api/dependencies/search`)
- Provides impact/context query functions
- Manages selected node state

## API Routes

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/dependencies/index/:projectId` | Start indexing |
| GET | `/api/dependencies/status/:projectId` | Indexing progress |
| GET | `/api/dependencies/graph/:projectId` | Full graph data (nodes + edges) |
| POST | `/api/dependencies/search/:projectId` | Search (BM25 or semantic) |
| POST | `/api/dependencies/context/:projectId` | 360° context for a symbol |
| POST | `/api/dependencies/impact/:projectId` | Impact analysis |
| POST | `/api/dependencies/reindex/:projectId` | Force re-index |

## Implementation Order

1. **Data model + types** — `server/services/dependency/types.ts`
2. **IndexingService** — scan, parse, resolve, aggregate, index
3. **GraphService** — load graph, impact analysis, 360° context, dependents, dependencies
4. **SearchService** — BM25 index, text search, Ollama semantic search
5. **API routes** — wire services to Express
6. **Frontend** — DependenciesPage, DepGraph, DepDetailPanel, DepToolbar, useDependencies hook
7. **AI context files** — generate `.aura-context.md` per folder
8. **MCP server** — thin stdio script exposing tools
9. **Testing** — unit tests for each service, integration tests for the pipeline

## Dependencies

| Package | Purpose |
|---------|---------|
| `web-tree-sitter` | WASM-based Tree-sitter parsing (no native compilation) |
| `chokidar` | Cross-platform file watching for re-indexing |
| `sigma` | Sigma.js v3 WebGL graph renderer |
| `graphology` | Graph data structure |
| `graphology-layout-forceatlas2` | Force-directed layout |
| `graphology-layout-noverlap` | Overlap resolution |
| `@sigma/edge-curve` | Curved edge rendering |
| `@modelcontextprotocol/sdk` | MCP server protocol |

## Testing Strategy

All services tested independently before integration:
- **IndexingService**: unit tests for each pipeline phase, integration test for full pipeline on sample projects
- **GraphService**: unit tests for impact analysis, 360° context, traversal with known graph fixtures
- **SearchService**: unit tests for BM25 scoring, semantic search with mocked Ollama
- **API routes**: integration tests with supertest
- **Frontend**: component tests with sample graph data