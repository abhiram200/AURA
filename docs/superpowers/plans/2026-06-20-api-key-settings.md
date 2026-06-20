# API Key Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an Ollama API Key field to the General settings modal that saves to `settings.json`, masks the key on the wire, and falls back to `.env` when not set in settings.

**Architecture:** Extend the existing `Settings` type with `ollamaApiKey`, add masking/unmasking logic in the settings route, add a password-style input with eye toggle in the General modal, and wire the resolved key through to `WebSearchService` instances.

**Tech Stack:** TypeScript (Express server), React (client), existing patterns from `SettingsPanel.tsx` and `settings.ts` route.

## Global Constraints

- Key stored as plaintext in `settings.json` (same security posture as `.env`)
- Full key never sent to client — always masked (first 4 + "..." + last 4)
- If user submits masked value back, server keeps existing key unchanged
- Resolution priority: `settings.ollamaApiKey` → `process.env.OLLAMA_API_KEY` → `null`
- Follow existing code patterns (settings migration, modal sections, pill buttons, etc.)

---

### Task 1: Add `ollamaApiKey` to Settings type and server defaults

**Files:**
- Modify: `server/storage/types.ts`
- Modify: `server/routes/settings.ts`
- Modify: `server/index.ts`

**Interfaces:**
- Produces: `Settings.ollamaApiKey: string`, `DEFAULT_SETTINGS.ollamaApiKey: ""`, migration for missing field

- [ ] **Step 1: Add `ollamaApiKey` to the `Settings` interface in `server/storage/types.ts`**

Add `ollamaApiKey: string` after the `ollamaBaseUrl` field:

```ts
export interface Settings {
  defaultModel: string
  contextWindowSize: number
  autoExtractMemory: boolean
  preferences: UserPreferences
  preferencesSet: boolean
  activeSkillIds: string[]
  defaultProjectPath: string | null
  defaultProjectModel: string | null
  defaultEmbeddingModel: string | null
  ollamaBaseUrl: string   // empty = use http://localhost:11434
  ollamaApiKey: string    // empty = fall back to process.env.OLLAMA_API_KEY
  codeEditorTheme: string
  autoSave: boolean
}
```

- [ ] **Step 2: Add `ollamaApiKey: ""` to `DEFAULT_SETTINGS` in `server/routes/settings.ts`**

Add `ollamaApiKey: ''` after the `ollamaBaseUrl` line in the `DEFAULT_SETTINGS` object:

```ts
const DEFAULT_SETTINGS: Settings = {
  defaultModel: '',
  contextWindowSize: 131072,
  autoExtractMemory: true,
  preferences: {
    responseDetail: null, technicalLevel: null, responseFormat: null,
    domains: null, personality: null, proactiveness: null,
    languageStyle: null, useOfExamples: null,
  },
  preferencesSet: false,
  activeSkillIds: [],
  defaultProjectPath: null,
  defaultProjectModel: null,
  defaultEmbeddingModel: null,
  ollamaBaseUrl: '',
  ollamaApiKey: '',
  codeEditorTheme: 'catppuccin-mocha',
  autoSave: false,
}
```

- [ ] **Step 3: Add migration for missing `ollamaApiKey` in the GET handler in `server/routes/settings.ts`**

Add after the `ollamaBaseUrl` migration block (after line 68):

```ts
if (settings.ollamaApiKey === undefined) {
  settings.ollamaApiKey = ''
  await store.write('settings.json', settings)
}
```

- [ ] **Step 4: Add masking logic and masked-value preservation in `server/routes/settings.ts`**

Add two helper functions before `createSettingsRouter`:

```ts
function maskApiKey(key: string): string {
  if (!key || key.length < 8) return key ? '****' : ''
  return key.slice(0, 4) + '...' + key.slice(-4)
}

function isMasked(value: string): boolean {
  return value.includes('...')
}
```

In the GET handler, before `res.json(settings)`, mask the key:

```ts
// Mask API key before sending to client
const clientSettings = {
  ...settings,
  ollamaApiKey: maskApiKey(settings.ollamaApiKey || ''),
}
res.json(clientSettings)
```

In the PUT handler, before merging, preserve the existing key if the incoming value is masked:

```ts
// If the client sent a masked API key back, preserve the existing one
if (isMasked(updates.ollamaApiKey ?? '')) {
  delete updates.ollamaApiKey
}
```

- [ ] **Step 5: Add `ollamaApiKey: ''` to the default settings seed in `server/index.ts`**

In `server/index.ts`, add `ollamaApiKey: ''` to the `defaultSettings` object (after the `ollamaBaseUrl: '',` line, around line 70):

```ts
const defaultSettings = {
  defaultModel: detectedModel,
  contextWindowSize: 131072,
  autoExtractMemory: true,
  preferences: {
    responseDetail: null, technicalLevel: null, responseFormat: null,
    domains: null, personality: null, proactiveness: null,
    languageStyle: null, useOfExamples: null,
  },
  preferencesSet: false,
  activeSkillIds: [],
  defaultProjectPath: null,
  defaultProjectModel: null,
  defaultEmbeddingModel: null,
  ollamaBaseUrl: '',
  ollamaApiKey: '',
}
```

- [ ] **Step 6: Commit**

```bash
git add server/storage/types.ts server/routes/settings.ts server/index.ts
git commit -m "feat: add ollamaApiKey to Settings type, defaults, and migration"
```

---

### Task 2: Add `ollamaApiKey` to client-side settings type and hook

**Files:**
- Modify: `src/hooks/useSettings.ts`

**Interfaces:**
- Consumes: `Settings.ollamaApiKey` from Task 1
- Produces: `AppSettings.ollamaApiKey` on the client side

- [ ] **Step 1: Add `ollamaApiKey` to the `AppSettings` interface in `src/hooks/useSettings.ts`**

Add `ollamaApiKey: string` after the `ollamaBaseUrl` field:

```ts
export interface AppSettings {
  defaultModel: string
  contextWindowSize: number
  autoExtractMemory: boolean
  preferences: UserPreferences
  preferencesSet: boolean
  activeSkillIds: string[]
  defaultProjectPath: string | null
  defaultProjectModel: string | null
  defaultEmbeddingModel: string | null
  ollamaBaseUrl: string
  ollamaApiKey: string
  codeEditorTheme: string
  autoSave: boolean
}
```

- [ ] **Step 2: Add `ollamaApiKey: ''` to `DEFAULT_SETTINGS` in `src/hooks/useSettings.ts`**

Add after the `ollamaBaseUrl: '',` line:

```ts
const DEFAULT_SETTINGS: AppSettings = {
  defaultModel: '',
  contextWindowSize: 131072,
  autoExtractMemory: true,
  preferences: {
    responseDetail: null, technicalLevel: null, responseFormat: null,
    domains: null, personality: null, proactiveness: null,
    languageStyle: null, useOfExamples: null,
  },
  preferencesSet: false,
  activeSkillIds: [],
  defaultProjectPath: null,
  defaultProjectModel: null,
  defaultEmbeddingModel: null,
  ollamaBaseUrl: '',
  ollamaApiKey: '',
  codeEditorTheme: 'catppuccin-mocha',
  autoSave: false,
}
```

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useSettings.ts
git commit -m "feat: add ollamaApiKey to client-side AppSettings type and defaults"
```

---

### Task 3: Add API Key input to General settings modal UI

**Files:**
- Modify: `src/components/settings/SettingsPanel.tsx`

**Interfaces:**
- Consumes: `AppSettings.ollamaApiKey`, `onSettingsChange` from parent
- Produces: UI for viewing/editing the API key with mask toggle and test button

- [ ] **Step 1: Add state variables for the API key input, visibility toggle, and test result**

In `SettingsPanel`, after the existing `ollamaTestResult` state declarations (around line 92), add:

```tsx
const [apiKeyInput, setApiKeyInput] = useState(settings.ollamaApiKey ?? '')
const [apiKeyVisible, setApiKeyVisible] = useState(false)
const [apiKeyTestResult, setApiKeyTestResult] = useState<'idle' | 'testing' | 'success' | 'error'>('idle')
const [apiKeyTestError, setApiKeyTestError] = useState('')
```

- [ ] **Step 2: Add an effect to sync `apiKeyInput` when `settings.ollamaApiKey` changes**

After the `useEffect` that syncs `ollamaUrlInput` (around line 100), add:

```tsx
useEffect(() => {
  setApiKeyInput(settings.ollamaApiKey ?? '')
}, [settings.ollamaApiKey])
```

- [ ] **Step 3: Add the API Key section JSX in the General modal**

In the General modal (`activeModal === 'general'`), add the following block right after the Ollama Base URL section (after the `</div>` that closes the URL feedback span, before the Default Model section). This goes after line 268 and before line 269:

```tsx
<div className="settings-modal-section">
  <div className="settings-modal-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
    Ollama API Key
    <Tooltip content="API key for Ollama cloud web search (free tier: 100 searches/day). Get yours at ollama.com/settings/keys" position="top">
      <span className="help-icon">?</span>
    </Tooltip>
  </div>
  <div className="ollama-url-input-wrapper">
    <input
      className="folder-picker__input"
      type={apiKeyVisible ? 'text' : 'password'}
      value={apiKeyInput}
      onChange={(e) => {
        setApiKeyInput(e.target.value)
        setApiKeyTestResult('idle')
        setApiKeyTestError('')
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          onSettingsChange({ ollamaApiKey: apiKeyInput })
        }
      }}
      placeholder="Leave empty to use .env key"
    />
    <button
      className="ollama-url-test-btn"
      onClick={() => setApiKeyVisible(!apiKeyVisible)}
      title={apiKeyVisible ? 'Hide key' : 'Show key'}
      style={{ fontSize: '14px', minWidth: '32px' }}
    >
      {apiKeyVisible ? '🙈' : '👁️'}
    </button>
    <button
      className={`ollama-url-test-btn${apiKeyTestResult === 'testing' ? ' ollama-url-test-btn--testing' : ''}`}
      disabled={apiKeyTestResult === 'testing' || !apiKeyInput.trim()}
      onClick={async () => {
        const key = apiKeyInput.trim()
        if (!key) return
        setApiKeyTestResult('testing')
        setApiKeyTestError('')
        try {
          const res = await fetch('/api/settings/test-api-key', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ apiKey: key }),
          })
          if (!res.ok) throw new Error(`Server error: ${res.status}`)
          const data = await res.json()
          if (data.valid) {
            setApiKeyTestResult('success')
            setApiKeyTestError('')
            onSettingsChange({ ollamaApiKey: key })
          } else {
            setApiKeyTestResult('error')
            setApiKeyTestError(data.error || 'Invalid API key')
          }
        } catch (err) {
          setApiKeyTestResult('error')
          setApiKeyTestError(err instanceof Error ? err.message : 'Test failed')
        }
      }}
      title="Test key & save"
    >
      {apiKeyTestResult === 'testing' ? '' : '↗'}
    </button>
  </div>
  {!apiKeyInput.trim() && settings.ollamaApiKey ? (
    <span className="ollama-url-feedback" style={{ color: 'var(--accent-primary, #4ade80)' }}>
      ✓ Key configured (from .env)
    </span>
  ) : apiKeyInput.trim() ? (
    <span className="ollama-url-feedback" style={{ color: 'var(--accent-primary, #4ade80)' }}>
      ✓ Key configured
    </span>
  ) : (
    <span className="ollama-url-feedback" style={{ color: 'var(--text-muted, #888)' }}>
      ✗ No key set — web search will be limited
    </span>
  )}
  {apiKeyTestResult === 'success' && <span className="ollama-url-feedback ollama-url-feedback--success">Key valid</span>}
  {apiKeyTestResult === 'error' && <span className="ollama-url-feedback ollama-url-feedback--error">{apiKeyTestError || 'Invalid key'}</span>}
</div>
```

- [ ] **Step 4: Verify the UI renders**

Start the app with `npm run dev` and open Settings → General. Confirm:
1. The API Key field appears below Ollama Base URL
2. It shows as a password field (masked) by default
3. The eye toggle switches between visible/masked
4. The "✗ No key set" indicator shows when empty
5. The "✓ Key configured" indicator shows when a key is set

- [ ] **Step 5: Commit**

```bash
git add src/components/settings/SettingsPanel.tsx
git commit -m "feat: add API Key input to General settings modal with mask toggle and test button"
```

---

### Task 4: Add the test-api-key server endpoint

**Files:**
- Modify: `server/routes/settings.ts`

**Interfaces:**
- Consumes: `WebSearchService` for validating the key
- Produces: `POST /api/settings/test-api-key` endpoint

- [ ] **Step 1: Add the `/test-api-key` route in `server/routes/settings.ts`**

After the existing `/test-ollama` route (after line 127), add:

```ts
// Test Ollama API Key — validates key against Ollama cloud
router.post('/test-api-key', async (req, res) => {
  const { apiKey } = req.body as { apiKey?: string }
  if (!apiKey || !apiKey.trim()) {
    res.json({ valid: false, error: 'No API key provided' })
    return
  }
  try {
    const response = await fetch('https://ollama.com/api/web_search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey.trim()}`,
      },
      body: JSON.stringify({ query: 'test', max_results: 1 }),
      signal: AbortSignal.timeout(10000),
    })
    if (response.status === 401 || response.status === 403) {
      res.json({ valid: false, error: 'Invalid API key' })
    } else if (response.status === 429) {
      // Key is valid but rate-limited — still counts as valid
      res.json({ valid: true })
    } else if (response.ok) {
      res.json({ valid: true })
    } else {
      res.json({ valid: false, error: `Unexpected response: ${response.status} ${response.statusText}` })
    }
  } catch (err) {
    let message = 'Connection failed'
    if (err instanceof Error) {
      if (err.message.includes('abort') || err.message.includes('timeout')) message = 'Connection timed out'
      else message = err.message
    }
    res.json({ valid: false, error: message })
  }
})
```

- [ ] **Step 2: Verify the endpoint works**

Start the server and test with curl:

```bash
curl -X POST http://localhost:3001/api/settings/test-api-key -H "Content-Type: application/json" -d '{"apiKey":"invalid-key"}'
```

Expected: `{"valid":false,"error":"Invalid API key"}`

- [ ] **Step 3: Commit**

```bash
git add server/routes/settings.ts
git commit -m "feat: add POST /api/settings/test-api-key endpoint to validate Ollama API keys"
```

---

### Task 5: Wire the API key through to WebSearchService instances

**Files:**
- Modify: `server/services/aura/web-search.ts`
- Modify: `server/services/aura/agent.ts`
- Modify: `server/routes/aura.ts`

**Interfaces:**
- Consumes: `Settings.ollamaApiKey` from Task 1
- Produces: `WebSearchService` receives the resolved API key at construction time

- [ ] **Step 1: Add a static `resolveApiKey` helper to `WebSearchService` in `server/services/aura/web-search.ts`**

Add this static method after the `truncateContent` static method (near the end of the class):

```ts
/** Resolve the API key: settings first, then env, then null */
static resolveApiKey(settingsApiKey?: string): string | null {
  return settingsApiKey?.trim() || process.env.OLLAMA_API_KEY || null
}
```

- [ ] **Step 2: Update `WebSearchService` constructor to use `resolveApiKey` for the fallback**

The existing constructor already does `apiKey || process.env.OLLAMA_API_KEY || null`. Update it to use the static method:

```ts
constructor(apiKey?: string) {
  this.apiKey = WebSearchService.resolveApiKey(apiKey)
}
```

- [ ] **Step 3: Pass the resolved API key when creating `WebSearchService` in `server/index.ts`**

Update line 85 to read settings and pass the API key:

```ts
// Before:
const webSearch = new WebSearchService()
// After:
const initialSettings = await store.read<Settings>('settings.json')
const webSearch = new WebSearchService(initialSettings?.ollamaApiKey)
```

Note: `initialSettings` is already read on line 72 as `existingSettings`. We can reuse it or read again. Since we need it before the WebSearchService creation, read it:

```ts
const existingSettings = await store.read<Settings>('settings.json')
const webSearch = new WebSearchService(existingSettings?.ollamaApiKey)
```

But `existingSettings` is already defined on line 72. Just update line 85 to:

```ts
const webSearch = new WebSearchService(existingSettings?.ollamaApiKey)
```

- [ ] **Step 4: Update `WebSearchService` creation in `server/services/aura/agent.ts`**

The `AuraAgent` constructor at line 2001 creates its own `WebSearchService()` with no arguments. We need to pass the API key through. The constructor already receives `ollamaBaseUrl` as a parameter. We'll add an `apiKey` parameter.

Update the `AuraAgent` class. First, find the constructor (around line 1991):

```ts
// Before:
constructor(qs: AuraQueryService, projectPath: string, ollamaBaseUrl?: string, model?: string, contextWindow?: number, managedShells?: ManagedShellService, projectId?: string, chatService?: AuraChatService, chatId?: string) {

// After:
constructor(qs: AuraQueryService, projectPath: string, ollamaBaseUrl?: string, model?: string, contextWindow?: number, managedShells?: ManagedShellService, projectId?: string, chatService?: AuraChatService, chatId?: string, apiKey?: string) {
```

And on line 2001:

```ts
// Before:
this.webSearch = new WebSearchService()
// After:
this.webSearch = new WebSearchService(apiKey)
```

- [ ] **Step 5: Update where `AuraAgent` is instantiated in `server/routes/aura.ts` to pass the API key**

In `server/routes/aura.ts`, find where `new AuraAgent(...)` is called and add the resolved API key. Search for `new AuraAgent` and add the `apiKey` parameter from settings.

In the `getAuraConfig()` function (line 56-67), add `apiKey` to the returned object:

```ts
async function getAuraConfig() {
  const settings = await store.read<Settings>('settings.json')
  return {
    ollamaBaseUrl: (() => {
      const raw = (settings?.ollamaBaseUrl?.trim() || process.env.OLLAMA_BASE_URL || 'http://localhost:11434')
      return /^https?:\/\//i.test(raw) ? raw : `http://${raw}`
    })(),
    chatModel: settings?.defaultProjectModel || settings?.defaultModel || process.env.OLLAMA_MODEL || 'glm-5.1:cloud',
    embedModel: settings?.defaultEmbeddingModel || 'mxbai-embed-large:335m',
    contextWindow: settings?.contextWindowSize || 200_000,
    apiKey: settings?.ollamaApiKey || undefined,
  }
}
```

Then find each `new AuraAgent(...)` call and add the `apiKey` parameter at the end:

```ts
// The existing call looks something like:
new AuraAgent(qs, project.workspacePath, config.ollamaBaseUrl, config.chatModel, config.contextWindow, managedShellService, project.id, chatSession, chatId)
// Add apiKey as the last argument:
new AuraAgent(qs, project.workspacePath, config.ollamaBaseUrl, config.chatModel, config.contextWindow, managedShellService, project.id, chatSession, chatId, config.apiKey)
```

Find ALL `new AuraAgent(` calls in the file and add `config.apiKey` as the last argument to each.

- [ ] **Step 6: Commit**

```bash
git add server/services/aura/web-search.ts server/services/aura/agent.ts server/routes/aura.ts server/index.ts
git commit -m "feat: wire ollamaApiKey through WebSearchService and AuraAgent constructors"
```

---

### Task 6: End-to-end verification

**Files:** None (verification only)

- [ ] **Step 1: Start the app**

```bash
npm run dev
```

- [ ] **Step 2: Verify settings migration**

Open the browser dev tools Network tab. Navigate to Settings → General. The API Key field should appear. Check the GET `/api/settings` response — `ollamaApiKey` should be `""` (masked empty).

- [ ] **Step 3: Verify saving a key**

Type an API key into the input field. Click the test button (↗). Verify:
1. The request goes to `POST /api/settings/test-api-key`
2. If the key is valid, the status shows "Key valid"
3. The key is saved — reload the page and the masked version appears (e.g., `1774...8OU7`)

- [ ] **Step 4: Verify mask/unmask toggle**

Click the eye icon. The key should toggle between masked (••••) and visible. The type should switch between `password` and `text`.

- [ ] **Step 5: Verify fallback to .env**

Clear the API key in the UI (empty the field). The status should show "✗ No key set — web search will be limited" if `.env` also has no key, or if `.env` has a key it should still show "✓ Key configured (from .env)".

- [ ] **Step 6: Verify web search still works**

With a valid API key set in settings, trigger a web search from the AURA chat. Verify it uses the settings key. Then clear the key and verify it falls back to `.env`.

- [ ] **Step 7: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix: address issues found during end-to-end verification"
```