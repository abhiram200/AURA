import { describe, it, expect, vi, beforeEach } from 'vitest'
import { OllamaService } from '../../../server/services/ollama.ts'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

describe('OllamaService', () => {
  let service: OllamaService

  beforeEach(() => {
    service = new OllamaService('http://localhost:11434')
    mockFetch.mockReset()
  })

  it('lists available models', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ models: [{ name: 'llama3.2', size: 4050000000, modified_at: '2026-01-01' }] }),
    })
    const result = await service.listModels()
    expect(result).toEqual([{ name: 'llama3.2', size: 4050000000, modified_at: '2026-01-01' }])
    expect(mockFetch).toHaveBeenCalledWith('http://localhost:11434/api/tags')
  })

  it('sends a non-streaming chat request', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        message: { role: 'assistant', content: 'Hello!' },
        done: true,
      }),
    })
    const result = await service.chat({
      model: 'llama3.2',
      messages: [{ role: 'user', content: 'Hi' }],
      stream: false,
    })
    expect(result.message.content).toBe('Hello!')
    expect(mockFetch).toHaveBeenCalledWith('http://localhost:11434/api/chat', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
    }))
  })

  it('returns a readable stream for streaming requests', async () => {
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(JSON.stringify({ message: { content: 'Hi' }, done: false }) + '\n'))
        controller.enqueue(encoder.encode(JSON.stringify({ message: { content: '' }, done: true }) + '\n'))
        controller.close()
      },
    })
    mockFetch.mockResolvedValueOnce({
      ok: true,
      body: stream,
      headers: new Headers({ 'content-type': 'application/x-ndjson' }),
    })
    const result = await service.chatStream({
      model: 'llama3.2',
      messages: [{ role: 'user', content: 'Hi' }],
      stream: true,
    })
    expect(result).not.toBeNull()
    expect(typeof result.getReader).toBe('function')
  })

  it('throws on non-ok response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    })
    await expect(service.listModels()).rejects.toThrow('Ollama API error: 500')
  })

  it('checks health endpoint', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true })
    const result = await service.isHealthy()
    expect(result).toBe(true)
  })

  it('returns false when health check fails', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Connection refused'))
    const result = await service.isHealthy()
    expect(result).toBe(false)
  })
})