# Ollama Inference Consolidation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate all localhost Ollama HTTP calls into a single enriched `OllamaService` class, eliminating 16 scattered `fetch()` calls, 3 duplicate availability caches, and 5 duplicate URL-resolution blocks.

**Architecture:** Expand the existing `OllamaService` class with new methods (`checkAvailability`, `embed`, `chatSimple`, `resolveBaseUrl`, `resolveModel`) and change its constructor to accept a `FileStore` for dynamic URL resolution. Then migrate every call site to use the service instead of raw `fetch()`. Web-search cloud calls are out of scope.

**Tech Stack:** TypeScript, Node.js, Express, Vite

## Global Constraints

- All localhost Ollama calls go through `OllamaService` — no raw `fetch()` to `localhost:11434` after migration
- Cloud Ollama calls (`ollama.com`) stay in `WebSearchService` — out of scope
- `OllamaService` constructor changes from `(baseUrl: string)` to `(store: FileStore, fallbackUrl?: string)`
- Static methods `resolveBaseUrl` and `resolveModel` centralize config resolution
- `EmbeddingService`, `ContextGenerator`, and `AuraAgent` keep their business logic but delegate HTTP calls to `OllamaService`
- `AuraIndexer` and `AuraQueryService` config objects change from `{ ollamaBaseUrl, chatModel, embedModel }` to `{ ollama, chatModel, embedModel }`
- The `Settings` type in `storage/types.ts` is not changed

---

## File Change Map

| File | Action |
|------|--------|
| `server/services/ollama.ts` | **Major expansion** — add methods, change constructor, dynamic URL |
| `server/services/aura/search/embedding.ts` | **Moderate refactor** — remove URL/HTTP, accept `OllamaService` |
| `server/services/aura/context-generator.ts` | **Moderate refactor** — remove URL/HTTP, accept `OllamaService` |
| `server/services/aura/agent.ts` | **Moderate refactor** — remove URL/HTTP, accept `OllamaService` |
| `server/services/aura/indexer.ts` | **Minor refactor** — change config type, pass `OllamaService` through |
| `server/services/aura/graph.ts` | **Minor refactor** — change config type, pass `OllamaService` through |
| `server/routes/aura.ts` | **Minor refactor** — create `OllamaService`, pass to subsystems |
| `server/routes/chat.ts` | **Tiny refactor** — use `ollama.chatSimple()` for background tasks |
| `server/routes/settings.ts` | **Tiny refactor** — use `OllamaService` for connectivity test |
| `server/index.ts` | **Tiny refactor** — update `OllamaService` construction, health check |
| `server/routes/models.ts` | **Tiny refactor** — remove manual `new OllamaService(customUrl)`, use existing instance |

---

### Task 1: Enrich `OllamaService`

**Files:**
- Modify: `server/services/ollama.ts`

**Interfaces:**
- Consumes: `FileStore` (from `server/storage/fileStore.ts`), `Settings` and `OllamaModel`/`OllamaChatRequest`/`OllamaChatResponse` (from `server/storage/types.ts`)
- Produces: `OllamaService` with new methods `checkAvailability`, `embed`, `chatSimple`, `resolveBaseUrl`, `resolveModel`, and updated constructor

- [ ] **Step 1: Update the `OllamaService` constructor and add `getBaseUrl` helper**

Replace the entire file content. The new `OllamaService` preserves the existing public method signatures for `listModels`, `chat`, `chatStream`, and `isHealthy`, but changes the constructor to accept `FileStore` and resolves URL dynamically.

```typescript
import type { OllamaChatRequest, OllamaChatResponse, OllamaModel, OllamaTagsResponse, Settings } from '../storage/types.ts'
import type { FileStore } from '../storage/fileStore.ts'

const AVAILABILITY_CACHE_MS = 60_000

export class OllamaService {
  private store: FileStore
  private fallbackUrl: string
  private availabilityCache: { result: boolean; timestamp: number } | null = null

  constructor(store: FileStore, fallbackUrl?: string) {
    this.store = store
    this.fallbackUrl = fallbackUrl || process.env.OLLAMA_URL ?? 'http://localhost:11434'
  }

  // ── Dynamic URL resolution ──────────────────────────────────────────────────

  private async getBaseUrl(): Promise<string> {
    const settings = await this.store.read<Settings>('settings.json')
    return OllamaService.resolveBaseUrl(settings?.ollamaBaseUrl)
  }

  // ── Static config resolution ────────────────────────────────────────────────

  static resolveBaseUrl(settingsUrl?: string): string {
    const raw = settingsUrl?.trim()
      || process.env.OLLAMA_BASE_URL
      || process.env.OLLAMA_URL
      || 'http://localhost:11434'
    return /^https?:\/\//i.test(raw) ? raw : `http://${raw}`
  }

  static resolveModel(settings?: Settings | null): string {
    return settings?.defaultProjectModel
      || settings?.defaultModel
      || process.env.OLLAMA_MODEL
      || 'glm-5.1:cloud'
  }

  // ── Availability ────────────────────────────────────────────────────────────

  async checkAvailability(model?: string): Promise<boolean> {
    const now = Date.now()
    if (this.availabilityCache && now - this.availabilityCache.timestamp < AVAILABILITY_CACHE_MS) {
      return this.availabilityCache.result
    }
    try {
      const baseUrl = await this.getBaseUrl()
      const res = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(5000) })
      if (!res.ok) {
        this.availabilityCache = { result: false, timestamp: now }
        return false
      }
      const data = await res.json() as { models?: Array<{ name: string }> }
      const available = model
        ? (data.models ?? []).some(m => m.name.startsWith(model.split(':')[0]))
        : true
      this.availabilityCache = { result: available, timestamp: now }
      return available
    } catch {
      this.availabilityCache = { result: false, timestamp: now }
      return false
    }
  }

  // ── Existing methods (updated to use getBaseUrl) ───────────────────────────

  async listModels(): Promise<OllamaModel[]> {
    const baseUrl = await this.getBaseUrl()
    const res = await fetch(`${baseUrl}/api/tags`)
    if (!res.ok) throw new Error(`Ollama API error: ${res.status}`)
    const data: OllamaTagsResponse = await res.json()
    return data.models
  }

  async chat(request: OllamaChatRequest): Promise<OllamaChatResponse> {
    const baseUrl = await this.getBaseUrl()
    const res = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...request, stream: false }),
    })
    if (!res.ok) throw new Error(`Ollama API error: ${res.status}`)
    return res.json()
  }

  async chatStream(request: OllamaChatRequest): Promise<ReadableStream<Uint8Array>> {
    const baseUrl = await this.getBaseUrl()
    const res = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...request, stream: true }),
    })
    if (!res.ok) throw new Error(`Ollama API error: ${res.status}`)
    if (!res.body) throw new Error('No response body for streaming')
    return res.body
  }

  async isHealthy(): Promise<boolean> {
    try {
      const baseUrl = await this.getBaseUrl()
      const res = await fetch(`${baseUrl}/`)
      return res.ok
    } catch {
      return false
    }
  }

  // ── New methods ────────────────────────────────────────────────────────────

  async embed(model: string, prompt: string, timeout = 30000): Promise<number[] | null> {
    try {
      const baseUrl = await this.getBaseUrl()
      const res = await fetch(`${baseUrl}/api/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, prompt }),
        signal: AbortSignal.timeout(timeout),
      })
      if (!res.ok) return null
      const data = await res.json() as { embedding?: number[] }
      return data.embedding?.length ? data.embedding : null
    } catch {
      return null
    }
  }

  async chatSimple(
    model: string,
    messages: Array<{ role: string; content: string }>,
    options?: { timeout?: number },
  ): Promise<string | null> {
    try {
      const baseUrl = await this.getBaseUrl()
      const res = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages, stream: false }),
        signal: AbortSignal.timeout(options?.timeout ?? 30000),
      })
      if (!res.ok) return null
      const data = await res.json() as { message?: { content?: string } }
      return data.message?.content?.trim() ?? null
    } catch {
      return null
    }
  }
}
```

- [ ] **Step 2: Run TypeScript check**

Run: `npx tsc --noEmit` from project root.

Expected: No new errors in `ollama.ts`. Existing errors in other files referencing the old `(baseUrl: string)` constructor will be caught in later tasks.

- [ ] **Step 3: Commit**

```bash
git add server/services/ollama.ts
git commit -m "feat: enrich OllamaService with checkAvailability, embed, chatSimple, resolveBaseUrl, resolveModel"
```

---

### Task 2: Migrate `EmbeddingService`

**Files:**
- Modify: `server/services/aura/search/embedding.ts`

**Interfaces:**
- Consumes: `OllamaService` (from Task 1)
- Produces: `EmbeddingService` that delegates HTTP calls to `OllamaService`

- [ ] **Step 1: Rewrite `EmbeddingService` to accept `OllamaService` and delegate HTTP calls**

Replace the class fields and constructor. Remove `ollamaBaseUrl`, `embedModel`, `available`, `lastAvailabilityCheck`, `availabilityCacheResult`, and the private `checkAvailability` and `embedText` methods. The class keeps all batch logic, caching, and similarity search.

Key changes:
- Constructor: `(ollama: OllamaService, embedModel?: string)` — no more `ollamaBaseUrl`
- `checkAvailability()` → calls `this.ollama.checkAvailability(this.embedModel)`, then sets `this.available`
- `embedText()` → calls `this.ollama.embed(this.embedModel, text)`
- `fromJSON()` static factory → accepts `OllamaService` instead of `ollamaBaseUrl`

Here is the full rewritten file:

```typescript
import type { AuraNode, SearchResult, EmbeddingStoreData } from '../types.ts'
import type { OllamaService } from '../../ollama.ts'

const EMBED_TIMEOUT = 30000
const MAX_CONCURRENT = 3

export class EmbeddingService {
  private ollama: OllamaService
  private embedModel: string
  private embeddings: Map<string, number[]> = new Map()
  private nodeMap: Map<string, AuraNode> = new Map()
  private available = false
  private generatedAt = ''
  private dimension = 0

  constructor(ollama: OllamaService, embedModel?: string) {
    this.ollama = ollama
    this.embedModel = embedModel || 'mxbai-embed-large:335m'
  }

  async checkAvailability(): Promise<boolean> {
    const available = await this.ollama.checkAvailability(this.embedModel)
    this.available = available
    return available
  }

  async generateEmbeddings(
    nodes: AuraNode[],
    onProgress?: (done: number, total: number) => void,
  ): Promise<boolean> {
    const isAvailable = await this.checkAvailability()
    if (!isAvailable) {
      this.available = false
      return false
    }

    const toEmbed = nodes.filter(n => !this.embeddings.has(n.id))
    if (toEmbed.length === 0) {
      this.available = true
      return true
    }

    // Build node map
    for (const node of nodes) {
      this.nodeMap.set(node.id, node)
    }

    let done = 0
    let failures = 0
    const total = toEmbed.length
    const abortThreshold = Math.floor(total * 0.5)

    // Process in batches of MAX_CONCURRENT
    for (let i = 0; i < toEmbed.length; i += MAX_CONCURRENT) {
      const batch = toEmbed.slice(i, i + MAX_CONCURRENT)
      const results = await Promise.allSettled(
        batch.map(node => this.embedNode(node)),
      )

      for (let j = 0; j < results.length; j++) {
        const result = results[j]
        if (result.status === 'fulfilled' && result.value !== null) {
          this.embeddings.set(batch[j].id, result.value)
        } else {
          failures++
        }
      }

      done += batch.length
      onProgress?.(done, total)

      // Abort if too many failures
      if (failures > abortThreshold) {
        this.available = false
        return false
      }
    }

    this.available = this.embeddings.size > 0
    this.generatedAt = new Date().toISOString()
    return this.available
  }

  private async embedNode(node: AuraNode): Promise<number[] | null> {
    const text = `${node.name} ${node.kind} ${node.filePath}`
    return this.ollama.embed(this.embedModel, text, EMBED_TIMEOUT)
  }

  async embedQuery(query: string): Promise<number[] | null> {
    const isAvailable = await this.checkAvailability()
    if (!isAvailable) return null
    return this.ollama.embed(this.embedModel, query, EMBED_TIMEOUT)
  }

  query(queryEmbedding: number[], limit: number, kinds?: string[]): SearchResult[] {
    if (this.embeddings.size === 0) return []

    const results: SearchResult[] = []

    for (const [nodeId, embedding] of this.embeddings) {
      const node = this.nodeMap.get(nodeId)
      if (!node) continue
      if (kinds && kinds.length > 0 && !kinds.includes(node.kind)) continue

      const similarity = this.cosineSimilarity(queryEmbedding, embedding)
      if (similarity > 0) {
        results.push({ node, score: similarity, mode: 'hybrid', semanticScore: similarity })
      }
    }

    results.sort((a, b) => b.score - a.score)
    return results.slice(0, limit)
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length || a.length === 0) return 0
    let dotProduct = 0
    let normA = 0
    let normB = 0
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i]
      normA += a[i] * a[i]
      normB += b[i] * b[i]
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB)
    return denom === 0 ? 0 : dotProduct / denom
  }

  isAvailable(): boolean {
    return this.available
  }

  removeNodes(nodeIds: Set<string>): void {
    for (const id of nodeIds) {
      this.embeddings.delete(id)
    }
  }

  toJSON(): EmbeddingStoreData {
    const embeddingsObj: Record<string, number[]> = {}
    for (const [id, emb] of this.embeddings) {
      embeddingsObj[id] = emb
    }
    return {
      version: 1,
      model: this.embedModel,
      dimension: this.dimension,
      generatedAt: this.generatedAt,
      ollamaWasAvailable: this.available,
      embeddings: embeddingsObj,
    }
  }

  static fromJSON(data: EmbeddingStoreData, nodeMap: Map<string, AuraNode>, ollama: OllamaService, embedModel?: string): EmbeddingService {
    const service = new EmbeddingService(ollama, embedModel)
    // If the saved model differs from the current model, embeddings are stale
    if (data.model && data.model !== service.embedModel) {
      service.available = false
      return service
    }
    service.nodeMap = nodeMap
    service.dimension = data.dimension
    service.generatedAt = data.generatedAt
    service.available = data.ollamaWasAvailable && Object.keys(data.embeddings).length > 0

    for (const [id, emb] of Object.entries(data.embeddings)) {
      service.embeddings.set(id, emb)
    }

    return service
  }
}
```

- [ ] **Step 2: Run TypeScript check**

Run: `npx tsc --noEmit`

Expected: Errors in files that still pass `ollamaBaseUrl` to `EmbeddingService` (indexer.ts, graph.ts) — these will be fixed in Tasks 4-5.

- [ ] **Step 3: Commit**

```bash
git add server/services/aura/search/embedding.ts
git commit -m "refactor: EmbeddingService delegates HTTP to OllamaService"
```

---

### Task 3: Migrate `ContextGenerator`

**Files:**
- Modify: `server/services/aura/context-generator.ts`

**Interfaces:**
- Consumes: `OllamaService` (from Task 1)
- Produces: `ContextGenerator` that delegates HTTP calls to `OllamaService`

- [ ] **Step 1: Rewrite `ContextGenerator` to accept `OllamaService` and delegate HTTP calls**

Key changes:
- Remove `ollamaBaseUrl` and `chatModel` private fields (replace with `ollama` and `chatModel`)
- Remove `checkAvailability()` method body — delegate to `this.ollama.checkAvailability(this.chatModel)`
- Remove `callOllama()` private method — replace call sites with `this.ollama.chatSimple(this.chatModel, messages, { timeout: CHAT_TIMEOUT })`
- Constructor: `(ollama: OllamaService, chatModel?: string)` instead of `(ollamaBaseUrl?: string, chatModel?: string)`

The changes are surgical — only touch the class fields, constructor, `checkAvailability`, and `callOllama`. All prompt-building and formatting methods stay unchanged.

Edit the class fields and constructor (around lines 19-29):

```typescript
export class ContextGenerator {
  private ollama: OllamaService
  private chatModel: string
  private available = false
  private contextCache = new Map<string, string>()

  constructor(ollama: OllamaService, chatModel?: string) {
    this.ollama = ollama
    this.chatModel = chatModel || 'glm-5.1:cloud'
  }
```

Add the import at the top:

```typescript
import type { OllamaService } from '../../ollama.ts'
```

Replace `checkAvailability` method (lines 32-57) with:

```typescript
  async checkAvailability(): Promise<boolean> {
    const available = await this.ollama.checkAvailability(this.chatModel)
    this.available = available
    return available
  }
```

Replace `callOllama` method (lines 636-662) with calls to `this.ollama.chatSimple`. Find each call site of `this.callOllama(messages)` and replace with:

```typescript
await this.ollama.chatSimple(this.chatModel, messages, { timeout: CHAT_TIMEOUT })
```

Then delete the entire `callOllama` private method.

- [ ] **Step 2: Run TypeScript check**

Run: `npx tsc --noEmit`

Expected: Errors in files that still pass `ollamaBaseUrl` to `ContextGenerator` (indexer.ts, graph.ts) — fixed in Tasks 4-5.

- [ ] **Step 3: Commit**

```bash
git add server/services/aura/context-generator.ts
git commit -m "refactor: ContextGenerator delegates HTTP to OllamaService"
```

---

### Task 4: Migrate `AuraAgent`

**Files:**
- Modify: `server/services/aura/agent.ts`

**Interfaces:**
- Consumes: `OllamaService` (from Task 1)
- Produces: `AuraAgent` that delegates HTTP to `OllamaService`

This is the largest refactor. Key changes:

- [ ] **Step 1: Update imports and class fields**

Add import at top:

```typescript
import type { OllamaService } from '../ollama.ts'
```

Remove the `ollamaBaseUrl` field. Add `ollama` field:

```typescript
  private ollama: OllamaService
  private model: string
  // remove: private ollamaBaseUrl: string
```

- [ ] **Step 2: Update constructor**

Replace the constructor (around line 1989):

```typescript
  constructor(qs: AuraQueryService, projectPath: string, ollama: OllamaService, model?: string, contextWindow?: number, managedShells?: ManagedShellService, projectId?: string, chatService?: AuraChatService, chatId?: string, apiKey?: string) {
    this.qs = qs
    this.projectPath = projectPath
    this.ollama = ollama
    this.model = model || 'glm-5.1:cloud'
    this.contextWindow = contextWindow ?? 200_000
    this.managedShells = managedShells || null
    this.projectId = projectId || null
    this.chatService = chatService || null
    this.chatId = chatId || null
    this.webSearch = new WebSearchService(apiKey)
    // ... rest of constructor unchanged
  }
```

- [ ] **Step 3: Replace `checkAvailability` method (around line 2994-3013)**

Replace the entire method body:

```typescript
  async checkAvailability(): Promise<boolean> {
    return this.ollama.checkAvailability(this.model)
  }
```

- [ ] **Step 4: Replace `generateCompactionSummary` function (around line 195-231)**

This is a module-level function, not a method. Change its signature to accept `ollama: OllamaService` instead of `ollamaBaseUrl: string, model: string`:

```typescript
async function generateCompactionSummary(
  ollama: OllamaService,
  model: string,
  messages: OllamaMessage[],
  todoList: readonly Task[],
  planResume: SavedPlan | null,
): Promise<string | null> {
```

And replace the `fetch` call (lines 211-230) with:

```typescript
  const content = await ollama.chatSimple(model, [
    { role: 'user', content: `${BUILDER_COMPACTION_PROMPT}\n${compactionInput}${extraContext}` },
  ], { timeout: 30000 })
  return content
```

Note: `chatSimple` returns `null` on failure, which matches the current behavior (returns `null` on error).

- [ ] **Step 5: Replace streaming `fetch` call in `streamChat` method (around line 2762)**

Replace the raw `fetch` call with `this.ollama.chatStream()`:

```typescript
        const response = await this.ollama.chatStream({
          model: this.model,
          messages: messages.map(m => {
            const msg: Record<string, unknown> = { role: m.role, content: m.content }
            if (m.tool_calls) msg.tool_calls = m.tool_calls
            if (m.tool_call_id) msg.tool_call_id = m.tool_call_id
            if (m.name) msg.name = m.name
            return msg
          }),
          tools: tools.length > 0 ? tools : undefined,
          stream: true,
          options: { num_ctx: this.contextWindow },
        } as any)
```

Then update the response handling. The current code does:

```typescript
if (!response.ok || !response.body) { ... }
```

Since `chatStream` throws on non-ok and returns `ReadableStream` directly, we need to wrap in try/catch instead:

```typescript
        let response: ReadableStream<Uint8Array>
        try {
          response = await this.ollama.chatStream({
            model: this.model,
            messages: messages.map(m => {
              const msg: Record<string, unknown> = { role: m.role, content: m.content }
              if (m.tool_calls) msg.tool_calls = m.tool_calls
              if (m.tool_call_id) msg.tool_call_id = m.tool_call_id
              if (m.name) msg.name = m.name
              return msg
            }),
            tools: tools.length > 0 ? tools : undefined,
            stream: true,
            options: { num_ctx: this.contextWindow },
          } as OllamaChatRequest)
        } catch (err) {
          lastError = err instanceof Error ? err.message : String(err)
          // Retry on server errors
          if (attempt < maxRetries) {
            const delay = Math.min(1000 * Math.pow(2, attempt - 1), 8000)
            if (attempt === 1) eventSink.emit('token', { content: 'Connection interrupted, retrying…' })
            await new Promise(r => setTimeout(r, delay))
            continue
          }
          eventSink.emit('error', { message: `Ollama chat failed: ${lastError}` })
          return null
        }
```

Remove the `if (!response.ok || !response.body)` block and the rate-limit/5xx retry logic that was inside the stream loop (since `chatStream` now throws). The retry logic moves to the try/catch above.

- [ ] **Step 6: Update `streamChat` call to `generateCompactionSummary`**

Find the call site inside `streamChat` that calls `generateCompactionSummary` and update it to pass `this.ollama` instead of `this.ollamaBaseUrl`:

```typescript
// Before:
const summary = await generateCompactionSummary(this.ollamaBaseUrl, this.model, ...)

// After:
const summary = await generateCompactionSummary(this.ollama, this.model, ...)
```

- [ ] **Step 7: Run TypeScript check**

Run: `npx tsc --noEmit`

Expected: Errors in `routes/aura.ts` where `AuraAgent` is constructed — fixed in Task 6.

- [ ] **Step 8: Commit**

```bash
git add server/services/aura/agent.ts
git commit -m "refactor: AuraAgent delegates HTTP to OllamaService"
```

---

### Task 5: Update `AuraIndexer` and `AuraQueryService` config types

**Files:**
- Modify: `server/services/aura/indexer.ts`
- Modify: `server/services/aura/graph.ts`

**Interfaces:**
- Consumes: `OllamaService` (from Task 1), new `EmbeddingService`/`ContextGenerator` (from Tasks 2-3)
- Produces: `AuraIndexer` and `AuraQueryService` that pass `OllamaService` to subsystems

The config type `{ ollamaBaseUrl?: string; chatModel?: string; embedModel?: string }` changes to `{ ollama: OllamaService; chatModel?: string; embedModel?: string }`.

- [ ] **Step 1: Update `AuraIndexer` config type and constructor**

In `indexer.ts`, change the config type and update all usages:

```typescript
// Line ~62: Change the config type
private config: { ollama: OllamaService; chatModel?: string; embedModel?: string }
```

Add import:

```typescript
import type { OllamaService } from '../ollama.ts'
```

Update constructor (line ~64):

```typescript
  constructor(projectPath: string, config: { ollama: OllamaService; chatModel?: string; embedModel?: string }) {
    this.projectPath = projectPath
    this.parser = new AuraParser()
    this.config = config
  }
```

Update all `new EmbeddingService(...)` calls to use `this.config.ollama`:
- Line ~235: `new EmbeddingService(this.config.ollama, this.config.embedModel)`
- Line ~2061: `new EmbeddingService(this.config.ollama, this.config.embedModel)`

Update all `new ContextGenerator(...)` calls:
- Line ~250: `new ContextGenerator(this.config.ollama, this.config.chatModel)`
- Line ~2067: `new ContextGenerator(this.config.ollama, this.config.chatModel)`

- [ ] **Step 2: Update `AuraQueryService` config type and constructor**

In `graph.ts`, same config type change:

```typescript
// Line ~72: Change the config type
private config: { ollama: OllamaService; chatModel?: string; embedModel?: string }
```

Add import:

```typescript
import type { OllamaService } from '../ollama.ts'
```

Update constructor (line ~86):

```typescript
  constructor(projectPath: string, config: { ollama: OllamaService; chatModel?: string; embedModel?: string }) {
    this.projectPath = projectPath
    this.config = config
  }
```

Update all `new EmbeddingService(...)` calls to use `this.config.ollama`:
- Line ~176: `new EmbeddingService(this.config.ollama, this.config.embedModel)`
- Line ~439: `new EmbeddingService(this.config.ollama, this.config.embedModel)`

Update `EmbeddingService.fromJSON(...)` calls:
- Line ~169: `EmbeddingService.fromJSON(data, this.nodeMap, this.config.ollama, this.config.embedModel)`

Update all `new ContextGenerator(...)` calls:
- Line ~180: `new ContextGenerator(this.config.ollama, this.config.chatModel)`
- Line ~450: `new ContextGenerator(this.config.ollama, this.config.chatModel)`
- Line ~455: `new ContextGenerator(this.config.ollama, this.config.chatModel)`

- [ ] **Step 3: Run TypeScript check**

Run: `npx tsc --noEmit`

Expected: Errors in `routes/aura.ts` — fixed in Task 6.

- [ ] **Step 4: Commit**

```bash
git add server/services/aura/indexer.ts server/services/aura/graph.ts
git commit -m "refactor: AuraIndexer and AuraQueryService pass OllamaService to subsystems"
```

---

### Task 6: Update `routes/aura.ts` to create and pass `OllamaService`

**Files:**
- Modify: `server/routes/aura.ts`

**Interfaces:**
- Consumes: `OllamaService` (from Task 1), updated `AuraAgent`/`AuraIndexer`/`AuraQueryService` (from Tasks 3-5)

- [ ] **Step 1: Update the route to accept `OllamaService` and pass it through**

The `createAuraRouter` function needs to accept an `OllamaService` instance. Update its signature:

```typescript
import { OllamaService } from '../services/ollama.ts'

export function createAuraRouter(
  projectService: ProjectService,
  indexerMap: Map<string, AuraIndexer>,
  queryMap: Map<string, AuraQueryService>,
  groupService: GroupService,
  dataDir: string,
  store: FileStore,
  managedShellService: ManagedShellService,
  ollama: OllamaService,  // NEW parameter
): Router {
```

Update `getAuraConfig()` to use `OllamaService.resolveBaseUrl` and `OllamaService.resolveModel`:

```typescript
  async function getAuraConfig() {
    const settings = await store.read<Settings>('settings.json')
    return {
      ollama,  // Pass the OllamaService instance instead of URL string
      chatModel: OllamaService.resolveModel(settings),
      embedModel: settings?.defaultEmbeddingModel || 'mxbai-embed-large:335m',
      contextWindow: settings?.contextWindowSize || 200_000,
      apiKey: settings?.ollamaApiKey || undefined,
    }
  }
```

Note: The config type for AuraIndexer/AuraQueryService now uses `{ ollama, chatModel, embedModel }` instead of `{ ollamaBaseUrl, chatModel, embedModel }`. All places that construct `new AuraIndexer(..., config)` or `new AuraQueryService(..., config)` will work automatically since `config` now has the right shape.

Update the `AuraAgent` construction (around line 989):

```typescript
    const agent = new AuraAgent(qs, project.workspacePath, ollama, config.chatModel, config.contextWindow, managedShellService, projectId, chatService, chatId, config.apiKey)
```

The second positional arg changes from `config.ollamaBaseUrl` (string) to `ollama` (OllamaService instance).

- [ ] **Step 2: Update `index.ts` to pass `OllamaService` to `createAuraRouter`**

In `server/index.ts`, update the router creation:

```typescript
app.use('/api/aura', createAuraRouter(projectService, auraIndexers, auraQueries, groupService, DATA_DIR, store, managedShellService, ollama))
```

- [ ] **Step 3: Run TypeScript check**

Run: `npx tsc --noEmit`

Expected: Possible errors in remaining call sites. Fix any that remain.

- [ ] **Step 4: Commit**

```bash
git add server/routes/aura.ts server/index.ts
git commit -m "refactor: aura routes receive and pass OllamaService instance"
```

---

### Task 7: Migrate `routes/settings.ts` and `routes/models.ts`

**Files:**
- Modify: `server/routes/settings.ts`
- Modify: `server/routes/models.ts`

**Interfaces:**
- Consumes: `OllamaService` (from Task 1)

- [ ] **Step 1: Update `settings.ts` test-ollama endpoint**

The `test-ollama` endpoint (around line 133) currently does a raw `fetch` to `/api/tags`. Replace it with `ollama.listModels()`:

Add `OllamaService` import and parameter. The `createSettingsRouter` function currently takes `(store: FileStore)`. Add `ollama: OllamaService`:

```typescript
import { OllamaService } from '../services/ollama.ts'

export function createSettingsRouter(store: FileStore, ollama: OllamaService): Router {
```

Replace the raw `fetch` block (lines 133-161) with:

```typescript
  router.post('/test-ollama', async (req, res) => {
    const { url } = req.body as { url?: string }
    try {
      // If a custom URL is provided, create a temporary service for testing
      const testService = url?.trim()
        ? new OllamaService(store, url.trim())
        : ollama
      const models = await testService.listModels()
      res.json({ ok: true, modelCount: models.length })
    } catch (err: unknown) {
      let message = 'Connection failed'
      if (err instanceof Error) {
        // Node wraps the real cause inside err.cause
        const cause = (err as any).cause
        if (cause?.code === 'ECONNREFUSED') message = 'Connection refused — is Ollama running at this address?'
        else if (cause?.code === 'ENOTFOUND') message = 'Host not found — check the URL'
        else if (cause?.code === 'ETIMEDOUT' || cause?.code === 'UND_ERR_CONNECT_TIMEOUT') message = 'Connection timed out — check the URL and port'
        else if (err.message.includes('abort')) message = 'Connection timed out'
        else if (cause?.message) message = cause.message
        else message = err.message
      }
      const normalized = url?.trim() ? OllamaService.resolveBaseUrl(url) : undefined
      res.json({ ok: false, error: message, url: normalized })
    }
  })
```

Note: The `/test-api-key` endpoint (line 164) stays unchanged — it tests the cloud Ollama API, not localhost.

- [ ] **Step 2: Update `models.ts` to remove manual `new OllamaService(customUrl)`**

The models route currently creates a temporary `OllamaService` when a custom URL is provided. Since `OllamaService` now resolves its URL dynamically from settings, this custom-URL fallback is no longer needed for normal operation. However, the models route currently uses the URL from the request query, not settings.

Update `createModelsRouter` to use the dynamic URL resolution. Since the `OllamaService` already reads settings for URL, the custom URL case needs a temporary instance:

```typescript
import { OllamaService } from '../services/ollama.ts'

export function createModelsRouter(ollama: OllamaService, store: FileStore) {
  const router = Router()

  router.get('/', async (req, res) => {
    try {
      const models = await ollama.listModels()
      const classifiedModels = models.map(m => ({
        ...m,
        isEmbedding: isEmbeddingModel(m.name),
        isVision: isVisionModel(m.name),
      }))
      res.json({ models: classifiedModels })
    } catch (err) {
      res.status(502).json({ error: `Failed to fetch models: ${err instanceof Error ? err.message : 'Unknown error'}` })
    }
  })

  return router
}
```

The custom URL fallback logic is removed because `OllamaService` now dynamically resolves the URL from settings. If the user changes their `ollamaBaseUrl` in settings, `ollama.listModels()` will pick it up automatically.

- [ ] **Step 3: Update `index.ts` router calls for settings and models**

Update the router creation in `server/index.ts`:

```typescript
app.use('/api/settings', createSettingsRouter(store, ollama))
// models router already receives ollama — no change needed unless signature changed
```

- [ ] **Step 4: Run TypeScript check**

Run: `npx tsc --noEmit`

Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add server/routes/settings.ts server/routes/models.ts server/index.ts
git commit -m "refactor: settings and models routes use OllamaService"
```

---

### Task 8: Migrate `routes/chat.ts` background tasks

**Files:**
- Modify: `server/routes/chat.ts`

**Interfaces:**
- Consumes: `OllamaService.chatSimple()` (from Task 1)

- [ ] **Step 1: Replace `ollama.chat()` calls with `ollama.chatSimple()` for background tasks**

In `routes/chat.ts`, there are three background task blocks that use `ollama.chat()` for simple string-in/string-out calls. Replace each with `ollama.chatSimple()`:

**Title generation (around line 442):**

```typescript
// Before:
const titleResponse = await ollama.chat({
  model: conversation.model || settings.defaultModel,
  messages: [
    { role: 'user', content: `${TITLE_GENERATE}\nUser: ${message}\nAssistant: ${fullResponse}` },
  ],
  stream: false,
})
const title = titleResponse.message.content.trim().replace(/^["']|["']$/g, '')

// After:
const title = await ollama.chatSimple(
  conversation.model || settings.defaultModel,
  [{ role: 'user', content: `${TITLE_GENERATE}\nUser: ${message}\nAssistant: ${fullResponse}` }],
)
if (title) {
  const cleaned = title.replace(/^["']|["']$/g, '')
  if (cleaned) {
    await conversationService.updateTitle(conversationId, cleaned)
  }
}
```

**Compaction (around line 473):**

```typescript
// Before:
const compactionResponse = await ollama.chat({
  model: conversation.model || settings.defaultModel,
  messages: [
    { role: 'user', content: `${COMPACTION_PROMPT}\n${conversationText}` },
  ],
  stream: false,
})
const raw = compactionResponse.message.content.trim()

// After:
const raw = await ollama.chatSimple(
  conversation.model || settings.defaultModel,
  [{ role: 'user', content: `${COMPACTION_PROMPT}\n${conversationText}` }],
)
if (raw) {
  const workingState = ctxService.parseWorkingState(raw)
  // ... rest unchanged
}
```

**Memory extraction (around line 499) and compaction (around line 508):**

```typescript
// Before:
await memoryService.extractAndSave(
  message, fullResponse, conversationId,
  async (messages) => {
    const resp = await ollama.chat({
      model: conversation.model || settings.defaultModel,
      messages,
      stream: false,
    })
    return resp.message.content
  },
)
await memoryService.compactIfNeeded(async (messages) => {
  const resp = await ollama.chat({
    model: conversation.model || settings.defaultModel,
    messages,
    stream: false,
  })
  return resp.message.content
})

// After:
await memoryService.extractAndSave(
  message, fullResponse, conversationId,
  async (messages) => {
    const content = await ollama.chatSimple(conversation.model || settings.defaultModel, messages)
    return content ?? ''
  },
)
await memoryService.compactIfNeeded(async (messages) => {
  const content = await ollama.chatSimple(conversation.model || settings.defaultModel, messages)
  return content ?? ''
})
```

- [ ] **Step 2: Run TypeScript check**

Run: `npx tsc --noEmit`

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add server/routes/chat.ts
git commit -m "refactor: chat route uses chatSimple for background tasks"
```

---

### Task 9: Update `index.ts` — `OllamaService` construction and health check

**Files:**
- Modify: `server/index.ts`

**Interfaces:**
- Consumes: `OllamaService` (from Task 1)

- [ ] **Step 1: Update `OllamaService` construction**

Change:

```typescript
const OLLAMA_URL = process.env.OLLAMA_URL ?? 'http://localhost:11434'
// ...
const ollama = new OllamaService(OLLAMA_URL)
```

To:

```typescript
const ollama = new OllamaService(store)
```

The `OLLAMA_URL` constant is no longer needed since `OllamaService` reads the env var itself as a fallback.

- [ ] **Step 2: Replace health check raw `fetch` with `ollama.isHealthy()`**

Replace lines around 112-122:

```typescript
// Before:
app.get('/api/health', async (_req, res) => {
  let ollama = false
  try {
    const settings = await store.read('settings.json') as { ollamaBaseUrl?: string } | null
    const url = settings?.ollamaBaseUrl?.trim() || OLLAMA_URL
    const resp = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(3000) })
    ollama = resp.ok
  } catch {
    // Ollama not reachable
  }
  res.json({ status: 'ok', ollama })
})

// After:
app.get('/api/health', async (_req, res) => {
  const ollamaHealthy = await ollama.isHealthy()
  res.json({ status: 'ok', ollama: ollamaHealthy })
})
```

- [ ] **Step 3: Run TypeScript check**

Run: `npx tsc --noEmit`

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add server/index.ts
git commit -m "refactor: index.ts uses OllamaService for health check and construction"
```

---

### Task 10: Full integration test

**Files:**
- All modified files

- [ ] **Step 1: Start the dev server and verify it boots**

Run: `npm run dev`

Expected: Server starts on port 3001, Vite on port 5173. No startup errors in console.

- [ ] **Step 2: Verify Ollama connectivity check works**

Open http://localhost:5173 in a browser. Check that the settings page shows Ollama status (online/offline). If Ollama is running, verify it shows as online.

- [ ] **Step 3: Verify chat works**

Send a chat message. Confirm you get a streaming response.

- [ ] **Step 4: Verify AURA indexing works**

Trigger AURA indexing for a project. Confirm embeddings generate and context files are created.

- [ ] **Step 5: Run existing tests**

Run: `npm run test:unit`

Expected: All unit tests pass.

- [ ] **Step 6: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix: integration fixes from testing"
```