# Provider-Agnostic Inference Layer Design

**Date:** 2026-06-21
**Status:** Approved
**Approach:** Option A — Normalize streaming format in the provider

## Problem

The inference layer is hardcoded to Ollama. To support OpenAI and OpenAI-compatible providers (Groq, Together, self-hosted vLLM, etc.), we need an abstraction that lets consumers call a uniform interface regardless of which provider is active.

## Solution

Define an `InferenceProvider` interface with normalized message/streaming formats. Each provider (Ollama, OpenAI, OpenAI-compatible) implements this interface. A factory function reads settings and returns the right provider. Consumers only see `InferenceProvider` — they never know which provider is active.

### Design Principle: Normalize in the provider

Each provider converts its native API format to a single canonical format. Consumers (chat route, AURA agent, embedding service) only parse one format. This means:
- Ollama's NDJSON streaming stays as-is (it's our canonical format)
- OpenAI's SSE streaming is converted to NDJSON inside `OpenAIProvider`
- Tool calls are normalized from OpenAI's `choices[].delta.tool_calls` to Ollama's `message.tool_calls` shape

## Architecture

```
Settings UI
     │
     ▼
createProvider(store, settings)  ←── ProviderManager caches & switches
     │
     ├─── "ollama" ──────► OllamaProvider ────► localhost:11434/api/*
     │                                          (NDJSON streaming, native format)
     │
     ├─── "openai" ─────► OpenAIProvider ────► api.openai.com/v1/*
     │                                          (SSE→NDJSON conversion, auth header)
     │
     └─── "openai-compatible" ► OpenAIProvider ──► {customBaseUrl}/*
                                   (same as OpenAI, different URL+key)
     │
     ▼
InferenceProvider interface
     │
     ├── chatStream()  ──► all consumers (normalized NDJSON)
     ├── chatSimple()  ──► title gen, compaction, memory
     ├── embed()       ──► embedding service
     ├── checkAvailability()
     ├── listModels()
     └── isHealthy()
```

## Type System

### Normalized Types (`server/services/inference/types.ts`)

```typescript
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  toolCalls?: ToolCall[]
  toolCallId?: string
  name?: string
  thinking?: string
}

export interface ToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
}

export interface ChatRequest {
  model: string
  messages: ChatMessage[]
  stream?: boolean
  tools?: ToolDefinition[]
  options?: { numCtx?: number; [key: string]: unknown }
}

export interface ChatResponse {
  message: ChatMessage
}

export interface ModelInfo {
  name: string
  size: number
  modifiedAt: string
  isEmbedding?: boolean
  isVision?: boolean
}

export interface ToolDefinition {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

export interface InferenceProvider {
  readonly name: string
  checkAvailability(model?: string): Promise<boolean>
  chat(request: ChatRequest): Promise<ChatResponse>
  chatStream(request: ChatRequest): Promise<ReadableStream<Uint8Array>>
  chatSimple(model: string, messages: ChatMessage[], options?: { timeout?: number }): Promise<string | null>
  embed(model: string, prompt: string, timeout?: number): Promise<number[] | null>
  listModels(): Promise<ModelInfo[]>
  isHealthy(): Promise<boolean>
}
```

### Legacy Types

`OllamaChatRequest`, `OllamaChatResponse`, `OllamaChatMessage`, `OllamaModel`, `OllamaTagsResponse` stay in `server/storage/types.ts`. They're used internally by `OllamaProvider` for its API communication, but consumers never see them. The provider converts between legacy types and normalized types internally.

## Provider Implementations

### OllamaProvider (`server/services/inference/ollama-provider.ts`)

Extracted from current `OllamaService`. Changes:
- Class renamed to `OllamaProvider`, implements `InferenceProvider`
- Method signatures use normalized types (`ChatMessage[]` instead of `OllamaChatMessage[]`)
- `name` property returns `'ollama'`
- Internal logic identical — same URLs, same NDJSON streaming, same caching
- `resolveBaseUrl()` and `resolveModel()` stay as static helpers (used by the factory)

### OpenAIProvider (`server/services/inference/openai-provider.ts`)

New provider for OpenAI and OpenAI-compatible endpoints.

**Constructor:**
```typescript
constructor(store: FileStore, apiKey: string, baseUrl: string, name?: string)
```
- `store` — for reading settings dynamically
- `apiKey` — Bearer token for Authorization header
- `baseUrl` — e.g., `https://api.openai.com/v1`, `https://api.groq.com/v1`
- `name` — `'openai'` or `'openai-compatible'`

**Key method: `sseToNdjson()`** — converts OpenAI's SSE streaming to Ollama's NDJSON format:
- Reads SSE lines (`data: {...}`)
- Parses each chunk's `choices[0].delta`
- Normalizes to `{ message: { content, tool_calls }, done }` shape
- Emits NDJSON lines (`{...}\n`) — identical to what Ollama sends

**Tool call normalization:**
- OpenAI format: `{ id, type: "function", function: { name, arguments: "stringified JSON" } }`
- Normalized format: `{ id, name, arguments: { object } }` (arguments parsed from string)
- Conversion happens in both directions: `toOpenAIMessages()` for requests, `sseToNdjson()` for responses

**Endpoint mapping:**

| Operation | Ollama | OpenAI |
|-----------|--------|--------|
| Chat | `POST /api/chat` | `POST /chat/completions` |
| Embeddings | `POST /api/embeddings` | `POST /embeddings` |
| Models | `GET /api/tags` | `GET /models` |
| Health | `GET /` | `GET /models` (with auth) |

**Embeddings difference:** OpenAI uses `input` instead of `prompt`, and returns `{ data: [{ embedding: [...] }] }` instead of `{ embedding: [...] }`.

**Model listing difference:** OpenAI returns `{ data: [{ id, created, ... }] }` instead of `{ models: [{ name, size, ... }] }`. `isEmbedding` and `isVision` are inferred from model name patterns.

## Factory & Dynamic Switching

### Factory Function (`server/services/inference/create-provider.ts`)

```typescript
export function createProvider(store: FileStore, settings?: Settings | null): InferenceProvider {
  const provider = settings?.inferenceProvider || 'ollama'
  switch (provider) {
    case 'openai':
      return new OpenAIProvider(
        store,
        settings?.openaiApiKey || process.env.OPENAI_API_KEY || '',
        'https://api.openai.com/v1',
        'openai',
      )
    case 'openai-compatible':
      return new OpenAIProvider(
        store,
        settings?.customInferenceApiKey || process.env.CUSTOM_INFERENCE_API_KEY || '',
        settings?.customInferenceBaseUrl || process.env.CUSTOM_INFERENCE_BASE_URL || 'https://api.groq.com/v1',
        'openai-compatible',
      )
    case 'ollama':
    default:
      return new OllamaProvider(store)
  }
}
```

### ProviderManager (`server/services/inference/provider-manager.ts`)

Caches the current provider and re-creates it when the provider type or credentials change:

```typescript
export class ProviderManager {
  private current: InferenceProvider | null = null
  private currentProviderName: string | null = null
  private store: FileStore

  constructor(store: FileStore) { this.store = store }

  async getProvider(): Promise<InferenceProvider> {
    const settings = await this.store.read<Settings>('settings.json')
    const providerName = settings?.inferenceProvider || 'ollama'
    
    if (this.current && this.currentProviderName === providerName) {
      // For providers with dynamic config, check if credentials changed
      if (this.current instanceof OpenAIProvider) {
        const newKey = getApiKeyForProvider(settings, providerName)
        if (this.current.apiKey === newKey) return this.current
      } else {
        return this.current  // OllamaProvider reads URL dynamically
      }
    }
    
    this.current = createProvider(this.store, settings)
    this.currentProviderName = providerName
    return this.current
  }
}
```

## Settings Schema Changes

Add to `Settings` interface in `server/storage/types.ts`:

```typescript
inferenceProvider: 'ollama' | 'openai' | 'openai-compatible'  // default: 'ollama'
openaiApiKey: string          // default: '' (falls back to OPENAI_API_KEY env)
customInferenceBaseUrl: string  // default: '' (for openai-compatible)
customInferenceApiKey: string   // default: '' (for openai-compatible)
```

Default values in `server/routes/settings.ts`:
```typescript
inferenceProvider: 'ollama',
openaiApiKey: '',
customInferenceBaseUrl: '',
customInferenceApiKey: '',
```

## Consumer Migration

Every file that takes `ollama: OllamaService` changes to `inference: InferenceProvider`:

| File | Change |
|------|--------|
| `server/index.ts` | `ProviderManager` instead of `OllamaService`. Pass `manager` to routers. |
| `server/routes/chat.ts` | `InferenceProvider` type. Method calls unchanged. |
| `server/routes/models.ts` | `InferenceProvider` type. |
| `server/routes/settings.ts` | `ProviderManager` type. Adds provider switching + OpenAI key test endpoint. |
| `server/routes/aura.ts` | Config changes `{ ollama }` → `{ inference }`. |
| `server/services/aura/agent.ts` | `inference: InferenceProvider` param. |
| `server/services/aura/context-generator.ts` | Same. |
| `server/services/aura/search/embedding.ts` | Same. |
| `server/services/aura/indexer.ts` | Config type changes. |
| `server/services/aura/graph.ts` | Config type changes. |
| `server/routes/projects.ts` | `InferenceProvider` type. |

**Method calls stay identical** — `inference.chatStream(...)`, `inference.embed(...)`, `inference.checkAvailability(...)`. The interface guarantees the same method signatures.

## What Stays Unchanged

| Component | Reason |
|-----------|--------|
| `WebSearchService` | Cloud Ollama API — different service |
| `server/routes/settings.ts: test-api-key` | Tests cloud API key — stays separate |
| Business logic in `chat.ts` | SSE parsing, tool call resolution — unchanged because stream format is normalized |
| AURA agent tool call handling | Parses normalized tool calls from stream |
| Frontend | Talks to `/api/chat`, `/api/models` — route-level abstractions unchanged |

## Settings UI

New "Inference" section in Settings panel:

- Provider dropdown: Ollama / OpenAI / OpenAI-Compatible
- Ollama section: Base URL (existing)
- OpenAI section: API Key (masked input)
- OpenAI-Compatible section: Base URL + API Key
- "Test Connection" button that calls `inference.isHealthy()` for the current provider
- Model dropdown refreshes when provider changes (calls `inference.listModels()`)

## Scope Boundaries

- **In scope:** Ollama, OpenAI, OpenAI-compatible providers; all localhost and cloud inference via the `InferenceProvider` interface; streaming normalization; tool call normalization; settings UI; dynamic provider switching
- **Out of scope:** NVIDIA NIM as a separate provider (it's covered by OpenAI-compatible); Anthropic/Claude (different API shape, can be added later as `AnthropicProvider`); frontend redesign beyond the settings panel; model cost/quota management

## Future Extensions

Adding a new provider (e.g., Anthropic) requires:
1. Create `server/services/inference/anthropic-provider.ts` implementing `InferenceProvider`
2. Add `'anthropic'` to the `inferenceProvider` union type
3. Add Anthropic settings fields
4. Add a case in `createProvider()`
5. No consumer changes needed