import type { OllamaChatRequest, OllamaChatResponse, OllamaModel, OllamaTagsResponse, Settings } from '../storage/types.ts'
import type { FileStore } from '../storage/fileStore.ts'

const AVAILABILITY_CACHE_MS = 60_000

export class OllamaService {
  private store: FileStore
  private fallbackUrl: string
  private availabilityCache: { result: boolean; timestamp: number } | null = null

  constructor(store: FileStore, fallbackUrl?: string) {
    this.store = store
    this.fallbackUrl = fallbackUrl || process.env.OLLAMA_URL || 'http://localhost:11434'
  }

  // ── Dynamic URL resolution ──────────────────────────────────────────────────

  private async getBaseUrl(): Promise<string> {
    const settings = await this.store.read<Settings>('settings.json')
    return OllamaService.resolveBaseUrl(settings?.ollamaBaseUrl || this.fallbackUrl)
  }

  // ── Static config resolution ────────────────────────────────────────────────

  static resolveBaseUrl(settingsUrl?: string): string {
    const raw = settingsUrl?.trim()
      || process.env.OLLAMA_BASE_URL
      || process.env.OLLAMA_URL
      || 'http://localhost:11434'
    return /^https?:\/\//i.test(raw) ? raw : `http://${raw}`
  }

  static resolveModel(settings?: Settings | null): string {
    return settings?.defaultProjectModel
      || settings?.defaultModel
      || process.env.OLLAMA_MODEL
      || 'glm-5.1:cloud'
  }

  // ── Availability ────────────────────────────────────────────────────────────

  async checkAvailability(model?: string): Promise<boolean> {
    const now = Date.now()
    if (this.availabilityCache && now - this.availabilityCache.timestamp < AVAILABILITY_CACHE_MS) {
      return this.availabilityCache.result
    }
    try {
      const baseUrl = await this.getBaseUrl()
      const res = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(5000) })
      if (!res.ok) {
        this.availabilityCache = { result: false, timestamp: now }
        return false
      }
      const data = await res.json() as { models?: Array<{ name: string }> }
      const available = model
        ? (data.models ?? []).some(m => m.name.startsWith(model.split(':')[0]))
        : true
      this.availabilityCache = { result: available, timestamp: now }
      return available
    } catch {
      this.availabilityCache = { result: false, timestamp: now }
      return false
    }
  }

  // ── Existing methods (updated to use getBaseUrl) ───────────────────────────

  async listModels(): Promise<OllamaModel[]> {
    const baseUrl = await this.getBaseUrl()
    const res = await fetch(`${baseUrl}/api/tags`)
    if (!res.ok) throw new Error(`Ollama API error: ${res.status}`)
    const data: OllamaTagsResponse = await res.json()
    return data.models
  }

  async chat(request: OllamaChatRequest): Promise<OllamaChatResponse> {
    const baseUrl = await this.getBaseUrl()
    const res = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...request, stream: false }),
    })
    if (!res.ok) throw new Error(`Ollama API error: ${res.status}`)
    return res.json()
  }

  async chatStream(request: OllamaChatRequest): Promise<ReadableStream<Uint8Array>> {
    const baseUrl = await this.getBaseUrl()
    const res = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...request, stream: true }),
    })
    if (!res.ok) throw new Error(`Ollama API error: ${res.status}`)
    if (!res.body) throw new Error('No response body for streaming')
    return res.body
  }

  async isHealthy(): Promise<boolean> {
    try {
      const baseUrl = await this.getBaseUrl()
      const res = await fetch(`${baseUrl}/`)
      return res.ok
    } catch {
      return false
    }
  }

  // ── New methods ────────────────────────────────────────────────────────────

  async embed(model: string, prompt: string, timeout = 30000): Promise<number[] | null> {
    try {
      const baseUrl = await this.getBaseUrl()
      const res = await fetch(`${baseUrl}/api/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, prompt }),
        signal: AbortSignal.timeout(timeout),
      })
      if (!res.ok) return null
      const data = await res.json() as { embedding?: number[] }
      return data.embedding?.length ? data.embedding : null
    } catch {
      return null
    }
  }

  async chatSimple(
    model: string,
    messages: Array<{ role: string; content: string }>,
    options?: { timeout?: number },
  ): Promise<string | null> {
    try {
      const baseUrl = await this.getBaseUrl()
      const res = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages, stream: false }),
        signal: AbortSignal.timeout(options?.timeout ?? 30000),
      })
      if (!res.ok) return null
      const data = await res.json() as { message?: { content?: string } }
      return data.message?.content?.trim() ?? null
    } catch {
      return null
    }
  }
}