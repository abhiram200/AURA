import type { OllamaChatRequest, OllamaChatResponse, OllamaModel, OllamaTagsResponse } from '../storage/types.ts'

export class OllamaService {
  private baseUrl: string

  constructor(baseUrl: string = 'http://localhost:11434') {
    this.baseUrl = baseUrl
  }

  async listModels(): Promise<OllamaModel[]> {
    const res = await fetch(`${this.baseUrl}/api/tags`)
    if (!res.ok) throw new Error(`Ollama API error: ${res.status}`)
    const data: OllamaTagsResponse = await res.json()
    return data.models
  }

  async chat(request: OllamaChatRequest): Promise<OllamaChatResponse> {
    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...request, stream: false }),
    })
    if (!res.ok) throw new Error(`Ollama API error: ${res.status}`)
    return res.json()
  }

  async chatStream(request: OllamaChatRequest): Promise<ReadableStream<Uint8Array>> {
    const res = await fetch(`${this.baseUrl}/api/chat`, {
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
      const res = await fetch(`${this.baseUrl}/`)
      return res.ok
    } catch {
      return false
    }
  }
}