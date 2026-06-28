# Provider-Agnostic Inference Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Abstract the inference layer so the app supports Ollama, OpenAI, and OpenAI-compatible providers through a single `InferenceProvider` interface, with streaming normalization handled inside each provider.

**Architecture:** Define an `InferenceProvider` interface with normalized types (`ChatMessage`, `ChatRequest`, `ChatResponse`, `ToolCall`, `ModelInfo`). Extract current `OllamaService` into `OllamaProvider` implementing this interface. Create `OpenAIProvider` for OpenAI and OpenAI-compatible providers, with SSE→NDJSON stream conversion and tool call normalization. A `ProviderManager` reads settings and returns the right provider. All consumers switch from `OllamaService` to `InferenceProvider`.

**Tech Stack:** TypeScript, Node.js, Express, Vite

## Global Constraints

- The normalized streaming format is Ollama's NDJSON shape — consumers only parse one format
- Tool calls are normalized to `{ id, name, arguments }` shape regardless of provider
- `ProviderManager` caches the current provider and re-creates only when provider type or credentials change
- `OllamaProvider` is a rename of `OllamaService` with interface compliance — no logic changes
- `OpenAIProvider` handles both `api.openai.com` and any OpenAI-compatible endpoint (same class, different constructor args)
- Settings UI gets an "Inference Provider" dropdown with conditional fields per provider
- The `Settings` type gains `inferenceProvider`, `openaiApiKey`, `customInferenceBaseUrl`, `customInferenceApiKey`
- Existing `ollamaBaseUrl` and `ollamaApiKey` stay for Ollama-specific config
- WebSearchService stays separate (cloud Ollama API)

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `server/services/inference/types.ts` | **Create** | `InferenceProvider` interface, `ChatMessage`, `ChatRequest`, `ChatResponse`, `ToolCall`, `ToolDefinition`, `ModelInfo` |
| `server/services/inference/ollama-provider.ts` | **Create** | `OllamaProvider` class implementing `InferenceProvider` |
| `server/services/inference/openai-provider.ts` | **Create** | `OpenAIProvider` class implementing `InferenceProvider` |
| `server/services/inference/create-provider.ts` | **Create** | Factory function and `ProviderManager` class |
| `server/services/ollama.ts` | **Delete** | Replaced by `inference/ollama-provider.ts` |
| `server/storage/types.ts` | **Modify** | Add `inferenceProvider`, `openaiApiKey`, `customInferenceBaseUrl`, `customInferenceApiKey` to `Settings` |
| `server/index.ts` | **Modify** | Use `ProviderManager` instead of `OllamaService` |
| `server/routes/chat.ts` | **Modify** | `OllamaService` → `InferenceProvider` |
| `server/routes/models.ts` | **Modify** | `OllamaService` → `InferenceProvider` |
| `server/routes/settings.ts` | **Modify** | `OllamaService` → `ProviderManager`, add provider-switching endpoints |
| `server/routes/aura.ts` | **Modify** | Config type change |
| `server/routes/skills.ts` | **Modify** | `OllamaService` → `InferenceProvider` |
| `server/routes/projects.ts` | **Modify** | `OllamaService` → `InferenceProvider` |
| `server/services/aura/agent.ts` | **Modify** | `OllamaService` → `InferenceProvider` |
| `server/services/aura/context-generator.ts` | **Modify** | `OllamaService` → `InferenceProvider` |
| `server/services/aura/search/embedding.ts` | **Modify** | `OllamaService` → `InferenceProvider` |
| `server/services/aura/indexer.ts` | **Modify** | Config type |
| `server/services/aura/graph.ts` | **Modify** | Config type |

---

### Task 1: Create inference types interface

**Files:**
- Create: `server/services/inference/types.ts`

**Interfaces:**
- Produces: `InferenceProvider`, `ChatMessage`, `ChatRequest`, `ChatResponse`, `ToolCall`, `ToolDefinition`, `ModelInfo`

- [ ] **Step 1: Create the types file**

```typescript
// server/services/inference/types.ts

export interface ToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  toolCalls?: ToolCall[]
  toolCallId?: string
  name?: string
  thinking?: string
}

export interface ToolDefinition {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
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

- [ ] **Step 2: Run TypeScript check**

Run: `npx tsc --noEmit -p tsconfig.server.json 2>&1 | grep -c "error TS"`

Expected: Same count as before (this new file has no consumers yet).

- [ ] **Step 3: Commit**

```bash
git add server/services/inference/types.ts
git commit -m "feat: add InferenceProvider interface and normalized types"
```

---

### Task 2: Create OllamaProvider

**Files:**
- Create: `server/services/inference/ollama-provider.ts`
- Delete: `server/services/ollama.ts`

**Interfaces:**
- Consumes: `InferenceProvider`, `ChatMessage`, `ChatRequest`, `ChatResponse`, `ModelInfo` from Task 1
- Consumes: `FileStore`, `Settings`, `OllamaChatRequest`, `OllamaChatResponse`, `OllamaModel`, `OllamaTagsResponse` from existing types
- Produces: `OllamaProvider` class that implements `InferenceProvider`

This task extracts the current `OllamaService` into `OllamaProvider`, adapting method signatures to use normalized types. The internal HTTP calls stay identical — we just convert between normalized types and Ollama's native types at the boundary.

- [ ] **Step 1: Create `server/services/inference/ollama-provider.ts`**

The file is a copy of `server/services/ollama.ts` with these changes:
1. Class renamed from `OllamaService` to `OllamaProvider`
2. Implements `InferenceProvider`
3. Import normalized types from `./types.ts`
4. `chat()` converts `ChatRequest` → Ollama's format, then converts response back to `ChatResponse`
5. `chatStream()` converts `ChatRequest` → Ollama's format, returns raw stream (Ollama NDJSON is already our canonical format)
6. `chatSimple()` uses `ChatMessage[]` instead of `{role, content}[]`
7. `listModels()` returns `ModelInfo[]` instead of `OllamaModel[]`
8. `name` property returns `'ollama'`
9. Static methods `resolveBaseUrl` and `resolveModel` stay

Key conversion helpers needed:

```typescript
/** Convert normalized ChatMessage[] to Ollama's native format */
private toOllamaMessages(messages: ChatMessage[]): Array<{ role: string; content: string; tool_calls?: any[]; tool_call_id?: string; name?: string }> {
  return messages.map(msg => {
    const ollamaMsg: Record<string, unknown> = { role: msg.role, content: msg.content ?? '' }
    if (msg.toolCalls) {
      ollamaMsg.tool_calls = msg.toolCalls.map(tc => ({
        function: { name: tc.name, arguments: tc.arguments },
        ...(tc.id ? { id: tc.id } : {}),
      }))
    }
    if (msg.toolCallId) ollamaMsg.tool_call_id = msg.toolCallId
    if (msg.name) ollamaMsg.name = msg.name
    if (msg.thinking) ollamaMsg.thinking = msg.thinking
    return ollamaMsg
  })
}

/** Convert Ollama response to normalized ChatResponse */
private toChatResponse(data: any): ChatResponse {
  return {
    message: {
      role: data.message?.role || 'assistant',
      content: data.message?.content ?? null,
      toolCalls: data.message?.tool_calls?.map((tc: any) => ({
        id: tc.id || tc.function?.name,
        name: tc.function?.name,
        arguments: typeof tc.function?.arguments === 'string'
          ? JSON.parse(tc.function.arguments)
          : tc.function?.arguments || {},
      })),
      thinking: data.message?.thinking,
    },
  }
}

/** Convert OllamaModel[] to ModelInfo[] */
private toModelInfo(models: OllamaModel[]): ModelInfo[] {
  return models.map(m => ({
    name: m.name,
    size: m.size,
    modifiedAt: m.modified_at,
    isEmbedding: m.isEmbedding,
    isVision: m.isVision,
  }))
}
```

The `chatStream` method signature changes to accept `ChatRequest` but the internal logic stays the same — Ollama's NDJSON is already our canonical streaming format. We convert `ChatRequest` to Ollama's format and pass `stream: true` as before.

The `chatSimple` method signature changes to use `ChatMessage[]`:
```typescript
async chatSimple(model: string, messages: ChatMessage[], options?: { timeout?: number }): Promise<string | null> {
  // ... same internal logic, but uses this.toOllamaMessages(messages) internally
}
```

Export the class and also re-export `resolveBaseUrl` and `resolveModel` as standalone functions (they'll be needed by the factory).

Also add a re-export from `server/services/inference/index.ts` for convenience:
```typescript
// server/services/inference/index.ts
export { OllamaProvider } from './ollama-provider.ts'
export { OpenAIProvider } from './openai-provider.ts'
export { createProvider, ProviderManager } from './create-provider.ts'
export type { InferenceProvider, ChatMessage, ChatRequest, ChatResponse, ToolCall, ToolDefinition, ModelInfo } from './types.ts'
```

- [ ] **Step 2: Update all imports from `../services/ollama.ts` to `../services/inference/index.ts`**

In every file that currently imports `OllamaService` or `type { OllamaService }`, change:
- `import { OllamaService } from '../services/ollama.ts'` → `import type { InferenceProvider } from '../services/inference/index.ts'`
- `import type { OllamaService } from '../services/ollama.ts'` → `import type { InferenceProvider } from '../services/inference/index.ts'`

Files to update (based on grep):
- `server/index.ts`
- `server/routes/aura.ts`
- `server/routes/chat.ts`
- `server/routes/models.ts`
- `server/routes/settings.ts`
- `server/routes/skills.ts`
- `server/routes/projects.ts`
- `server/services/aura/agent.ts`
- `server/services/aura/context-generator.ts`
- `server/services/aura/search/embedding.ts`
- `server/services/aura/indexer.ts`
- `server/services/aura/graph.ts`

In each file, also rename all `ollama: OllamaService` parameters to `inference: InferenceProvider` (or the local variable name). The method calls stay the same since the interface methods match.

- [ ] **Step 3: Delete `server/services/ollama.ts`**

After all imports are updated, delete the old file.

- [ ] **Step 4: Run TypeScript check**

Run: `npx tsc --noEmit -p tsconfig.server.json 2>&1 | head -30`

Expected: Errors from `OpenAIProvider` not existing yet (Task 3). No errors from the OllamaProvider or consumer files.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: extract OllamaService into OllamaProvider with InferenceProvider interface"
```

---

### Task 3: Create OpenAIProvider

**Files:**
- Create: `server/services/inference/openai-provider.ts`

**Interfaces:**
- Consumes: `InferenceProvider`, `ChatMessage`, `ChatRequest`, `ChatResponse`, `ToolCall`, `ToolDefinition`, `ModelInfo` from Task 1
- Consumes: `FileStore`, `Settings` from existing code
- Produces: `OpenAIProvider` class implementing `InferenceProvider`

- [ ] **Step 1: Create `server/services/inference/openai-provider.ts`**

This is the new provider. It handles both `api.openai.com/v1` and any OpenAI-compatible endpoint (Groq, Together, self-hosted vLLM, etc.) by taking a configurable `baseUrl` and `apiKey`.

Key methods:

**Constructor:**
```typescript
export class OpenAIProvider implements InferenceProvider {
  readonly name: string
  private apiKey: string
  private baseUrl: string
  private store: FileStore
  private availabilityCache: { result: boolean; timestamp: number } | null = null

  constructor(store: FileStore, apiKey: string, baseUrl: string, name?: string) {
    this.store = store
    this.apiKey = apiKey
    this.baseUrl = baseUrl.replace(/\/$/, '')
    this.name = name || 'openai'
  }
```

**`chatStream()`** — the most important method. Makes a request to `/chat/completions` with `stream: true`, then converts the SSE response to NDJSON matching Ollama's format using `sseToNdjson()`:

```typescript
async chatStream(request: ChatRequest): Promise<ReadableStream<Uint8Array>> {
  const res = await fetch(`${this.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.apiKey}`,
    },
    body: JSON.stringify({
      model: request.model,
      messages: this.toOpenAIMessages(request.messages),
      stream: true,
      ...(request.tools?.length ? { tools: request.tools } : {}),
    }),
  })
  if (!res.ok) {
    throw new Error(`OpenAI API error: ${res.status} ${await res.text().catch(() => res.statusText)}`)
  }
  if (!res.body) throw new Error('No response body for streaming')
  return this.sseToNdjson(res.body)
}
```

**`sseToNdjson()`** — converts OpenAI's SSE format to Ollama's NDJSON format. This is the critical normalization function:

```typescript
private sseToNdjson(sseBody: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const reader = sseBody.getReader()
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  let sseBuffer = ''

  return new ReadableStream({
    async pull(controller) {
      while (true) {
        const { done, value } = await reader.read()
        if (done) {
          // Flush any remaining buffer
          if (sseBuffer.trim()) {
            const line = sseBuffer.trim()
            if (line.startsWith('data: ') && line !== 'data: [DONE]') {
              try {
                const parsed = JSON.parse(line.slice(6))
                const normalized = normalizeOpenAIChunk(parsed)
                if (normalized) controller.enqueue(encoder.encode(JSON.stringify(normalized) + '\n'))
              } catch { /* skip malformed */ }
            }
          }
          // Send final done signal
          controller.enqueue(encoder.encode(JSON.stringify({ done: true }) + '\n'))
          controller.close()
          return
        }

        sseBuffer += decoder.decode(value, { stream: true })
        const lines = sseBuffer.split('\n')
        sseBuffer = lines.pop() || ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed.startsWith('data: ')) continue
          const data = trimmed.slice(6)
          if (data === '[DONE]') {
            controller.enqueue(encoder.encode(JSON.stringify({ done: true }) + '\n'))
            controller.close()
            return
          }
          try {
            const parsed = JSON.parse(data)
            const normalized = normalizeOpenAIChunk(parsed)
            if (normalized) controller.enqueue(encoder.encode(JSON.stringify(normalized) + '\n'))
          } catch { /* skip malformed chunks */ }
        }
      }
    },
  })
}
```

**`normalizeOpenAIChunk()`** — converts an OpenAI streaming chunk to Ollama's message format:

```typescript
function normalizeOpenAIChunk(chunk: any): { message: { content: string; tool_calls: any[] | null; thinking?: string }; done: boolean } | null {
  const delta = chunk.choices?.[0]?.delta
  if (!delta) return null
  return {
    message: {
      content: delta.content || '',
      tool_calls: delta.tool_calls?.map((tc: any) => ({
        id: tc.id || '',
        function: {
          name: tc.function?.name || '',
          arguments: typeof tc.function?.arguments === 'string' ? tc.function.arguments : JSON.stringify(tc.function?.arguments || {}),
        },
      })) || null,
    },
    done: false,
  }
}
```

**`toOpenAIMessages()`** — converts normalized `ChatMessage[]` to OpenAI's message format:

```typescript
private toOpenAIMessages(messages: ChatMessage[]): Array<Record<string, unknown>> {
  return messages.map(msg => {
    const openaiMsg: Record<string, unknown> = { role: msg.role, content: msg.content ?? '' }
    if (msg.toolCalls) {
      openaiMsg.tool_calls = msg.toolCalls.map(tc => ({
        id: tc.id,
        type: 'function' as const,
        function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
      }))
    }
    if (msg.toolCallId) openaiMsg.tool_call_id = msg.toolCallId
    if (msg.name) openaiMsg.name = msg.name
    return openaiMsg
  })
}
```

**`chat()`** — non-streaming, converts response:

```typescript
async chat(request: ChatRequest): Promise<ChatResponse> {
  const res = await fetch(`${this.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.apiKey}`,
    },
    body: JSON.stringify({
      model: request.model,
      messages: this.toOpenAIMessages(request.messages),
      stream: false,
      ...(request.tools?.length ? { tools: request.tools } : {}),
    }),
  })
  if (!res.ok) throw new Error(`OpenAI API error: ${res.status}`)
  const data = await res.json()
  const choice = data.choices?.[0]
  return {
    message: {
      role: 'assistant',
      content: choice?.message?.content ?? null,
      toolCalls: choice?.message?.tool_calls?.map((tc: any) => ({
        id: tc.id,
        name: tc.function?.name,
        arguments: typeof tc.function?.arguments === 'string'
          ? JSON.parse(tc.function.arguments)
          : tc.function?.arguments || {},
      })),
    },
  }
}
```

**`embed()`** — OpenAI uses `input` instead of `prompt`, and returns `{ data: [{ embedding: [...] }] }`:

```typescript
async embed(model: string, prompt: string, timeout = 30000): Promise<number[] | null> {
  try {
    const res = await fetch(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ model, input: prompt }),
      signal: AbortSignal.timeout(timeout),
    })
    if (!res.ok) return null
    const data = await res.json()
    return data.data?.[0]?.embedding ?? null
  } catch {
    return null
  }
}
```

**`listModels()`** — OpenAI returns `{ data: [{ id, created, ... }] }`:

```typescript
async listModels(): Promise<ModelInfo[]> {
  const res = await fetch(`${this.baseUrl}/models`, {
    headers: { 'Authorization': `Bearer ${this.apiKey}` },
  })
  if (!res.ok) throw new Error(`OpenAI API error: ${res.status}`)
  const data = await res.json()
  return (data.data || []).map((m: any) => ({
    name: m.id,
    size: 0,
    modifiedAt: m.created ? new Date(m.created * 1000).toISOString() : '',
    isEmbedding: m.id?.includes('embed') || false,
    isVision: m.id?.includes('vision') || m.id?.includes('gpt-4o') || false,
  }))
}
```

**`checkAvailability()`** and **`isHealthy()`** — use `/models` endpoint with auth:

```typescript
async checkAvailability(model?: string): Promise<boolean> {
  const now = Date.now()
  if (this.availabilityCache && now - this.availabilityCache.timestamp < 60_000) {
    return this.availabilityCache.result
  }
  try {
    const res = await fetch(`${this.baseUrl}/models`, {
      headers: { 'Authorization': `Bearer ${this.apiKey}` },
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) {
      this.availabilityCache = { result: false, timestamp: now }
      return false
    }
    if (model) {
      const data = await res.json()
      const available = (data.data ?? []).some((m: any) => m.id === model || m.id.startsWith(model.split(':')[0]))
      this.availabilityCache = { result: available, timestamp: now }
      return available
    }
    this.availabilityCache = { result: true, timestamp: now }
    return true
  } catch {
    this.availabilityCache = { result: false, timestamp: now }
    return false
  }
}

async isHealthy(): Promise<boolean> {
  try {
    const res = await fetch(`${this.baseUrl}/models`, {
      headers: { 'Authorization': `Bearer ${this.apiKey}` },
    })
    return res.ok
  } catch {
    return false
  }
}
```

**`chatSimple()`** — convenience wrapper:

```typescript
async chatSimple(model: string, messages: ChatMessage[], options?: { timeout?: number }): Promise<string | null> {
  try {
    const response = await this.chat({ model, messages, stream: false })
    return response.message.content?.trim() ?? null
  } catch {
    return null
  }
}
```

- [ ] **Step 2: Run TypeScript check**

Run: `npx tsc --noEmit -p tsconfig.server.json 2>&1 | head -30`

Expected: No new errors from this file.

- [ ] **Step 3: Commit**

```bash
git add server/services/inference/openai-provider.ts
git commit -m "feat: add OpenAIProvider with SSE→NDJSON streaming normalization"
```

---

### Task 4: Create factory and ProviderManager

**Files:**
- Create: `server/services/inference/create-provider.ts`
- Create: `server/services/inference/index.ts` (barrel export)

**Interfaces:**
- Consumes: `OllamaProvider` (Task 2), `OpenAIProvider` (Task 3), `Settings`, `FileStore`
- Produces: `createProvider()` function, `ProviderManager` class

- [ ] **Step 1: Create `server/services/inference/create-provider.ts`**

```typescript
import type { Settings } from '../../storage/types.ts'
import type { FileStore } from '../../storage/fileStore.ts'
import type { InferenceProvider } from './types.ts'
import { OllamaProvider } from './ollama-provider.ts'
import { OpenAIProvider } from './openai-provider.ts'

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

export class ProviderManager {
  private current: InferenceProvider | null = null
  private currentProviderName: string | null = null
  private currentApiKey: string | null = null
  private store: FileStore

  constructor(store: FileStore) {
    this.store = store
  }

  async getProvider(): Promise<InferenceProvider> {
    const settings = await this.store.read<Settings>('settings.json')
    const providerName = settings?.inferenceProvider || 'ollama'

    // Check if we can reuse the cached provider
    if (this.current && this.currentProviderName === providerName) {
      // For OpenAI providers, check if the API key changed
      if (this.current instanceof OpenAIProvider) {
        const newKey = providerName === 'openai'
          ? (settings?.openaiApiKey || process.env.OPENAI_API_KEY || '')
          : (settings?.customInferenceApiKey || process.env.CUSTOM_INFERENCE_API_KEY || '')
        if (this.current.apiKey === newKey) return this.current
      } else {
        // OllamaProvider reads URL dynamically from store
        return this.current
      }
    }

    // Provider type or credentials changed — recreate
    this.current = createProvider(this.store, settings)
    this.currentProviderName = providerName
    return this.current
  }
}
```

- [ ] **Step 2: Create `server/services/inference/index.ts` barrel export**

```typescript
export { OllamaProvider } from './ollama-provider.ts'
export { OpenAIProvider } from './openai-provider.ts'
export { createProvider, ProviderManager } from './create-provider.ts'
export type { InferenceProvider, ChatMessage, ChatRequest, ChatResponse, ToolCall, ToolDefinition, ModelInfo } from './types.ts'
```

- [ ] **Step 3: Add `apiKey` getter to `OpenAIProvider`**

Add a public getter so `ProviderManager` can compare keys:

```typescript
/** Public getter for API key comparison */
get apiKey(): string {
  return this._apiKey
}
```

(Rename the private field from `apiKey` to `_apiKey` in the constructor.)

- [ ] **Step 4: Run TypeScript check**

Run: `npx tsc --noEmit -p tsconfig.server.json 2>&1 | head -20`

Expected: No new errors.

- [ ] **Step 5: Commit**

```bash
git add server/services/inference/create-provider.ts server/services/inference/index.ts server/services/inference/openai-provider.ts
git commit -m "feat: add ProviderManager, factory function, and barrel export"
```

---

### Task 5: Update Settings types and defaults

**Files:**
- Modify: `server/storage/types.ts`
- Modify: `server/routes/settings.ts`

**Interfaces:**
- Consumes: `Settings` interface

- [ ] **Step 1: Add new fields to `Settings` interface in `server/storage/types.ts`**

Add these fields after `ollamaApiKey`:

```typescript
  inferenceProvider: 'ollama' | 'openai' | 'openai-compatible'
  openaiApiKey: string               // default: '' (falls back to OPENAI_API_KEY env)
  customInferenceBaseUrl: string     // default: '' (for openai-compatible)
  customInferenceApiKey: string     // default: '' (for openai-compatible)
```

- [ ] **Step 2: Add defaults in `server/routes/settings.ts`**

Add to the `DEFAULT_SETTINGS` object:

```typescript
  inferenceProvider: 'ollama',
  openaiApiKey: '',
  customInferenceBaseUrl: '',
  customInferenceApiKey: '',
```

Also add migration blocks for existing settings (same pattern as the existing `ollamaBaseUrl` migration):

```typescript
  if (settings.inferenceProvider === undefined) {
    settings.inferenceProvider = 'ollama'
    await store.write('settings.json', settings)
  }
  if (settings.openaiApiKey === undefined) {
    settings.openaiApiKey = ''
    await store.write('settings.json', settings)
  }
  if (settings.customInferenceBaseUrl === undefined) {
    settings.customInferenceBaseUrl = ''
    await store.write('settings.json', settings)
  }
  if (settings.customInferenceApiKey === undefined) {
    settings.customInferenceApiKey = ''
    await store.write('settings.json', settings)
  }
```

Update the GET endpoint to include `hasEnvOpenaiKey` and `hasEnvCustomKey` flags:

```typescript
  const clientSettings = {
    ...merged,
    openaiApiKey: maskApiKey(merged.openaiApiKey || ''),
    hasEnvOpenaiKey: !!process.env.OPENAI_API_KEY,
    customInferenceApiKey: maskApiKey(merged.customInferenceApiKey || ''),
    hasEnvCustomKey: !!process.env.CUSTOM_INFERENCE_API_KEY,
  }
```

- [ ] **Step 3: Add `test-openai` and `test-custom-inference` endpoints**

After the existing `test-ollama` endpoint, add:

```typescript
  // Test OpenAI API Key — validates key against OpenAI
  router.post('/test-openai', async (req, res) => {
    const { apiKey } = req.body as { apiKey?: string }
    if (!apiKey || !apiKey.trim()) {
      res.json({ ok: false, error: 'No API key provided' })
      return
    }
    try {
      const testProvider = new OpenAIProvider(store, apiKey.trim(), 'https://api.openai.com/v1', 'openai')
      const models = await testProvider.listModels()
      res.json({ ok: true, modelCount: models.length })
    } catch (err: unknown) {
      let message = 'Connection failed'
      if (err instanceof Error) message = err.message
      res.json({ ok: false, error: message })
    }
  })

  // Test custom inference endpoint
  router.post('/test-custom-inference', async (req, res) => {
    const { baseUrl, apiKey } = req.body as { baseUrl?: string; apiKey?: string }
    if (!baseUrl || !baseUrl.trim()) {
      res.json({ ok: false, error: 'Base URL is required' })
      return
    }
    try {
      const normalized = OllamaProvider.resolveBaseUrl(baseUrl)
      const testProvider = new OpenAIProvider(store, apiKey?.trim() || '', normalized, 'openai-compatible')
      const models = await testProvider.listModels()
      res.json({ ok: true, modelCount: models.length, url: normalized })
    } catch (err: unknown) {
      let message = 'Connection failed'
      if (err instanceof Error) message = err.message
      res.json({ ok: false, error: message })
    }
  })
```

Add the import for `OpenAIProvider` at the top of `settings.ts`:

```typescript
import { OllamaProvider } from '../services/inference/ollama-provider.ts'
import { OpenAIProvider } from '../services/inference/openai-provider.ts'
```

And change the `OllamaService` import to use `InferenceProvider`:

```typescript
import type { InferenceProvider } from '../services/inference/index.ts'
```

Update `createSettingsRouter` to accept `ProviderManager` instead of `OllamaService`:

```typescript
export function createSettingsRouter(store: FileStore, providerManager: ProviderManager) {
```

Update the `test-ollama` endpoint to use `ProviderManager`:

```typescript
  router.post('/test-ollama', async (req, res) => {
    const { url } = req.body as { url?: string }
    try {
      const testService = url?.trim()
        ? new OllamaProvider(store, url.trim())
        : await providerManager.getProvider()
      const models = await testService.listModels()
      res.json({ ok: true, modelCount: models.length })
    } catch (err: unknown) {
      // ... error handling stays the same
    }
  })
```

- [ ] **Step 4: Update `models.ts` route to use `ProviderManager`**

Change `createModelsRouter` to accept `ProviderManager` instead of `InferenceProvider`:

```typescript
import { ProviderManager } from '../services/inference/index.ts'
import type { InferenceProvider } from '../services/inference/index.ts'

export function createModelsRouter(providerManager: ProviderManager, store: FileStore) {
  const router = Router()

  router.get('/', async (_req, res) => {
    try {
      const inference = await providerManager.getProvider()
      const models = await inference.listModels()
      // ... rest same, but use ModelInfo fields
      res.json({ models })
    } catch (err) {
      res.status(502).json({ error: `Failed to fetch models: ${err instanceof Error ? err.message : 'Unknown error'}` })
    }
  })

  return router
}
```

- [ ] **Step 5: Run TypeScript check**

Run: `npx tsc --noEmit -p tsconfig.server.json`

Expected: Some errors from consumers still referencing `OllamaService`. These get fixed in Task 6.

- [ ] **Step 6: Commit**

```bash
git add server/storage/types.ts server/routes/settings.ts server/routes/models.ts
git commit -m "feat: add inference provider settings and test endpoints"
```

---

### Task 6: Migrate all consumers from OllamaService to InferenceProvider

**Files:**
- Modify: `server/index.ts`
- Modify: `server/routes/chat.ts`
- Modify: `server/routes/aura.ts`
- Modify: `server/routes/skills.ts`
- Modify: `server/routes/projects.ts`
- Modify: `server/services/aura/agent.ts`
- Modify: `server/services/aura/context-generator.ts`
- Modify: `server/services/aura/search/embedding.ts`
- Modify: `server/services/aura/indexer.ts`
- Modify: `server/services/aura/graph.ts`

This is a systematic find-and-replace task. Every reference to `OllamaService` as a type changes to `InferenceProvider`. Every reference to `ollama` as a variable name changes to `inference`. Every config type `{ ollama: OllamaService }` changes to `{ inference: InferenceProvider }`.

- [ ] **Step 1: Update `server/index.ts`**

Replace `OllamaService` import with `ProviderManager` import. Change `const ollama = new OllamaService(store)` to `const providerManager = new ProviderManager(store)`. Update the auto-detect block to use `providerManager`. Update all router calls to pass `providerManager` instead of `ollama`:

```typescript
import { ProviderManager } from './services/inference/index.ts'

// In start():
const providerManager = new ProviderManager(store)

// Auto-detect model:
let detectedModel = 'llama3.2'
try {
  const inference = await providerManager.getProvider()
  const availableModels = await inference.listModels()
  if (availableModels.length > 0) detectedModel = availableModels[0].name
} catch { /* provider not reachable yet */ }

// Router calls:
app.use('/api/chat', createChatRouter(providerManager, contextService, conversationService, memoryService, skillsService, projectService, store))
app.use('/api/models', createModelsRouter(providerManager, store))
app.use('/api/settings', createSettingsRouter(store, providerManager))
app.use('/api/aura', createAuraRouter(projectService, auraIndexers, auraQueries, groupService, DATA_DIR, store, managedShellService, providerManager))

// Health check:
app.get('/api/health', async (_req, res) => {
  const inference = await providerManager.getProvider()
  const healthy = await inference.isHealthy()
  res.json({ status: 'ok', ollama: healthy })
})
```

Note: The health endpoint still uses `ollama` as the JSON key for backward compatibility with the frontend.

- [ ] **Step 2: Update route files**

For each route file, change the parameter type from `OllamaService` to `InferenceProvider` (or `ProviderManager` where dynamic provider selection is needed), and rename the variable from `ollama` to `inference` (or `providerManager`).

**`server/routes/chat.ts`:** Change `ollama: OllamaService` to `providerManager: ProviderManager`. Inside the handler, get the provider: `const inference = await providerManager.getProvider()`. Use `inference.chatStream(...)`, `inference.chatSimple(...)`.

**`server/routes/aura.ts`:** Change `ollama: OllamaService` to `providerManager: ProviderManager`. In `getAuraConfig()`, use `providerManager.getProvider()` and pass `inference` instead of `ollama`.

**`server/routes/skills.ts`:** Change `ollama: OllamaService` to `inference: InferenceProvider`. Rename all `ollama.` calls to `inference.`.

**`server/routes/projects.ts`:** Change `ollama: OllamaService` to `inference: InferenceProvider`. Rename all `ollama.` calls to `inference.`.

- [ ] **Step 3: Update AURA subsystem files**

**`server/services/aura/agent.ts`:** Change `import type { OllamaService }` to `import type { InferenceProvider }`. Change `ollama: OllamaService` to `inference: InferenceProvider`. Rename `this.ollama` to `this.inference`. Rename the constructor parameter.

**`server/services/aura/context-generator.ts`:** Same pattern.

**`server/services/aura/search/embedding.ts`:** Same pattern.

**`server/services/aura/indexer.ts`:** Config type `{ ollama: OllamaService }` → `{ inference: InferenceProvider }`.

**`server/services/aura/graph.ts`:** Same config type change.

- [ ] **Step 4: Delete `server/services/ollama.ts`**

This file has been replaced by `server/services/inference/ollama-provider.ts`.

- [ ] **Step 5: Run TypeScript check**

Run: `npx tsc --noEmit -p tsconfig.server.json`

Expected: Zero new errors from our changes. Pre-existing errors (TS5097, parser errors, etc.) are acceptable.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: migrate all consumers from OllamaService to InferenceProvider"
```

---

### Task 7: Update frontend settings UI

**Files:**
- Modify: `src/components/settings/SettingsPanel.tsx` (or wherever settings UI lives)
- Modify: `src/hooks/useSettings.ts` (or wherever settings types are defined)

This task adds the "Inference Provider" dropdown and conditional fields to the settings panel.

- [ ] **Step 1: Find and update the settings UI component**

Search for the settings panel component that currently renders the Ollama URL and API key fields. Add:

1. A dropdown for "Inference Provider" with options: Ollama, OpenAI, OpenAI-Compatible
2. Conditional sections:
   - When "ollama" is selected: show existing Ollama Base URL field
   - When "openai" is selected: show OpenAI API Key field (with env var indicator)
   - When "openai-compatible" is selected: show Custom Base URL + API Key fields
3. A "Test Connection" button that calls the appropriate test endpoint based on the selected provider

The exact UI implementation depends on the existing settings component structure. Find it and add the new fields following the same patterns as the existing Ollama URL field.

- [ ] **Step 2: Update the settings hook/types**

Add the new fields to the frontend settings type definition:

```typescript
inferenceProvider: 'ollama' | 'openai' | 'openai-compatible'
openaiApiKey: string
customInferenceBaseUrl: string
customInferenceApiKey: string
hasEnvOpenaiKey?: boolean
hasEnvCustomKey?: boolean
```

- [ ] **Step 3: Update the models hook to refresh on provider change**

When the user changes the inference provider, the models dropdown should refresh by calling `/api/models` which now returns models from the active provider.

- [ ] **Step 4: Test the UI manually**

Start the dev server (`npm run dev`) and verify:
- Settings page shows the provider dropdown
- Switching providers shows/hides the relevant fields
- The "Test Connection" button works for each provider type
- Model list refreshes when provider changes

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add inference provider selector to settings UI"
```

---

### Task 8: Integration testing

**Files:**
- All modified files

- [ ] **Step 1: Start the dev server and verify it boots**

Run: `npm run dev`

Expected: Server starts on port 3001, Vite on port 5173. No startup errors.

- [ ] **Step 2: Verify Ollama provider still works**

With `inferenceProvider: 'ollama'` (default):
- `/api/health` returns `{ status: 'ok', ollama: true }`
- `/api/models` returns Ollama model list
- Chat works (send a message, get a streaming response)
- AURA indexing works (trigger indexing, verify embeddings generate)

- [ ] **Step 3: Verify OpenAI provider works**

Change settings to `inferenceProvider: 'openai'` with a valid OpenAI API key:
- `/api/models` returns OpenAI model list
- Chat works with an OpenAI model (e.g., `gpt-4o`)
- `chatSimple` works (title generation, compaction)

- [ ] **Step 4: Verify OpenAI-compatible provider works**

Change settings to `inferenceProvider: 'openai-compatible'` with a custom base URL (e.g., Groq):
- `/api/models` returns the compatible provider's model list
- Chat works with a compatible model

- [ ] **Step 5: Verify provider switching works at runtime**

Change the provider in settings without restarting the server:
- Verify that the next request uses the new provider
- Verify that the model list updates

- [ ] **Step 6: Run existing unit tests**

Run: `npm run test:unit`

Expected: All tests pass (or at minimum, no new test failures).

- [ ] **Step 7: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix: integration fixes from provider-agnostic testing"
```