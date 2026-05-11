import { Router } from 'express'
import type { FileStore } from '../storage/fileStore.ts'
import type { Settings, UserPreferences } from '../storage/types.ts'

const DEFAULT_SETTINGS: Settings = {
  defaultModel: '',
  contextWindowSize: 8192,
  autoExtractMemory: true,
  preferences: {
    responseDetail: null,
    technicalLevel: null,
    responseFormat: null,
    domains: null,
    personality: null,
    proactiveness: null,
    languageStyle: null,
    useOfExamples: null,
  },
  preferencesSet: false,
  activeSkillIds: [],
  defaultProjectPath: null,
  defaultProjectModel: null,
  defaultEmbeddingModel: null,
  ollamaBaseUrl: '',
  codeEditorTheme: 'catppuccin-mocha',
  autoSave: false,
}

export function createSettingsRouter(store: FileStore) {
  const router = Router()

  router.get('/', async (_req, res) => {
    let settings = await store.read<Settings>('settings.json')
    if (!settings) {
      settings = { ...DEFAULT_SETTINGS }
      await store.write('settings.json', settings)
    }
    // Migrate: old contextWindowSize was message count (max ~30), new is token count (min 4096)
    if (settings.contextWindowSize < 1024) {
      settings.contextWindowSize = DEFAULT_SETTINGS.contextWindowSize
      await store.write('settings.json', settings)
    }
    // Migrate: add defaultProjectPath if missing from older settings
    if (settings.defaultProjectPath === undefined) {
      settings.defaultProjectPath = null
      await store.write('settings.json', settings)
    }
    if (settings.defaultProjectModel === undefined) {
      settings.defaultProjectModel = null
      await store.write('settings.json', settings)
    }
    if (settings.codeEditorTheme === undefined) {
      settings.codeEditorTheme = DEFAULT_SETTINGS.codeEditorTheme
      await store.write('settings.json', settings)
    }
    if (settings.autoSave === undefined) {
      settings.autoSave = false
      await store.write('settings.json', settings)
    }
    if (settings.defaultEmbeddingModel === undefined) {
      settings.defaultEmbeddingModel = null
      await store.write('settings.json', settings)
    }
    if (settings.ollamaBaseUrl === undefined) {
      settings.ollamaBaseUrl = ''
      await store.write('settings.json', settings)
    }
    res.json(settings)
  })

  router.put('/', async (req, res) => {
    const updates = req.body as Partial<Settings>
    // Normalize bare host:port → http://host:port
    if (updates.ollamaBaseUrl && !/^https?:\/\//i.test(updates.ollamaBaseUrl)) {
      updates.ollamaBaseUrl = `http://${updates.ollamaBaseUrl}`
    }
    let current = await store.read<Settings>('settings.json')
    if (!current) {
      current = { ...DEFAULT_SETTINGS }
    }
    const merged = { ...current, ...updates }
    if (updates.preferences) {
      merged.preferences = { ...current.preferences, ...updates.preferences }
      if (Object.values(updates.preferences as UserPreferences).some((v) => v !== null)) {
        merged.preferencesSet = true
      }
    }
    await store.write('settings.json', merged)
    res.json(merged)
  })

  // Test Ollama connectivity — proxies the request to avoid CORS issues
  router.post('/test-ollama', async (req, res) => {
    const { url } = req.body as { url?: string }
    const testUrl = url?.trim() || 'http://localhost:11434'
    // Normalize bare host:port → http://host:port
    const normalized = /^https?:\/\//i.test(testUrl) ? testUrl : `http://${testUrl}`
    try {
      const resp = await fetch(`${normalized}/api/tags`, { signal: AbortSignal.timeout(5000) })
      if (resp.ok) {
        const data = await resp.json()
        const modelCount = data?.models?.length ?? 0
        res.json({ ok: true, modelCount, url: normalized })
      } else {
        res.json({ ok: false, error: `HTTP ${resp.status} ${resp.statusText}`, url: normalized })
      }
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
      res.json({ ok: false, error: message, url: normalized })
    }
  })

  return router
}