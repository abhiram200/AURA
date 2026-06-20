# API Key Settings UI — Design Spec

## Problem

The `OLLAMA_API_KEY` (used for web search/fetch via the Ollama cloud API) is currently stored only in `.env`. Users must edit this file manually and restart the server to change it. There is no UI for configuring the key.

## Solution

Add an API Key field to the **General** settings modal, persist it in `settings.json`, and fall back to `.env` if no key is set in settings.

## Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| UI location | General settings modal | API key is Ollama connection config, same category as Ollama Base URL |
| Storage | `settings.json` plaintext | Same security posture as `.env` today; avoids unnecessary crypto complexity |
| Wire format | Masked (first 4 + last 4 chars) | Never expose the full key to the client |
| Fallback | `settings.ollamaApiKey → process.env.OLLAMA_API_KEY → null` | Existing `.env` setups keep working without changes |
| Display | Password input with eye toggle | Standard pattern for sensitive values |

## Data Model

### Settings interface changes

**`server/storage/types.ts`** — `Settings` interface:
```ts
ollamaApiKey: string  // empty string = use .env fallback
```

**`src/hooks/useSettings.ts`** — `AppSettings` interface:
```ts
ollamaApiKey: string  // masked on wire, e.g. "1774...8OU7"
```

## Server Changes

### `server/storage/types.ts`
- Add `ollamaApiKey: string` to `Settings` interface

### `server/routes/settings.ts`
- Add `ollamaApiKey: ""` to default settings
- Add migration: if `ollamaApiKey` missing in existing settings, set to `""`
- `GET /api/settings`: return masked `ollamaApiKey` (first 4 + "..." + last 4 chars, or `""` if empty)
- `PUT /api/settings`: if incoming `ollamaApiKey` is a masked value (contains `...`), keep the existing key unchanged; otherwise save the new value as-is

### `server/services/aura/web-search.ts`
- Update `WebSearchService` constructor to accept `apiKey` parameter with fallback to `process.env.OLLAMA_API_KEY`

### `server/index.ts`
- Pass `settings.ollamaApiKey` to `WebSearchService` when instantiating it

### `server/routes/aura.ts`
- Update `WebSearchService` instantiation to pass `settings.ollamaApiKey`

## Client Changes

### `src/hooks/useSettings.ts`
- Add `ollamaApiKey: ""` to `defaultSettings` and `AppSettings` interface

### `src/components/settings/SettingsPanel.tsx`
- In the General modal, add an API Key section below Ollama Base URL:
  - Password-type input (masked by default)
  - Eye icon button to toggle visibility
  - Status indicator: "✓ Key configured" (green) or "✗ No key set" (gray)
  - "Test Key" button that calls a server endpoint to verify the key works

### New endpoint: `POST /api/settings/test-api-key`
- Accepts `{ apiKey: string }` in request body
- Makes a test call to `https://ollama.com/api/web_search` with the key
- Returns `{ valid: true }` or `{ valid: false, error: string }`

## API Key Masking Logic

```ts
function maskApiKey(key: string): string {
  if (!key || key.length < 8) return key ? '****' : ''
  return key.slice(0, 4) + '...' + key.slice(-4)
}

function isMasked(value: string): boolean {
  return value.includes('...')
}
```

## Resolution Priority

When the server needs the API key for a web search request:

1. `settings.ollamaApiKey` (from `settings.json`)
2. `process.env.OLLAMA_API_KEY` (from `.env`)
3. `null` (no key available — web search will fail with an appropriate error)