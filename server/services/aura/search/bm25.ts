import type { AuraNode, SearchResult, BM25IndexData } from '../types.ts'

const K1 = 1.2
const B = 0.75

export class BM25SearchEngine {
  private corpusSize = 0
  private avgDocLength = 0
  private docLengths: Map<string, number> = new Map()
  private invertedIndex: Map<string, Map<string, number>> = new Map() // term -> (docId -> tf)
  private idfCache: Map<string, number> = new Map()
  private nodeMap: Map<string, AuraNode> = new Map()

  buildIndex(nodes: AuraNode[]): void {
    this.corpusSize = 0
    this.avgDocLength = 0
    this.docLengths.clear()
    this.invertedIndex.clear()
    this.idfCache.clear()
    this.nodeMap.clear()

    let totalDocLength = 0

    for (const node of nodes) {
      const tokens = this.tokenize(node)
      this.nodeMap.set(node.id, node)
      this.docLengths.set(node.id, tokens.length)
      totalDocLength += tokens.length
      this.corpusSize++

      // Count term frequencies per document
      const tfMap = new Map<string, number>()
      for (const token of tokens) {
        tfMap.set(token, (tfMap.get(token) ?? 0) + 1)
      }

      for (const [term, tf] of tfMap) {
        if (!this.invertedIndex.has(term)) {
          this.invertedIndex.set(term, new Map())
        }
        this.invertedIndex.get(term)!.set(node.id, tf)
      }
    }

    this.avgDocLength = this.corpusSize > 0 ? totalDocLength / this.corpusSize : 0

    // Precompute IDF for all terms
    for (const term of this.invertedIndex.keys()) {
      this.idfCache.set(term, this.computeIDF(term))
    }
  }

  query(query: string, limit: number, kinds?: string[]): SearchResult[] {
    if (this.corpusSize === 0) return []

    const queryTokens = this.tokenizeQuery(query)
    if (queryTokens.length === 0) return []

    const scores = new Map<string, number>()

    for (const term of queryTokens) {
      const idf = this.idfCache.get(term) ?? this.computeIDF(term)
      const postings = this.invertedIndex.get(term)
      if (!postings) continue

      for (const [docId, tf] of postings) {
        const docLength = this.docLengths.get(docId) ?? 1
        const tfNorm = (tf * (K1 + 1)) / (tf + K1 * (1 - B + B * (docLength / this.avgDocLength)))
        const score = idf * tfNorm
        scores.set(docId, (scores.get(docId) ?? 0) + score)
      }
    }

    // Filter by kinds and sort
    let results: SearchResult[] = []
    for (const [docId, score] of scores) {
      const node = this.nodeMap.get(docId)
      if (!node) continue
      if (kinds && kinds.length > 0 && !kinds.includes(node.kind)) continue
      results.push({ node, score, mode: 'bm25', bm25Score: score })
    }

    results.sort((a, b) => b.score - a.score)
    return results.slice(0, limit)
  }

  private computeIDF(term: string): number {
    const n = this.invertedIndex.get(term)?.size ?? 0
    return Math.log((this.corpusSize - n + 0.5) / (n + 0.5) + 1)
  }

  private tokenize(node: AuraNode): string[] {
    const parts: string[] = []
    // Name tokens with camelCase splitting
    parts.push(...this.splitCamelCase(node.name))
    // Kind token
    parts.push(node.kind.toLowerCase())
    // Path segment tokens
    const pathSegments = node.filePath.split(/[/\\]/)
    for (const seg of pathSegments) {
      if (seg && seg !== '.' && seg !== '..') {
        parts.push(...this.splitCamelCase(seg.replace(/\.\w+$/, ''))) // strip extension
      }
    }
    return parts.map(t => t.toLowerCase()).filter(t => t.length > 0)
  }

  private tokenizeQuery(query: string): string[] {
    return query
      .split(/[^a-zA-Z0-9]+/)
      .flatMap(t => this.splitCamelCase(t))
      .map(t => t.toLowerCase())
      .filter(t => t.length > 0)
  }

  private splitCamelCase(s: string): string[] {
    // Split on transitions: camelCase → ["camel", "Case"], ABCDef → ["ABC", "Def"]
    const result: string[] = []
    let current = ''
    for (let i = 0; i < s.length; i++) {
      const ch = s[i]
      const nextIsLower = i + 1 < s.length && s[i + 1] === s[i + 1].toLowerCase()
      if (current.length > 0 && ch === ch.toUpperCase() && nextIsLower) {
        result.push(current)
        current = ch
      } else {
        current += ch
      }
    }
    if (current) result.push(current)
    return result
  }

  toJSON(): BM25IndexData {
    const terms: BM25IndexData['terms'] = {}
    for (const [term, postings] of this.invertedIndex) {
      const idf = this.idfCache.get(term) ?? 0
      terms[term] = {
        idf,
        postings: Array.from(postings.entries()).map(([docId, tf]) => ({ docId, tf })),
      }
    }

    return {
      version: 1,
      corpusSize: this.corpusSize,
      avgDocLength: this.avgDocLength,
      docLengths: Object.fromEntries(this.docLengths),
      terms,
    }
  }

  static fromJSON(data: BM25IndexData, nodeMap: Map<string, AuraNode>): BM25SearchEngine {
    const engine = new BM25SearchEngine()
    engine.corpusSize = data.corpusSize
    engine.avgDocLength = data.avgDocLength
    engine.nodeMap = nodeMap

    engine.docLengths = new Map(Object.entries(data.docLengths))
    engine.invertedIndex = new Map()
    engine.idfCache = new Map()

    for (const [term, termData] of Object.entries(data.terms)) {
      engine.idfCache.set(term, termData.idf)
      const postings = new Map<string, number>()
      for (const { docId, tf } of termData.postings) {
        postings.set(docId, tf)
      }
      engine.invertedIndex.set(term, postings)
    }

    return engine
  }
}