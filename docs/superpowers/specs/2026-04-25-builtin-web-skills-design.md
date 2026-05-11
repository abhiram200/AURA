---
name: Built-in Web Skills (fetch_url & search_web)
description: Two new built-in skills for URL fetching and web search in AURA
type: project
---

# Built-in Web Skills Design Spec

## Overview

Add two new built-in skills to AURA that give the AI model the ability to fetch web page content and search the web for information. These follow the existing built-in skill pattern (like `calculator` and `get_weather`) and integrate seamlessly with the existing tool-calling infrastructure.

## Skills

### fetch_url

- **Handler type**: `builtin`, action: `fetch_url`
- **Parameters**: `url` (string, required) — the URL to fetch
- **Behavior**: Makes an HTTP GET request to the URL, extracts text content from the response (stripping HTML tags), truncates to fit context window, and returns the result string
- **Constraints**: 10-second timeout, 500KB response size limit, User-Agent header to identify AURA
- **Error handling**: Returns descriptive error strings for invalid URLs, timeouts, HTTP errors, and oversized responses
- **Implementation**: Direct server-side using Node.js built-in `fetch()`

### search_web

- **Handler type**: `builtin`, action: `search_web`
- **Parameters**: `query` (string, required) — the search query
- **Behavior**: Calls the n8n webhook which performs a DuckDuckGo search and returns formatted results
- **Constraints**: 15-second timeout for n8n response, graceful fallback error message if n8n is unreachable
- **Error handling**: Returns descriptive error strings for network failures, timeouts, and n8n errors
- **Implementation**: Calls n8n webhook at configured URL

## Architecture

### Backend changes

**`server/services/skills.ts`**
- Add `fetch_url` and `search_web` entries to `BUILTIN_SKILLS` array
- Add `fetch_url` handler in `executeBuiltin()` — uses Node.js `fetch()` with timeout and size limits
- Add `search_web` handler in `executeBuiltin()` — calls n8n webhook via HTTP POST
- HTML-to-text conversion: strip tags using regex, decode common HTML entities, trim whitespace

**`server/index.ts`**
- Pass `N8N_WEBHOOK_URL` env var (with default) to `SkillsService` constructor
- `SkillsService` stores the webhook URL for use in search handler

**`server/storage/types.ts`**
- No changes needed — `BuiltinHandler` already supports any action string

### n8n Workflow (search_web)

A single n8n workflow handles web search:

1. **Webhook trigger** — POST endpoint accepting `{ query: string }`
2. **HTTP Request** — Calls DuckDuckGo instant answer API (`https://api.duckduckgo.com/?q={query}&format=json`)
3. **Response formatting** — Extracts abstract text, related topics, and returns structured JSON

The workflow is created via n8n REST API using the provided API key.

### No frontend changes needed

- Built-in skills already appear in the Skills panel with `Built-in` badge
- Active/inactive toggles work automatically
- Tool call indicators in chat already handle any built-in skill
- The AI model sees tool definitions and decides when to call them

## File changes

| File | Change |
|------|--------|
| `server/services/skills.ts` | Add 2 BUILTIN_SKILLS entries, add `fetch_url` and `search_web` handlers to `executeBuiltin()`, add constructor param for webhook URL |
| `server/index.ts` | Pass n8n webhook URL to SkillsService |
| `server/storage/types.ts` | No change |
| `src/` | No change |

## Configuration

- `N8N_WEBHOOK_URL` environment variable — defaults to `https://g15-1.tailbb1253.ts.net/webhook/search-web`
- The n8n API key is used only for creating the workflow; it is not stored in AURA's code

## Testing

- `fetch_url`: Test with various URLs (valid, invalid, timeout, large response)
- `search_web`: Test with n8n reachable (returns results) and n8n unreachable (returns error message)
- Verify both skills appear in the Skills panel as `Built-in` type
- Verify the AI model calls the correct skill when asked about URLs or web searches