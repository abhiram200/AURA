# Task 4 Report: Migrate AuraAgent

## Status: Complete

## Changes Made

### `server/services/aura/agent.ts`

1. **Added imports**: `import type { OllamaService } from '../ollama.ts'` and `import type { OllamaChatRequest } from '../../storage/types.ts'`

2. **Class field**: Replaced `private ollamaBaseUrl: string` with `private ollama: OllamaService`

3. **Constructor**: Changed parameter from `ollamaBaseUrl?: string` to `ollama: OllamaService`. Removed `this.ollamaBaseUrl = ollamaBaseUrl || process.env.OLLAMA_BASE_URL || 'http://localhost:11434'`. Added `this.ollama = ollama`. Removed `process.env.OLLAMA_MODEL` fallback from model (OllamaService.resolveModel handles this).

4. **`checkAvailability()`**: Replaced the full method body (caching + fetch) with a single delegation: `return this.ollama.checkAvailability(this.model)`. Removed the `availabilityCache` field since OllamaService has its own cache.

5. **`generateCompactionSummary()`**: Changed parameter from `ollamaBaseUrl: string` to `ollama: OllamaService`. Replaced raw `fetch()` call with `ollama.chatSimple()`.

6. **`compactMessagesAsync()`**: Changed parameter from `ollamaBaseUrl: string` to `ollama: OllamaService`. Updated the internal call to `generateCompactionSummary` to pass `ollama` instead of `ollamaBaseUrl`.

7. **`streamChat()`**: Replaced raw `fetch()` call and response-ok checking with `this.ollama.chatStream()` wrapped in try/catch. The try/catch handles retries (exponential backoff) that previously were done by checking `response.ok`. Removed the 429-specific short-circuit since `chatStream` throws on all non-ok responses. The SSE parsing loop (`reader.read()`, `JSON.parse`, etc.) is unchanged.

8. **`estimateSystemTokens()`**: Removed unused `ollamaBaseUrl` and `model` parameters (method only calls `buildSystemPrompt` and `estimateTokens`).

9. **Updated internal call**: `compactMessagesAsync` call in `streamChat` now passes `this.ollama` instead of `this.ollamaBaseUrl`.

## Type Check Results

- `agent.ts` itself has **no new type errors** from these changes.
- `routes/aura.ts` has 2 expected errors (Task 6): line 989 (string vs OllamaService) and line 1122 (4 args vs 2 for estimateSystemTokens).
- Root `npx tsc --noEmit` passes with exit code 0 (project references mode).