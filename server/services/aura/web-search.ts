import { buildCrawlArgs, buildDesignCrawlArgs, execFileAsync } from './crawl.ts'
import { rmSync } from 'fs'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface WebSearchResult {
  source: string
  content: string
  error?: string
}

interface OllamaSearchItem {
  title?: string
  url?: string
  snippet?: string
}

interface OllamaSearchResponse {
  results?: OllamaSearchItem[]
  query?: string
}

interface OllamaFetchResponse {
  title?: string
  content?: string
  links?: string[]
}

// ── WebSearchService ───────────────────────────────────────────────────────────

export class WebSearchService {
  private apiKey: string | null
  private rateLimitHit = false

  constructor(apiKey?: string) {
    this.apiKey = WebSearchService.resolveApiKey(apiKey)
  }

  /** Update the API key (e.g. after settings change) */
  setApiKey(apiKey?: string): void {
    this.apiKey = WebSearchService.resolveApiKey(apiKey)
    this.rateLimitHit = false
  }

  // ── Main entry point ────────────────────────────────────────────────────────

  async search(args: {
    query?: string
    url?: string
    design?: boolean
    flags?: Record<string, unknown>
  }): Promise<WebSearchResult> {
    const design = args.design === true
    const query = String(args.query ?? '')
    const url = String(args.url ?? '')
    const flags = (args.flags ?? {}) as Record<string, unknown>

    // Flags present means crawl4ai rendering is needed — skip Ollama (plain text)
    const hasFlags = Object.keys(flags).length > 0
    const needsCrawl4ai = design || hasFlags

    // Design mode: always crawl4ai with design extraction JS (only a browser can extract CSS)
    if (design) {
      if (!url) {
        return { source: '', content: '', error: 'The "design" flag requires a URL. Design extraction cannot be performed on search results.' }
      }
      return this.crawl4aiDesign(url, flags)
    }

    // URL mode: Ollama (if no flags) → crawl4ai → raw fetch
    if (url) {
      // Skip Ollama when flags are present — the user wants crawl4ai features
      if (!hasFlags && this.apiKey && !this.rateLimitHit) {
        const result = await this.ollamaFetch(url)
        if (result) {
          return { source: url, content: result.content || `No content returned from ${url}` }
        }
        // ollamaFetch failed — fall through to crawl4ai
      }

      const crawled = await this.crawl4aiFetch(url, flags)
      if (crawled) return { source: url, content: crawled }

      const raw = await this.rawFetch(url)
      if (raw) return { source: url, content: raw }

      return { source: url, content: '', error: `Failed to fetch ${url}` }
    }

    // Query mode: Ollama (if no flags) → DuckDuckGo + crawl4ai → DuckDuckGo + raw fetch
    if (query) {
      // Skip Ollama when flags are present — the user wants crawl4ai features
      if (!hasFlags && this.apiKey && !this.rateLimitHit) {
        const results = await this.ollamaSearch(query)
        if (results) {
          return { source: `search:${query}`, content: this.formatSearchResults(query, results) }
        }
        // ollamaSearch failed — fall through to DuckDuckGo
      }

      const ddgUrl = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`
      const crawled = await this.crawl4aiFetch(ddgUrl, flags)
      if (crawled) return { source: ddgUrl, content: crawled }

      const raw = await this.rawFetch(ddgUrl)
      if (raw) return { source: ddgUrl, content: raw }

      return { source: ddgUrl, content: '', error: `Failed to search for "${query}"` }
    }

    return { source: '', content: '', error: 'Either query or url is required for search_web' }
  }

  // ── Ollama Cloud API ────────────────────────────────────────────────────────

  private async ollamaSearch(query: string, maxResults = 5): Promise<OllamaSearchItem[] | null> {
    try {
      const response = await fetch('https://ollama.com/api/web_search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({ query, max_results: maxResults }),
        signal: AbortSignal.timeout(15000),
      })

      if (response.status === 429) {
        this.rateLimitHit = true
        console.warn('[WebSearchService] Ollama web search rate limit reached. Falling back to DuckDuckGo.')
        return null
      }

      if (!response.ok) {
        console.warn(`[WebSearchService] Ollama web_search API returned ${response.status} ${response.statusText}`)
        return null
      }

      const data = await response.json() as OllamaSearchResponse
      const results = data.results || []
      if (results.length === 0) return null
      return results
    } catch (err) {
      console.warn('[WebSearchService] Ollama web_search request failed:', err instanceof Error ? err.message : String(err))
      return null
    }
  }

  private async ollamaFetch(url: string): Promise<OllamaFetchResponse | null> {
    try {
      const response = await fetch('https://ollama.com/api/web_fetch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({ url }),
        signal: AbortSignal.timeout(30000),
      })

      if (response.status === 429) {
        this.rateLimitHit = true
        console.warn('[WebSearchService] Ollama web_fetch rate limit reached. Falling back to crawl4ai.')
        return null
      }

      if (!response.ok) {
        console.warn(`[WebSearchService] Ollama web_fetch API returned ${response.status} ${response.statusText}`)
        return null
      }

      const data = await response.json() as OllamaFetchResponse
      return data
    } catch (err) {
      console.warn('[WebSearchService] Ollama web_fetch request failed:', err instanceof Error ? err.message : String(err))
      return null
    }
  }

  // ── Crawl4ai ────────────────────────────────────────────────────────────────

  private async crawl4aiFetch(url: string, flags: Record<string, unknown>): Promise<string | null> {
    try {
      const cliArgs = buildCrawlArgs(url, flags)
      const timeout = flags.deep_crawl ? 120000 : 30000
      const maxBuffer = flags.deep_crawl ? 5 * 1024 * 1024 : 1024 * 1024
      const { stdout } = await execFileAsync('crwl', cliArgs, { timeout, maxBuffer })
      const content = stdout.trim()
      return content || null
    } catch {
      return null
    }
  }

  private async crawl4aiDesign(url: string, flags: Record<string, unknown>): Promise<WebSearchResult> {
    let configDir: string | null = null
    try {
      const result = buildDesignCrawlArgs(url, flags)
      const cliArgs = result.args
      configDir = result.configDir
      const timeout = flags.deep_crawl ? 120000 : 30000
      const maxBuffer = flags.deep_crawl ? 5 * 1024 * 1024 : 1024 * 1024
      const { stdout } = await execFileAsync('crwl', cliArgs, { timeout, maxBuffer })
      const content = stdout.trim()
      return { source: url, content: content || `No content returned from ${url}` }
    } catch {
      return { source: url, content: '', error: 'Design extraction requires crawl4ai (crwl CLI). Ensure crawl4ai is installed and the URL is accessible.' }
    } finally {
      if (configDir) {
        try { rmSync(configDir, { recursive: true, force: true }) } catch {}
      }
    }
  }

  // ── Raw HTTP fetch fallback ─────────────────────────────────────────────────

  private async rawFetch(url: string): Promise<string | null> {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(10000),
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.7',
        },
      })
      if (!response.ok) {
        return `Error: HTTP ${response.status} ${response.statusText} for ${url}`
      }
      const text = await response.text()
      return text
    } catch (fetchErr) {
      return null
    }
  }

  // ── Formatting ─────────────────────────────────────────────────────────────

  private formatSearchResults(query: string, results: OllamaSearchItem[]): string {
    if (results.length === 0) {
      return `No results found for "${query}"`
    }

    const lines: string[] = [`## Search Results for "${query}"\n`]

    for (let i = 0; i < results.length; i++) {
      const r = results[i]
      const num = i + 1
      const title = r.title || 'Untitled'
      const url = r.url || ''
      const snippet = r.snippet || ''

      lines.push(`${num}. **${title}**`)
      if (url) lines.push(`   URL: ${url}`)
      if (snippet) lines.push(`   ${snippet}`)
      lines.push('')
    }

    lines.push('---')
    lines.push('To read the full content of any result above, use search_web with the "url" parameter set to that URL.')

    return lines.join('\n')
  }

  // ── Utility ─────────────────────────────────────────────────────────────────

  /** Resolve the API key: settings first, then env, then null */
  static resolveApiKey(settingsApiKey?: string): string | null {
    return settingsApiKey?.trim() || process.env.OLLAMA_API_KEY || null
  }

  /** Truncate content to a max length with a notice appended */
  static truncateContent(content: string, maxLength: number): string {
    if (content.length <= maxLength) return content
    return content.slice(0, maxLength) + '\n\n[Content truncated to fit context window]'
  }
}