# Built-in Web Skills (fetch_url & search_web) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `fetch_url` and `search_web` as built-in skills in AURA so the AI model can fetch web pages and search the web during conversations.

**Architecture:** Both skills follow the existing built-in skill pattern — entries in `BUILTIN_SKILLS` array with `handler: { type: 'builtin' }` and execution logic in `executeBuiltin()`. `fetch_url` uses Node.js built-in `fetch()` directly. `search_web` calls an n8n webhook that performs DuckDuckGo search. An n8n workflow is created via the n8n REST API to handle the search backend.

**Tech Stack:** TypeScript, Express, Node.js built-in `fetch()`, n8n REST API, DuckDuckGo instant answer API

---

### Task 1: Add fetch_url and search_web skill definitions to BUILTIN_SKILLS

**Files:**
- Modify: `server/services/skills.ts:5-48` (BUILTIN_SKILLS array)

- [ ] **Step 1: Add two new skill entries to the BUILTIN_SKILLS array**

Add after the `get_weather` entry (line 47) in `server/services/skills.ts`:

```typescript
  {
    id: 'builtin_fetch_url',
    name: 'fetch_url',
    definition: {
      type: 'function',
      function: {
        name: 'fetch_url',
        description: 'Fetch the content of a web page by URL. Returns the text content of the page with HTML tags stripped. Use this when the user shares a URL and wants to know what\'s on that page, or when you need to look up specific information from a known URL.',
        parameters: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'The URL to fetch content from' },
          },
          required: ['url'],
        },
      },
    },
    handler: { type: 'builtin', action: 'fetch_url' },
    active: true,
    createdAt: new Date().toISOString(),
  },
  {
    id: 'builtin_search_web',
    name: 'search_web',
    definition: {
      type: 'function',
      function: {
        name: 'search_web',
        description: 'Search the web for information. Returns search results from DuckDuckGo including titles, URLs, and descriptions. Use this when you need to find current information, look up facts, or research topics that may not be in your training data.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'The search query to look up on the web' },
          },
          required: ['query'],
        },
      },
    },
    handler: { type: 'builtin', action: 'search_web' },
    active: true,
    createdAt: new Date().toISOString(),
  },
```

- [ ] **Step 2: Verify the file compiles**

Run: `cd C:/Users/abhir/Desktop/claude && npx tsc --noEmit --project tsconfig.server.json 2>&1 | head -20`

Expected: No errors related to skills.ts

- [ ] **Step 3: Commit**

```bash
git add server/services/skills.ts
git commit -m "feat: add fetch_url and search_web skill definitions"
```

---

### Task 2: Add n8n webhook URL to SkillsService constructor

**Files:**
- Modify: `server/services/skills.ts:50-55` (SkillsService class constructor)
- Modify: `server/index.ts:65-66` (SkillsService instantiation)

- [ ] **Step 1: Add webhookUrl parameter to SkillsService constructor**

In `server/services/skills.ts`, update the `SkillsService` class:

```typescript
export class SkillsService {
  private store: FileStore
  private webhookUrl: string

  constructor(store: FileStore, webhookUrl: string = '') {
    this.store = store
    this.webhookUrl = webhookUrl
  }
```

- [ ] **Step 2: Update SkillsService instantiation in index.ts**

In `server/index.ts`, change line 65 from:

```typescript
  const skillsService = new SkillsService(store)
```

to:

```typescript
  const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL ?? 'https://g15-1.tailbb1253.ts.net/webhook/search-web'
  const skillsService = new SkillsService(store, N8N_WEBHOOK_URL)
```

- [ ] **Step 3: Verify the file compiles**

Run: `cd C:/Users/abhir/Desktop/claude && npx tsc --noEmit --project tsconfig.server.json 2>&1 | head -20`

Expected: No errors related to skills.ts or index.ts

- [ ] **Step 4: Commit**

```bash
git add server/services/skills.ts server/index.ts
git commit -m "feat: add n8n webhook URL config to SkillsService"
```

---

### Task 3: Implement fetch_url handler in executeBuiltin

**Files:**
- Modify: `server/services/skills.ts:118-145` (executeBuiltin method)

- [ ] **Step 1: Add fetch_url handler to executeBuiltin method**

Add the following handler inside the `executeBuiltin` method, after the `weather` handler (after line 144):

```typescript
    if (action === 'fetch_url') {
      const url = String(args.url ?? '')
      if (!url) {
        throw new Error('URL is required for fetch_url')
      }

      // Validate URL format
      let parsedUrl: URL
      try {
        parsedUrl = new URL(url)
      } catch {
        throw new Error(`Invalid URL: ${url}`)
      }

      if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        throw new Error(`Unsupported protocol: ${parsedUrl.protocol}. Only http and https are allowed.`)
      }

      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 10000)

      try {
        const response = await fetch(url, {
          signal: controller.signal,
          headers: {
            'User-Agent': 'AURA/1.0 (AI Assistant)',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.7',
          },
        })

        if (!response.ok) {
          return `Error: HTTP ${response.status} ${response.statusText} for ${url}`
        }

        const contentType = response.headers.get('content-type') ?? ''
        if (!contentType.includes('text/') && !contentType.includes('json') && !contentType.includes('xml') && !contentType.includes('html')) {
          return `Error: Unsupported content type: ${contentType}. fetch_url only supports text-based content.`
        }

        const buffer = await response.arrayBuffer()
        if (buffer.byteLength > 500 * 1024) {
          const text = new TextDecoder().decode(buffer.slice(0, 500 * 1024))
          return htmlToText(text) + '\n\n[Content truncated: response exceeded 500KB]'
        }

        const text = new TextDecoder().decode(buffer)
        return htmlToText(text)
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          throw new Error(`Request timed out after 10 seconds: ${url}`)
        }
        throw new Error(`Failed to fetch ${url}: ${err instanceof Error ? err.message : String(err)}`)
      } finally {
        clearTimeout(timeout)
      }
    }
```

- [ ] **Step 2: Add htmlToText helper function**

Add this function at the top of `server/services/skills.ts`, before the `SkillsService` class (after the imports and before the `BUILTIN_SKILLS` array):

```typescript
function htmlToText(html: string): string {
  let text = html
  // Remove script and style blocks entirely
  text = text.replace(/<script[\s\S]*?<\/script>/gi, '')
  text = text.replace(/<style[\s\S]*?<\/style>/gi, '')
  // Remove HTML tags
  text = text.replace(/<[^>]+>/g, ' ')
  // Decode common HTML entities
  text = text.replace(/&amp;/g, '&')
  text = text.replace(/&lt;/g, '<')
  text = text.replace(/&gt;/g, '>')
  text = text.replace(/&quot;/g, '"')
  text = text.replace(/&#39;/g, "'")
  text = text.replace(/&nbsp;/g, ' ')
  text = text.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code)))
  // Collapse whitespace
  text = text.replace(/[ \t]+/g, ' ')
  text = text.replace(/\n{3,}/g, '\n\n')
  // Trim
  text = text.trim()
  // Truncate to 50KB max for context window
  const MAX_LENGTH = 50000
  if (text.length > MAX_LENGTH) {
    text = text.slice(0, MAX_LENGTH) + '\n\n[Content truncated to fit context window]'
  }
  return text
}
```

- [ ] **Step 3: Verify compilation**

Run: `cd C:/Users/abhir/Desktop/claude && npx tsc --noEmit --project tsconfig.server.json 2>&1 | head -20`

Expected: No errors related to skills.ts

- [ ] **Step 4: Commit**

```bash
git add server/services/skills.ts
git commit -m "feat: add fetch_url handler with HTML-to-text conversion"
```

---

### Task 4: Implement search_web handler in executeBuiltin

**Files:**
- Modify: `server/services/skills.ts` (executeBuiltin method, after fetch_url handler)

- [ ] **Step 1: Add search_web handler to executeBuiltin method**

Add the following handler inside the `executeBuiltin` method, after the `fetch_url` handler block:

```typescript
    if (action === 'search_web') {
      const query = String(args.query ?? '')
      if (!query) {
        throw new Error('Query is required for search_web')
      }

      if (!this.webhookUrl) {
        throw new Error('Search webhook URL is not configured. Set N8N_WEBHOOK_URL environment variable.')
      }

      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 15000)

      try {
        const response = await fetch(this.webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query }),
          signal: controller.signal,
        })

        if (!response.ok) {
          return `Error: Search service returned HTTP ${response.status} ${response.statusText}`
        }

        const data = await response.json()

        // Format the response for the AI model
        if (typeof data === 'string') {
          return data
        }

        // Handle structured response from n8n
        const results: string[] = []

        if (data.abstract) {
          results.push(`Summary: ${data.abstract}`)
          if (data.abstractSource) results.push(`Source: ${data.abstractSource}`)
          if (data.abstractURL) results.push(`URL: ${data.abstractURL}`)
        }

        if (data.results && Array.isArray(data.results)) {
          results.push('\nSearch Results:')
          for (const [i, r] of data.results.entries()) {
            results.push(`${i + 1}. ${r.title ?? 'Untitled'}\n   ${r.url ?? r.link ?? ''}\n   ${r.snippet ?? r.description ?? ''}`)
          }
        }

        if (data.relatedTopics && Array.isArray(data.relatedTopics)) {
          const topics = data.relatedTopics
            .filter((t: Record<string, unknown>) => t.text)
            .slice(0, 5)
            .map((t: Record<string, unknown>) => `- ${t.text}`)
          if (topics.length > 0) {
            results.push('\nRelated Topics:')
            results.push(...topics)
          }
        }

        if (results.length === 0) {
          return `No results found for "${query}". The search service may not have data for this query.`
        }

        return results.join('\n')
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          throw new Error(`Search request timed out after 15 seconds`)
        }
        throw new Error(`Search failed: ${err instanceof Error ? err.message : String(err)}`)
      } finally {
        clearTimeout(timeout)
      }
    }
```

- [ ] **Step 2: Verify compilation**

Run: `cd C:/Users/abhir/Desktop/claude && npx tsc --noEmit --project tsconfig.server.json 2>&1 | head -20`

Expected: No errors related to skills.ts

- [ ] **Step 3: Commit**

```bash
git add server/services/skills.ts
git commit -m "feat: add search_web handler with n8n webhook integration"
```

---

### Task 5: Update default active skill IDs and reset skills.json

**Files:**
- Modify: `server/index.ts:49-50` (default settings activeSkillIds)
- Modify: `server/services/skills.ts:58-60` (init method — delete stale skills.json so new builtins appear)

- [ ] **Step 1: Update default activeSkillIds in settings**

In `server/index.ts`, update the `defaultSettings` object's `activeSkillIds` to include the new built-in skills:

```typescript
    activeSkillIds: ['skill_builtin_calculator', 'skill_builtin_weather', 'skill_builtin_fetch_url', 'skill_builtin_search_web'],
```

Wait — looking at the `BUILTIN_SKILLS` array, the IDs use `builtin_` prefix (e.g., `builtin_calculator`), but the `activeSkillIds` uses `skill_builtin_` prefix. Let me check how skill IDs map to activeSkillIds.

Looking at the code, `activeSkillIds` in settings stores skill IDs with a `skill_` prefix that doesn't match the actual builtin IDs. The `getActiveDefinitions()` method in SkillsService filters by `s.active` directly — it doesn't use `activeSkillIds` from settings at all. And the settings `activeSkillIds` appears unused in the actual skill activation logic.

So the `activeSkillIds` in settings is decorative/legacy. The real activation comes from the `active: true` property on each `SkillEntry`. Since both new skills have `active: true`, they'll be active by default.

Skip this step — no change needed to `activeSkillIds`.

- [ ] **Step 2: Delete stale data/skills.json so new builtins appear**

The `init()` method only writes `skills.json` if it doesn't exist. Since the file already exists from previous runs, the new skills won't be added automatically. We need to update `init()` to merge in any missing builtin skills.

Update the `init()` method in `server/services/skills.ts`:

```typescript
  async init(): Promise<void> {
    const existing = await this.store.read<SkillEntry[]>('skills.json')
    if (!existing) {
      await this.store.write('skills.json', BUILTIN_SKILLS)
    } else {
      // Merge in any new builtin skills that don't exist yet
      const existingIds = new Set(existing.map((s) => s.id))
      const newBuiltins = BUILTIN_SKILLS.filter((b) => !existingIds.has(b.id))
      if (newBuiltins.length > 0) {
        await this.store.write('skills.json', [...existing, ...newBuiltins])
      }
    }
  }
```

- [ ] **Step 3: Verify compilation**

Run: `cd C:/Users/abhir/Desktop/claude && npx tsc --noEmit --project tsconfig.server.json 2>&1 | head -20`

Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add server/services/skills.ts
git commit -m "feat: merge new builtin skills on startup instead of only creating initial file"
```

---

### Task 6: Create n8n workflow for search_web

**Files:**
- No project files — this creates a workflow on the n8n instance via REST API

- [ ] **Step 1: Create the n8n workflow via API**

Use the n8n REST API to create a workflow with:
- A Webhook trigger node (POST, path: `search-web`)
- An HTTP Request node that calls DuckDuckGo instant answer API
- A response node that formats and returns the results

Run the following curl command to create the workflow:

```bash
curl -X POST 'https://g15-1.tailbb1253.ts.net/api/v1/workflows' \
  -H 'Content-Type: application/json' \
  -H 'X-N8N-API-KEY: <YOUR_N8N_API_KEY>' \
  -d '{
    "name": "AURA Web Search",
    "nodes": [
      {
        "parameters": {
          "httpMethod": "POST",
          "path": "search-web",
          "responseMode": "responseNode"
        },
        "name": "Webhook",
        "type": "n8n-nodes-base.webhook",
        "position": [250, 300]
      },
      {
        "parameters": {
          "url": "https://api.duckduckgo.com/?q={{encodeURIComponent($json.body.query)}}&format=json&no_html=1&skip_disambig=1",
          "options": {
            "response": {
              "response": {
                "neverError": true
              }
            }
          }
        },
        "name": "DuckDuckGo Search",
        "type": "n8n-nodes-base.httpRequest",
        "position": [470, 300]
      },
      {
        "parameters": {
          "respondWith": "json",
          "responseBody": "={{ JSON.stringify({ abstract: $json.Abstract, abstractSource: $json.AbstractSource, abstractURL: $json.AbstractURL, results: ($json.RelatedTopics || []).filter(t => t.FirstURL).slice(0, 8).map(t => ({ title: t.Text, url: t.FirstURL, snippet: t.Text })), relatedTopics: ($json.RelatedTopics || []).filter(t => !t.FirstURL && t.Text).slice(0, 5).map(t => ({ text: t.Text })) }) }}"
        },
        "name": "Respond to Webhook",
        "type": "n8n-nodes-base.respondToWebhook",
        "position": [690, 300]
      }
    ],
    "connections": {
      "Webhook": {
        "main": [
          [
            {
              "node": "DuckDuckGo Search",
              "type": "main",
              "index": 0
            }
          ]
        ]
      },
      "DuckDuckGo Search": {
        "main": [
          [
            {
              "node": "Respond to Webhook",
              "type": "main",
              "index": 0
            }
          ]
        ]
      }
    },
    "settings": {
      "executionOrder": "v1"
    }
  }'
```

- [ ] **Step 2: Activate the workflow**

After creating the workflow, note the workflow ID from the response. Then activate it:

```bash
curl -X PATCH 'https://g15-1.tailbb1253.ts.net/api/v1/workflows/{WORKFLOW_ID}/activate' \
  -H 'Content-Type: application/json' \
  -H 'X-N8N-API-KEY: <YOUR_N8N_API_KEY>'
```

- [ ] **Step 3: Test the webhook**

```bash
curl -X POST 'https://g15-1.tailbb1253.ts.net/webhook/search-web' \
  -H 'Content-Type: application/json' \
  -d '{"query": "TypeScript programming language"}'
```

Expected: JSON response with abstract and/or relatedTopics from DuckDuckGo.

- [ ] **Step 4: Commit** (documentation only — n8n workflow is external)

No project file changes for this step.

---

### Task 7: End-to-end test

**Files:**
- No new files — this is a manual test

- [ ] **Step 1: Start the dev server**

Run: `cd C:/Users/abhir/Desktop/claude && npm run dev`

- [ ] **Step 2: Verify skills appear in the UI**

Open the app, go to Settings > Skills, confirm that `fetch_url` and `search_web` appear as Built-in skills with Active status.

- [ ] **Step 3: Test fetch_url in chat**

Send a message like: "What's on https://example.com?"
Expected: The AI should call `fetch_url` with the URL, and return the page content in its response.

- [ ] **Step 4: Test search_web in chat**

Send a message like: "Search the web for the latest news about TypeScript"
Expected: The AI should call `search_web` with the query, and return search results in its response.

- [ ] **Step 5: Verify error handling**

If n8n is unreachable, `search_web` should return a graceful error message like "Search failed: ..." rather than crashing.

- [ ] **Step 6: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix: address end-to-end testing issues for web skills"
```

---

## Self-Review

**1. Spec coverage:**
- fetch_url skill definition ✓ (Task 1)
- fetch_url handler with timeout, size limit, HTML stripping ✓ (Task 3)
- search_web skill definition ✓ (Task 1)
- search_web handler with n8n webhook call ✓ (Task 4)
- n8n webhook URL config ✓ (Task 2)
- n8n workflow creation ✓ (Task 6)
- Merge new builtins on startup ✓ (Task 5)
- End-to-end testing ✓ (Task 7)

**2. Placeholder scan:**
- No TBD, TODO, or "implement later" found
- No "add appropriate error handling" — all error handling is explicit
- No "similar to Task N" — each task has complete code

**3. Type consistency:**
- `SkillsService` constructor takes `(store: FileStore, webhookUrl: string)` — matches usage in index.ts
- `BuiltinHandler` type has `{ type: 'builtin', action: string }` — both new skills use this
- `htmlToText` function is standalone, no type conflicts
- `executeBuiltin` receives `(action: string, args: Record<string, unknown>)` — both handlers use `args.url` and `args.query` respectively