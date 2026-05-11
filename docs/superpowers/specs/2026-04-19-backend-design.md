# A.U.R.A. Backend Design

## Overview

Add an Express backend to A.U.R.A. that connects to Ollama (localhost:11434) as the inference engine. The backend handles streaming AI responses, conversation persistence, a layered context system (system prompt + user preferences + persistent memory + summary + rolling window), model management, and auto-extraction of memory facts.

## Architecture

**Express server** on port 3001 (configurable). REST API + SSE streaming. JSON file storage in `data/` directory.

### Tech Stack

- **Runtime:** Node.js
- **Framework:** Express
- **Streaming:** Server-Sent Events (SSE) for AI responses
- **Storage:** JSON files on disk (`data/` directory)
- **AI Engine:** Ollama REST API at `localhost:11434`
- **Testing:** Playwright (E2E), Vitest (unit)

### Directory Structure

```
server/
├── index.ts                 # Express app entry, middleware, routes
├── routes/
│   ├── chat.ts              # POST /api/chat (SSE stream)
│   ├── models.ts            # GET /api/models
│   ├── conversations.ts     # CRUD /api/conversations
│   ├── memory.ts            # CRUD /api/memory
│   ├── skills.ts            # CRUD /api/skills + tool execution routing
│   └── settings.ts          # GET/PUT /api/settings
├── services/
│   ├── ollama.ts            # Ollama API client
│   ├── context.ts           # Context assembly (6-layer pipeline)
│   ├── memory.ts            # Memory extraction + CRUD
│   ├── skills.ts            # Skill execution handlers (builtin, api, prompt)
│   └── conversation.ts      # Conversation CRUD + summarization
├── storage/
│   ├── fileStore.ts         # JSON file read/write utility
│   └── types.ts             # Shared type definitions
└── systemPrompt.ts          # Code-level system prompt
data/
├── conversations/
│   └── {id}.json            # One file per conversation
├── memory.json              # Array of memory entries
├── skills.json              # Array of skill entries
└── settings.json            # App settings + user preferences
```

## API Endpoints

### `POST /api/chat` — Stream AI Response

Request body:
```json
{
  "conversationId": "string",
  "message": "string"
}
```

Response: SSE stream. Each event is a token chunk. Final event includes the full response and any extracted memory facts.

Flow:
1. Load conversation history from storage
2. ContextService assembles the 6-layer context
3. Load active skills, pass their definitions in Ollama's `tools` array
4. Proxy to Ollama's `/api/chat` endpoint (streaming)
5. If Ollama responds with `tool_calls`, route each to its handler, execute, return result to Ollama, get final response
6. Stream tokens back via SSE (including tool call events if any)
7. After response completes, MemoryService extracts facts from the exchange
8. Send extracted facts as a final SSE event for frontend to display

### `GET /api/models` — List Available Models

Returns models from `GET http://localhost:11434/api/tags`. Response:
```json
{
  "models": [
    { "name": "llama3.2", "size": 4050000000, "modified_at": "..." },
    { "name": "codellama", "size": 3800000000, "modified_at": "..." }
  ]
}
```

### `GET /api/conversations` — List Conversations

Returns summary list (id, title, lastMessageAt, model).

### `GET /api/conversations/:id` — Get Full Conversation

Returns all messages, system prompt, settings for a conversation.

### `POST /api/conversations` — Create Conversation

Body: `{ "model": "llama3.2" }`. Creates a new conversation file. Title is auto-generated from the first user message (first 50 chars) if not provided.

### `DELETE /api/conversations/:id` — Delete Conversation

Removes conversation file.

### `GET /api/memory` — List Memory Entries

Returns all memory entries with id, fact, source, createdAt, active status.

### `POST /api/memory` — Add Memory Entry

Body: `{ "fact": "string" }`. Manually add a memory.

### `PUT /api/memory/:id` — Update Memory Entry

Body: `{ "fact": "string", "active": true }`. Edit or toggle a memory.

### `DELETE /api/memory/:id` — Delete Memory Entry

### `GET /api/settings` — Get Settings

Returns settings.json including user preferences.

### `PUT /api/settings` — Update Settings

Body: partial settings object. Merges with existing settings. Includes preferences — pass `{ "preferences": { ... } }` to update user preferences (same as onboarding).

## Context Assembly (6-Layer Pipeline)

On each chat request, ContextService assembles these layers in order:

### Layer 1: System Prompt (code-level)

Hardcoded in `server/systemPrompt.ts`. Defines AURA's identity, capabilities, and response formatting rules. Never user-editable. Always present.

Example:
```
You are A.U.R.A. (Artificial Unified Responsive Assistant), an AI assistant.
Provide clear, accurate responses. Format code with proper syntax.
Use markdown for structure. Acknowledge uncertainty.
```

### Layer 2: User Preferences (behavior block)

Generated from the 8 onboarding questions. Injected as a structured block between system prompt and memory. Skipped entirely if user has not set preferences.

8 preference questions:
1. **Response detail** — Brief & concise | Balanced | Thorough & detailed
2. **Technical level** — Beginner | Intermediate | Advanced | Expert
3. **Response format** — Code-first | Explanation-first | Balanced
4. **Domains** — Free text (e.g., "web dev, data science")
5. **Personality** — Friendly & casual | Professional & formal | Witty & playful | Direct & no-nonsense | Adaptable (matches your tone)
6. **Proactiveness** — Answer only what's asked | Suggest alternatives & improvements | Actively offer ideas & next steps
7. **Language style** — Simple & jargon-free | Technical with explanations | Technical, skip explanations
8. **Use of examples** — Prefer analogies & metaphors | Prefer code examples | Prefer step-by-step walkthroughs | Minimal examples

Rendered as:
```
[User Preferences]
Detail level: thorough
Technical level: advanced
Response format: code-first
Domains: web development, React
Personality: friendly & casual
Proactiveness: suggest alternatives
Language: technical with explanations
Examples: prefer code examples
```

### Layer 3: Persistent Memory

All active memory entries formatted as a context block. Each entry has: id, fact, source (conversation id), createdAt, active flag.

Rendered as:
```
[Remembered Facts]
- User's name is Abhiram
- User prefers dark theme interfaces
- User is working on a React project called AURA
```

Memory is auto-extracted after each AI response (see Memory Extraction below) and also manually manageable in Settings.

### Layer 4: Conversation Summary

Messages older than the rolling window are summarized. On first overflow beyond the window, a summarization request is sent to Ollama asking it to compress the older messages into a concise summary. This summary is cached and updated incrementally as more messages age out.

Rendered as:
```
[Earlier Conversation Summary]
User asked about setting up Express with SSE. Assistant explained the architecture and provided code examples for streaming endpoints.
```

### Layer 5: Rolling Window

Last N messages in full (raw user and assistant messages). N is configurable in settings, default 10.

### Layer 6: New User Message

The current message being sent.

## Skills (Custom Tool Calling)

Users can add custom skills that the AI can invoke via Ollama's tool calling API. Skills are defined as structured JSON tool schemas, pasted into the UI. Each skill describes a tool the model can call during conversation — the model decides when to call it, and the backend executes it.

### Skill Definition Format

Each skill is a JSON object following the OpenAI/Ollama tool schema:

```json
{
  "type": "function",
  "function": {
    "name": "get_weather",
    "description": "Get the current weather for a given city",
    "parameters": {
      "type": "object",
      "properties": {
        "city": {
          "type": "string",
          "description": "The city name, e.g. 'London'"
        },
        "unit": {
          "type": "string",
          "enum": ["celsius", "fahrenheit"],
          "description": "Temperature unit"
        }
      },
      "required": ["city"]
    }
  }
}
```

### Skill Storage

Skills are stored in `data/skills.json`. Each entry includes:

```json
{
  "id": "skill_1706000000",
  "name": "get_weather",
  "definition": { ... },
  "handler": {
    "type": "builtin",
    "action": "weather"
  },
  "active": true,
  "createdAt": "2026-04-19T12:00:00Z"
}
```

**Handler types:**
- `"builtin"` — the backend has a hardcoded handler for this skill (see Built-in Skills below)
- `"api"` — calls an external REST endpoint defined by the user
- `"prompt"` — no execution; the skill definition is injected into context as a hint for the model (the model describes what it *would* do, but no real tool call is executed)

### Built-in Skills

The backend provides handlers for common skills that ship with AURA:

| Skill Name | Handler | Description |
|---|---|---|
| `get_weather` | builtin | Returns simulated/weather data |
| `calculator` | builtin | Evaluates math expressions |
| `web_search` | builtin | Performs a web search (if API key configured) |

Built-in skills are pre-loaded but can be disabled by the user. Custom skills added by the user use the `"api"` or `"prompt"` handler type.

### API Handler (Custom Skills)

For `"api"` handler type, the user also provides an execution config:

```json
{
  "id": "skill_1706000001",
  "name": "lookup_stock",
  "definition": { ... },
  "handler": {
    "type": "api",
    "url": "https://api.example.com/stock",
    "method": "GET",
    "headers": { "Authorization": "Bearer {{API_KEY}}" }
  },
  "active": true,
  "createdAt": "2026-04-19T12:00:00Z"
}
```

When the model calls a tool with an `"api"` handler, the backend substitutes the tool call arguments into the URL (as query params for GET, body for POST) and forwards the request. The API response is returned to the model as the tool result.

### Tool Calling Flow

1. Active skills' `definition` objects are sent to Ollama in the `tools` array on each chat request
2. Ollama may respond with a `tool_calls` array instead of (or in addition to) text content
3. The backend routes each tool call to the appropriate handler:
   - **builtin** → execute the built-in handler function
   - **api** → forward the request to the configured URL
   - **prompt** → return a placeholder response telling the model to describe what it would do
4. The tool result is appended to the messages and sent back to Ollama for a final response
5. The SSE stream includes tool call events so the frontend can show "Calling: get_weather..." in the chat

### Frontend: Skills UI

The **Skills** section in Settings allows users to:

1. **View all skills** — list showing name, handler type, and active/inactive toggle
2. **Add a skill** — opens a modal with:
   - A textarea to paste the JSON skill definition
   - Handler type selector (builtin / api / prompt)
   - For API type: URL, method, and headers fields
   - An example shown directly in the UI (see below)
3. **Edit a skill** — modify the definition or handler config
4. **Delete a skill** — remove entirely
5. **Toggle active** — enable/disable a skill without deleting it

**Example shown in the "Add Skill" UI:**

```
Paste your skill definition below. It should be a JSON object following
the OpenAI tool schema format. Example:

{
  "type": "function",
  "function": {
    "name": "calculate",
    "description": "Evaluate a mathematical expression",
    "parameters": {
      "type": "object",
      "properties": {
        "expression": {
          "type": "string",
          "description": "The math expression to evaluate, e.g. '2 + 2 * 3'"
        }
      },
      "required": ["expression"]
    }
  }
}

The "name" field is used to identify the skill. The "description" helps
the model decide when to use it. The "parameters" define what inputs
the model should provide.
```

### Skills in Context

Active skills are NOT injected into the context text. Instead, they are passed to Ollama's `/api/chat` endpoint in the `tools` array parameter. Ollama natively supports tool calling — the model sees available tools and decides autonomously when to invoke them.

## API Endpoints (Skills)

### `GET /api/skills` — List Skills

Returns all skills with id, name, definition, handler config, active status.

### `POST /api/skills` — Add Skill

Body:
```json
{
  "definition": { "type": "function", "function": { ... } },
  "handler": { "type": "api", "url": "...", "method": "GET" }
}
```

### `PUT /api/sills/:id` — Update Skill

Body: `{ "definition": { ... }, "handler": { ... }, "active": true }`.

### `DELETE /api/skills/:id` — Delete Skill

## Memory Extraction

After each AI response completes, the backend sends a lightweight follow-up request to Ollama:

```
Given this conversation exchange, extract any facts worth remembering about the user, their preferences, projects, or context. Return as a JSON array of strings. If nothing worth remembering, return empty array.

Exchange:
User: {user message}
Assistant: {ai response}
```

Extracted facts are stored in `data/memory.json` with metadata. The frontend receives extracted facts in the final SSE event and can show a subtle notification ("New memory saved"). Users can review, edit, toggle, or delete any memory entry in Settings.

**Parsing fallback:** Ollama models may not always return valid JSON. The extraction handler wraps the parsing in a try/catch — if JSON parsing fails, it attempts to extract an array from the raw text using regex (`/\[.*\]/s`). If extraction still fails, the response is logged and skipped (no memory saved). This prevents a malformed Ollama response from breaking the chat flow.

## Settings Structure

```json
{
  "defaultModel": "llama3.2",
  "contextWindowSize": 10,
  "autoExtractMemory": true,
  "preferences": {
    "responseDetail": null,
    "technicalLevel": null,
    "responseFormat": null,
    "domains": null,
    "personality": null,
    "proactiveness": null,
    "languageStyle": null,
    "useOfExamples": null
  },
  "preferencesSet": false,
  "activeSkillIds": ["skill_builtin_weather", "skill_builtin_calculator"]
}
```

Skills are stored separately in `data/skills.json`. Settings only tracks which skill IDs are active (toggled on).

All preference values default to `null` (unset). `preferencesSet` tracks whether onboarding has been completed. When all preferences are null, Layer 2 is skipped entirely.

## Frontend Changes

### New/Modified Hooks

- **useChat** — rewritten to call backend REST API; uses EventSource for SSE streaming instead of mock setInterval; handles tool call events
- **useSettings** — new hook; fetches and updates settings via `/api/settings`; manages model list, context window size, and preferences
- **useMemory** — new hook; CRUD operations for memory entries via `/api/memory`
- **useSkills** — new hook; CRUD operations for skills via `/api/skills`; manages active/inactive state

### Modified Components

- **SettingsPanel** — expanded with 5 sections:
  - **Model Selection** — dropdown of available Ollama models, default model selector
  - **Context Settings** — rolling window size slider, auto-extract memory toggle
  - **Memory Management** — list of memory entries with edit/delete/toggle, add manual entry
  - **User Preferences** — 8 preference selectors (same as onboarding), with a "Reset to defaults" option
  - **Skills** — list of all skills (builtin + custom) with active/inactive toggle; "Add Skill" button opens a modal with JSON textarea and inline example
- **Sidebar** — conversations loaded from backend instead of mock data
- **ChatInput** — shows current model name; model switcher accessible from chat header
- **ChatLayout** — shows onboarding modal on first launch if preferences not set; switching models mid-conversation updates the conversation's model for future messages

### New Components

- **OnboardingModal** — step-by-step questionnaire for 8 preferences. Appears on first launch or when user clicks "Set preferences" in Settings. Has "Skip" option on each question and a "Skip all" button.
- **AddSkillModal** — modal with a JSON textarea to paste skill definition, handler type selector (builtin/api/prompt), and API config fields if applicable. Shows an inline example of the expected JSON format directly above the textarea.
- **ToolCallIndicator** — inline message shown in chat when the model invokes a skill (e.g., "Using: get_weather..."), followed by the tool result and final response.
- **MemoryNotification** — subtle toast when a new memory fact is auto-extracted
- **ModelSelector** — compact dropdown in chat header to switch models mid-conversation

### API Integration

- Vite proxy config: `server.proxy` set to forward `/api` requests to Express backend during development
- Production: Express serves both the built frontend and the API

## Development Setup

The project will use `concurrently` to run both Vite dev server and Express backend:

```json
{
  "scripts": {
    "dev": "concurrently \"vite\" \"tsx watch server/index.ts\"",
    "dev:client": "vite",
    "dev:server": "tsx watch server/index.ts",
    "build": "npm run build:client && npm run build:server",
    "build:client": "vite build",
    "build:server": "tsc -p tsconfig.server.json",
    "start": "node dist/server/index.js",
    "test": "playwright test",
    "test:unit": "vitest run"
  }
}
```

New dev dependencies: `express`, `tsx`, `concurrently`, `@types/express`, `vitest`.

## Testing

### Playwright E2E Tests

Existing UI tests continue to work. New tests added:

- **Model switching** — verify model selector dropdown, default model persists
- **Chat with backend** — send a message, verify streaming response appears
- **Conversation persistence** — create conversation, reload page, verify it persists
- **Settings persistence** — change context window size, reload, verify it persists
- **Memory management** — view memories in settings, toggle/delete entries
- **Onboarding flow** — first launch shows questionnaire, skip option works
- **Skills management** — add a custom skill via JSON paste, toggle active/inactive, delete a skill
- **Tool calling** — verify tool call indicator appears in chat when model uses a skill

### Vitest Unit Tests (Server)

- **ContextService** — test 6-layer assembly with mock data
- **MemoryService** — test extraction, CRUD operations
- **ConversationService** — test CRUD, summarization trigger
- **OllamaService** — test API client with mocked fetch
- **SkillsService** — test builtin handlers, API handler proxy, prompt handler, tool call routing

### Test Considerations

- Ollama must be running for E2E chat tests; use a health check in test setup
- Unit tests mock Ollama responses entirely
- Playwright config updated to wait for both Vite and Express to be ready