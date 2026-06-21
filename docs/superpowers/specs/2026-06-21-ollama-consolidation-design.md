# Ollama Inference Consolidation Design

**Date:** 2026-06-21  
**Status:** Approved  
**Approach:** A — Enrich `OllamaService` into a full-featured client

## Problem

Ollama inference calls are scattered across 6+ files with duplicated patterns:
- 5 copies of base URL resolution (`settings || env || default`)
- 3 independent availability caches (agent, context-generator, embedding)
- 3 independent `checkAvailability()` implementations
- Raw `fetch()` calls to `/api/chat`, `/api/tags`, `/api/embeddings` in 9 places
- No single source of truth for model name defaults

The existing `OllamaService` class only covers `listModels`, `chat`, `chatStream`, and `isHealthy` — used by just 2 routes. Everything else in the AURA subsystem bypasses it entirely.

## Solution

Expand `OllamaService` to be the **sole** interface for localhost Ollama communication, then route every call site through it.

### Design Principle: Consolidate first, abstract later

The immediate goal is Ollama-only consolidation. The public API surface is designed so that extracting an `InferenceProvider` interface later is a clean refactor — just pull the method signatures into an interface and add factory-based construction.

## Enriched `OllamaService` API

```typescript
export class OllamaService {
  private store: FileStore
  private fallbackUrl: string
  private availabilityCache: { result: boolean; timestamp: number } | null = null

  constructor(store: FileStore, fallbackUrl?: string)

  // ── Existing (unchanged signatures) ──
  async listModels(): Promise<OllamaModel[]>
  async chat(request: OllamaChatRequest): Promise<OllamaChatResponse>
  async chatStream(request: OllamaChatRequest): Promise<ReadableStream<Uint8Array>>
  async isHealthy(): Promise<boolean>

  // ── New methods ──
  async checkAvailability(model?: string): Promise<boolean>
  async embed(model: string, prompt: string, timeout?: number): Promise<number[] | null>
  async chatSimple(model: string, messages: Array<{role: string; content: string}>, options?: { timeout?: number }): Promise<string | null>

  // ── Static config resolution ──
  static resolveBaseUrl(settingsUrl?: string): string
  static resolveModel(settings?: Settings | null): string
}
```

### Constructor change

Old: `new OllamaService(baseUrl: string)`  
New: `new OllamaService(store: FileStore, fallbackUrl?: string)`

The service reads settings from `store` on every call to resolve the current base URL. This means a user changing `ollamaBaseUrl` in settings takes effect immediately without restart.

`fallbackUrl` preserves the existing `OLLAMA_URL` env var behavior and defaults to `http://localhost:11434`.

### `resolveBaseUrl()` — centralized URL resolution

```typescript
static resolveBaseUrl(settingsUrl?: string): string {
  const raw = settingsUrl?.trim()
    || process.env.OLLAMA_BASE_URL
    || process.env.OLLAMA_URL
    || 'http://localhost:11434'
  return /^https?:\/\//i.test(raw) ? raw : `http://${raw}`
}
```

Replaces 5 duplicate resolution blocks. Normalizes bare `host:port` by prepending `http://`.

### `resolveModel()` — centralized model resolution

```typescript
static resolveModel(settings?: Settings | null): string {
  return settings?.defaultProjectModel
    || settings?.defaultModel
    || process.env.OLLAMA_MODEL
    || 'glm-5.1:cloud'
}
```

### `checkAvailability()` — one cache, all callers

```typescript
private static readonly AVAILABILITY_CACHE_MS = 60_000

async checkAvailability(model?: string): Promise<boolean> {
  const now = Date.now()
  if (this.availabilityCache && now - this.availabilityCache.timestamp < OllamaService.AVAILABILITY_CACHE_MS) {
    return this.availabilityCache.result
  }
  try {
    const baseUrl = await this.getBaseUrl()
    const res = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(5000) })
    if (!res.ok) { this.setAvailabilityCache(false); return false }
    const data = await res.json() as { models?: Array<{ name: string }> }
    const available = model
      ? data.models?.some(m => m.name.startsWith(model.split(':')[0])) ?? false
      : true
    this.setAvailabilityCache(available)
    return available
  } catch {
    this.setAvailabilityCache(false)
    return false
  }
}
```

- If `model` is provided, also checks that the model exists in the tags response
- If `model` is omitted, just checks that Ollama is reachable
- Cache invalidates on any error (same pattern as current code)

### `embed()` — thin wrapper over `/api/embeddings`

```typescript
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
```

Returns `null` on failure, matching current `EmbeddingService` semantics. `EmbeddingService` keeps its batch orchestration, caching, and similarity search — it just delegates the HTTP call.

### `chatSimple()` — fire-and-get-content convenience

```typescript
async chatSimple(
  model: string,
  messages: Array<{ role: string; content: string }>,
  options?: { timeout?: number }
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
```

Used by: compaction, context generation, title generation, memory extraction. Callers that need more control (streaming, tool calls) continue using `chatStream()` / `chat()` directly.

### `chatStream()` — update to use dynamic URL

The existing `chatStream` method changes from `this.baseUrl` to `await this.getBaseUrl()` — same logic, just resolves the URL fresh each call. Same for `chat()` and `listModels()`.

## Call Site Migration

### Files that stop making direct `fetch()` calls to Ollama

| File | What gets removed | What replaces it |
|------|-------------------|-----------------|
| `aura/agent.ts` | `this.ollamaBaseUrl`, `checkAvailability()`, raw fetch at L211 (compaction), raw fetch at L2762 (streaming) | Constructor takes `OllamaService`. Availability → `ollama.checkAvailability(model)`. Compaction → `ollama.chatSimple(...)`. Streaming → `ollama.chatStream(...)`. |
| `aura/context-generator.ts` | `this.ollamaBaseUrl`, `this.chatModel`, `checkAvailability()`, `callOllama()` | Constructor takes `OllamaService` + model string. Availability → `ollama.checkAvailability(model)`. Chat → `ollama.chatSimple(model, messages)`. |
| `aura/search/embedding.ts` | `this.ollamaBaseUrl`, `this.embedModel`, `checkAvailability()`, `embedText()` | Constructor takes `OllamaService` + model string. Availability → `ollama.checkAvailability(model)`. Embed → `ollama.embed(model, text)`. |
| `index.ts:117` | Raw `fetch` for health check | `ollama.isHealthy()` |
| `routes/settings.ts:139` | Raw `fetch` to `/api/tags` | `ollama.listModels()` with try/catch |

### Files with minor changes

| File | Change |
|------|--------|
| `routes/aura.ts` | Construct/pass `OllamaService` instead of raw URL strings to AuraAgent, ContextGenerator, EmbeddingService |
| `routes/chat.ts` | Use `ollama.chatSimple()` for title/compaction/memory instead of `ollama.chat()` |

### Files unchanged

| File | Reason |
|------|--------|
| `aura/web-search.ts` | Calls cloud `ollama.com` API — different host, auth, endpoints |
| `routes/settings.ts:171` | Tests cloud API key — same reasoning |
| `storage/types.ts` | Existing types still used by `chatStream` and `chat` |
| `routes/models.ts` | Already uses `OllamaService` |

## Wiring in `index.ts`

Current:
```typescript
const ollama = new OllamaService(OLLAMA_URL)
```

After:
```typescript
const ollama = new OllamaService(store, process.env.OLLAMA_URL)
```

The `OllamaService` instance is then passed to all routers and services that need it, replacing raw URL strings.

## Future Provider-Agnostic Path

When adding OpenAI, Anthropic, or other providers:

1. Extract `OllamaService`'s public methods into an `InferenceProvider` interface
2. Create `OpenAIProvider`, `AnthropicProvider`, etc. implementing that interface
3. Add a factory function: `createProvider(settings)` → reads settings, returns the right provider
4. Every consumer already depends on the interface methods — zero call-site changes

The `resolveBaseUrl()` and `resolveModel()` static methods become factory concerns, and `checkAvailability()` semantics generalize to "is this provider reachable and configured correctly."

## Scope Boundaries

- **In scope:** All localhost Ollama HTTP calls (`/api/chat`, `/api/tags`, `/api/embeddings`)
- **Out of scope:** Cloud Ollama API calls (`ollama.com/api/web_search`, `/api/web_fetch`), frontend code, `WebSearchService`, settings API key validation