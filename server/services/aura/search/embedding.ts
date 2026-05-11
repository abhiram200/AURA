import type { AuraNode, SearchResult, EmbeddingStoreData } from '../types.ts'

const EMBED_TIMEOUT = 30000
const MAX_CONCURRENT = 5
const AVAILABILITY_CACHE_MS = 60000

export class EmbeddingService {
  private embeddings: Map<string, number[]> = new Map()
  private nodeMap: Map<string, AuraNode> = new Map()
  private available = false
  private lastAvailabilityCheck = 0
  private availabilityCacheResult = false
  private generatedAt = ''
  private dimension = 0
  private ollamaBaseUrl: string
  private embedModel: string

  constructor(ollamaBaseUrl?: string, embedModel?: string) {
    this.ollamaBaseUrl = ollamaBaseUrl || process.env.OLLAMA_BASE_URL || 'http://localhost:11434'
    this.embedModel = embedModel || 'mxbai-embed-large:335m'
  }

  async checkAvailability(): Promise<boolean> {
    const now = Date.now()
    if (now - this.lastAvailabilityCheck < AVAILABILITY_CACHE_MS) {
      return this.availabilityCacheResult
    }

    try {
      const res = await fetch(`${this.ollamaBaseUrl}/api/tags`, {
        signal: AbortSignal.timeout(5000),
      })
      if (!res.ok) {
        this.availabilityCacheResult = false
        this.lastAvailabilityCheck = now
        return false
      }
      const data = await res.json() as { models?: Array<{ name: string }> }
      const modelExists = (data.models ?? []).some(
        (m: { name: string }) => m.name.startsWith(this.embedModel),
      )
      this.availabilityCacheResult = modelExists
      this.lastAvailabilityCheck = now
      return modelExists
    } catch {
      this.availabilityCacheResult = false
      this.lastAvailabilityCheck = now
      return false
    }
  }

  async generateEmbeddings(
    nodes: AuraNode[],
    onProgress?: (done: number, total: number) => void,
  ): Promise<boolean> {
    const isAvailable = await this.checkAvailability()
    if (!isAvailable) {
      this.available = false
      return false
    }

    const toEmbed = nodes.filter(n => !this.embeddings.has(n.id))
    if (toEmbed.length === 0) {
      this.available = true
      return true
    }

    // Build node map
    for (const node of nodes) {
      this.nodeMap.set(node.id, node)
    }

    let done = 0
    let failures = 0
    const total = toEmbed.length
    const abortThreshold = Math.floor(total * 0.5)

    // Process in batches of MAX_CONCURRENT
    for (let i = 0; i < toEmbed.length; i += MAX_CONCURRENT) {
      const batch = toEmbed.slice(i, i + MAX_CONCURRENT)
      const results = await Promise.allSettled(
        batch.map(node => this.embedNode(node)),
      )

      for (let j = 0; j < results.length; j++) {
        const result = results[j]
        if (result.status === 'fulfilled' && result.value !== null) {
          this.embeddings.set(batch[j].id, result.value)
        } else {
          failures++
        }
      }

      done += batch.length
      onProgress?.(done, total)

      // Abort if too many failures
      if (failures > abortThreshold) {
        this.available = false
        return false
      }
    }

    this.available = this.embeddings.size > 0
    this.generatedAt = new Date().toISOString()
    return this.available
  }

  private async embedNode(node: AuraNode): Promise<number[] | null> {
    const text = `${node.name} ${node.kind} ${node.filePath}`
    return this.embedText(text)
  }

  private async embedText(text: string): Promise<number[] | null> {
    try {
      const res = await fetch(`${this.ollamaBaseUrl}/api/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.embedModel, prompt: text }),
        signal: AbortSignal.timeout(EMBED_TIMEOUT),
      })
      if (!res.ok) return null
      const data = await res.json() as { embedding?: number[] }
      const embedding = data.embedding
      if (embedding && embedding.length > 0) {
        if (this.dimension === 0) this.dimension = embedding.length
        return embedding
      }
      return null
    } catch {
      return null
    }
  }

  async embedQuery(query: string): Promise<number[] | null> {
    const isAvailable = await this.checkAvailability()
    if (!isAvailable) return null
    return this.embedText(query)
  }

  query(queryEmbedding: number[], limit: number, kinds?: string[]): SearchResult[] {
    if (this.embeddings.size === 0) return []

    const results: SearchResult[] = []

    for (const [nodeId, embedding] of this.embeddings) {
      const node = this.nodeMap.get(nodeId)
      if (!node) continue
      if (kinds && kinds.length > 0 && !kinds.includes(node.kind)) continue

      const similarity = this.cosineSimilarity(queryEmbedding, embedding)
      if (similarity > 0) {
        results.push({ node, score: similarity, mode: 'hybrid', semanticScore: similarity })
      }
    }

    results.sort((a, b) => b.score - a.score)
    return results.slice(0, limit)
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length || a.length === 0) return 0
    let dotProduct = 0
    let normA = 0
    let normB = 0
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i]
      normA += a[i] * a[i]
      normB += b[i] * b[i]
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB)
    return denom === 0 ? 0 : dotProduct / denom
  }

  isAvailable(): boolean {
    return this.available
  }

  removeNodes(nodeIds: Set<string>): void {
    for (const id of nodeIds) {
      this.embeddings.delete(id)
    }
  }

  toJSON(): EmbeddingStoreData {
    const embeddingsObj: Record<string, number[]> = {}
    for (const [id, emb] of this.embeddings) {
      embeddingsObj[id] = emb
    }
    return {
      version: 1,
      model: this.embedModel,
      dimension: this.dimension,
      generatedAt: this.generatedAt,
      ollamaWasAvailable: this.available,
      embeddings: embeddingsObj,
    }
  }

  static fromJSON(data: EmbeddingStoreData, nodeMap: Map<string, AuraNode>, ollamaBaseUrl?: string, embedModel?: string): EmbeddingService {
    const service = new EmbeddingService(ollamaBaseUrl, embedModel)
    // If the saved model differs from the current model, embeddings are stale
    if (data.model && data.model !== service.embedModel) {
      service.available = false
      service.availabilityCacheResult = false
      return service
    }
    service.nodeMap = nodeMap
    service.dimension = data.dimension
    service.generatedAt = data.generatedAt
    service.available = data.ollamaWasAvailable && Object.keys(data.embeddings).length > 0
    service.availabilityCacheResult = data.ollamaWasAvailable
    service.lastAvailabilityCheck = 0

    for (const [id, emb] of Object.entries(data.embeddings)) {
      service.embeddings.set(id, emb)
    }

    return service
  }
}