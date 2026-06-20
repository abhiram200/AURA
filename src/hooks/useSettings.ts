import { useState, useEffect, useCallback } from 'react'

export interface UserPreferences {
  responseDetail: string | null
  technicalLevel: string | null
  responseFormat: string | null
  domains: string | null
  personality: string | null
  proactiveness: string | null
  languageStyle: string | null
  useOfExamples: string | null
}

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

export interface OllamaModel {
  name: string
  size: number
  modified_at: string
  isEmbedding?: boolean
}

export function useSettings() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS)
  const [models, setModels] = useState<OllamaModel[]>([])
  const [loading, setLoading] = useState(true)

  const updateSettings = useCallback(async (updates: Partial<AppSettings>) => {
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      })
      if (res.ok) {
        const data = await res.json()
        setSettings(data)
      }
    } catch {
      // Update failed
    }
  }, [])

  const updatePreferences = useCallback(async (preferences: Partial<UserPreferences>) => {
    await updateSettings({ preferences: preferences as UserPreferences })
  }, [updateSettings])

  const fetchSettings = useCallback(async () => {
    try {
      const res = await fetch('/api/settings')
      if (res.ok) {
        const data = await res.json()
        setSettings(data)
      }
    } catch {
      // Use defaults
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchModels = useCallback(async () => {
    try {
      const res = await fetch('/api/models')
      if (res.ok) {
        const data = await res.json()
        setModels(data.models)
      }
    } catch {
      // Models unavailable
    }
  }, [])

  useEffect(() => {
    fetchSettings()
    fetchModels()
  }, [fetchSettings, fetchModels])

  // Auto-fix model selections when models list changes (e.g. after URL change)
  useEffect(() => {
    if (models.length === 0) return
    const updates: Partial<AppSettings> = {}
    // Default model — pick first chat model if current one is missing
    if (!settings.defaultModel || !models.some(m => m.name === settings.defaultModel)) {
      const firstChat = models.find(m => !m.isEmbedding)
      if (firstChat) updates.defaultModel = firstChat.name
    }
    // Project model — pick first chat model if current one is missing
    if (settings.defaultProjectModel && !models.some(m => m.name === settings.defaultProjectModel)) {
      const firstChat = models.find(m => !m.isEmbedding)
      if (firstChat) updates.defaultProjectModel = firstChat.name
    }
    // Embedding model — pick first embedding model if current one is missing
    if (settings.defaultEmbeddingModel && !models.some(m => m.name === settings.defaultEmbeddingModel)) {
      const firstEmbed = models.find(m => m.isEmbedding)
      if (firstEmbed) updates.defaultEmbeddingModel = firstEmbed.name
      else updates.defaultEmbeddingModel = null
    }
    if (Object.keys(updates).length > 0) updateSettings(updates)
  }, [models])

  // Re-fetch models when ollamaBaseUrl changes
  useEffect(() => {
    fetchModels()
  }, [settings.ollamaBaseUrl, fetchModels])

  const chatModels = models.filter(m => !m.isEmbedding)
  const embeddingModels = models.filter(m => m.isEmbedding)

  return { settings, models, chatModels, embeddingModels, loading, updateSettings, updatePreferences, fetchModels, fetchSettings }
}