import type { SearchResult, SearchMode } from '../types.ts'
import { BM25SearchEngine } from './bm25.ts'
import { EmbeddingService } from './embedding.ts'

const RRF_K = 60

export class HybridSearchEngine {
  private bm25Engine: BM25SearchEngine | null
  private embeddingService: EmbeddingService

  constructor(bm25Engine: BM25SearchEngine | null, embeddingService: EmbeddingService) {
    this.bm25Engine = bm25Engine
    this.embeddingService = embeddingService
  }

  async search(
    query: string,
    mode: SearchMode,
    basicSearchFn: (query: string, options?: { limit?: number; kinds?: string[] }) => SearchResult[],
    options?: { limit?: number; kinds?: string[] },
  ): Promise<SearchResult[]> {
    const limit = options?.limit ?? 50
    const kinds = options?.kinds
    const expandedLimit = Math.min(limit * 3, 200) // fetch more for RRF, then truncate

    // mode === 'basic' → use basic search
    if (mode === 'basic') {
      return basicSearchFn(query, { limit, kinds })
    }

    // mode === 'bm25' → use BM25 if available, else basic
    if (mode === 'bm25') {
      if (this.bm25Engine) {
        return this.bm25Engine.query(query, limit, kinds)
      }
      return basicSearchFn(query, { limit, kinds })
    }

    // mode === 'hybrid' → try BM25 + semantic, fallback as needed
    const bm25Results: SearchResult[] = this.bm25Engine
      ? this.bm25Engine.query(query, expandedLimit, kinds)
      : []

    // Try semantic search
    const queryEmbedding = await this.embeddingService.embedQuery(query)
    let semanticResults: SearchResult[] = []

    if (queryEmbedding) {
      semanticResults = this.embeddingService.query(queryEmbedding, expandedLimit, kinds)
    }

    // If we have both result sets, merge with RRF
    if (bm25Results.length > 0 && semanticResults.length > 0) {
      return this.reciprocalRankFusion(bm25Results, semanticResults, limit)
    }

    // If only BM25 available
    if (bm25Results.length > 0) {
      return bm25Results.slice(0, limit)
    }

    // If only semantic available
    if (semanticResults.length > 0) {
      return semanticResults.slice(0, limit)
    }

    // Fallback to basic
    return basicSearchFn(query, { limit, kinds })
  }

  private reciprocalRankFusion(
    bm25Results: SearchResult[],
    semanticResults: SearchResult[],
    limit: number,
  ): SearchResult[] {
    const scoreMap = new Map<string, {
      node: SearchResult['node']
      bm25Rank: number | null
      semanticRank: number | null
      rrfScore: number
      bm25Score: number | null
      semanticScore: number | null
    }>()

    // Score BM25 results
    for (let rank = 0; rank < bm25Results.length; rank++) {
      const { node, score, bm25Score } = bm25Results[rank]
      const key = node.id
      const rrfContrib = 1 / (RRF_K + rank + 1)
      const existing = scoreMap.get(key)
      if (existing) {
        existing.bm25Rank = rank
        existing.rrfScore += rrfContrib
        existing.bm25Score = bm25Score ?? score
      } else {
        scoreMap.set(key, {
          node,
          bm25Rank: rank,
          semanticRank: null,
          rrfScore: rrfContrib,
          bm25Score: bm25Score ?? score,
          semanticScore: null,
        })
      }
    }

    // Score semantic results
    for (let rank = 0; rank < semanticResults.length; rank++) {
      const { node, score, semanticScore } = semanticResults[rank]
      const key = node.id
      const rrfContrib = 1 / (RRF_K + rank + 1)
      const existing = scoreMap.get(key)
      if (existing) {
        existing.semanticRank = rank
        existing.rrfScore += rrfContrib
        existing.semanticScore = semanticScore ?? score
      } else {
        scoreMap.set(key, {
          node,
          bm25Rank: null,
          semanticRank: rank,
          rrfScore: rrfContrib,
          bm25Score: null,
          semanticScore: semanticScore ?? score,
        })
      }
    }

    // Sort by RRF score descending
    const ranked = Array.from(scoreMap.values())
      .sort((a, b) => b.rrfScore - a.rrfScore)
      .slice(0, limit)

    return ranked.map(r => ({
      node: r.node,
      score: r.rrfScore,
      mode: 'hybrid' as SearchMode,
      bm25Score: r.bm25Score ?? undefined,
      semanticScore: r.semanticScore ?? undefined,
    }))
  }
}