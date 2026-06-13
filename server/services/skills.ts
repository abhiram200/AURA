import { v4 as uuidv4 } from 'uuid'
import type { SkillEntry, SkillDefinition, BuiltinHandler, ApiHandler, CodeHandler } from '../storage/types.ts'
import type { FileStore } from '../storage/fileStore.ts'
import { WebSearchService } from './aura/web-search.ts'

const BUILTIN_SKILLS: SkillEntry[] = [
  {
    id: 'builtin_search_web',
    name: 'search_web',
    definition: {
      type: 'function',
      function: {
        name: 'search_web',
        description: 'Search the web or fetch web page content. Use "query" to search for pages about a topic — returns titles, URLs, and snippets. Use "url" to fetch the full content of a specific page. Use "design: true" with a URL to extract visual design tokens (CSS variables, colors, fonts, spacing). Use "flags" for advanced crawl options — when flags are provided, the full rendering engine is used instead of the fast path.',
        parameters: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'A URL to fetch and render directly. ALWAYS prefer this when a URL is available — it returns the complete page content. (e.g. "https://react.dev/blog")' },
            query: { type: 'string', description: 'A search query to find pages about a topic. Use ONLY when you don\'t have a URL and need to discover relevant pages. (e.g. "React 19 release notes")' },
            design: {
              type: 'boolean',
              description: 'Extract design tokens (CSS variables, colors, fonts, spacing, border radii, shadows) from the page instead of reading content. REQUIRES a URL. Use when the user asks about a website\'s visual design, theme, styling, color scheme, or design system.',
            },
            flags: {
              type: 'object',
              description: 'Optional crawl4ai flags for advanced crawling. Use these when the default behavior is insufficient.',
              properties: {
                deep_crawl: {
                  type: 'string',
                  enum: ['bfs', 'dfs', 'best-first'],
                  description: 'Follow links across multiple pages. Use when researching a topic that requires reading several pages on a site (e.g. "research the React docs" or "find all articles about X on this blog").',
                },
                max_pages: {
                  type: 'integer',
                  description: 'Max pages to visit during a deep crawl (default 10). Set higher for broad research, lower for focused exploration.',
                },
                enable_stealth: {
                  type: 'boolean',
                  description: 'Bypass anti-bot detection. Use when a site blocks or returns CAPTCHAs to automated requests.',
                },
                user_agent_mode: {
                  type: 'string',
                  enum: ['default', 'random', 'mobile'],
                  description: 'User agent strategy. Use "random" to rotate user agents and avoid detection.',
                },
                avoid_ads: {
                  type: 'boolean',
                  description: 'Block ad and tracker requests for cleaner page content.',
                },
                css_selector: {
                  type: 'string',
                  description: 'CSS selector to extract only a specific part of the page (e.g. "#main-content", "article", ".post-body"). Use when you need just one section of a large page.',
                },
                wait_until: {
                  type: 'string',
                  enum: ['domcontentloaded', 'networkidle', 'load'],
                  description: 'Page load condition. Use "networkidle" for pages with heavy dynamic/JS content that loads after initial render.',
                },
                delay_before_return_html: {
                  type: 'number',
                  description: 'Seconds to wait after page load before extracting content (default 0.1). Increase for pages that render content gradually.',
                },
                scan_full_page: {
                  type: 'boolean',
                  description: 'Scroll through the entire page before extracting. Use for pages with infinite scroll or lazy-loaded content.',
                },
                remove_overlay_elements: {
                  type: 'boolean',
                  description: 'Remove popup/modal overlays, cookie banners, and floating elements from the page.',
                },
                magic: {
                  type: 'boolean',
                  description: 'Auto-handle popups, consent banners, and overlays. Enables simulate_user + remove_overlay_elements + remove_consent_popups.',
                },
                simulate_user: {
                  type: 'boolean',
                  description: 'Simulate human mouse movements and interactions. Helps bypass bot detection on protected sites.',
                },
                process_iframes: {
                  type: 'boolean',
                  description: 'Extract content from iframes. Use when page content is embedded in frames.',
                },
                exclude_external_links: {
                  type: 'boolean',
                  description: 'Remove external links from the output for cleaner content.',
                },
                exclude_social_media_links: {
                  type: 'boolean',
                  description: 'Remove social media links from the output.',
                },
                word_count_threshold: {
                  type: 'integer',
                  description: 'Minimum word count for content blocks (default 200). Lower for short content like tweets, higher to filter navigation noise.',
                },
              },
            },
          },
        },
      },
    },
    handler: { type: 'builtin', action: 'search_web' },
    active: true,
    locked: true,
    createdAt: new Date().toISOString(),
  },
  {
    id: 'builtin_project_mode',
    name: 'project_mode',
    definition: {
      type: 'function',
      function: {
        name: 'project_mode',
        description: 'Activate project mode. Use when the user wants to build/create a new project OR add an existing local project OR clone a GitHub repository to the builder.',
        parameters: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'The absolute path to an existing local project directory, or a full GitHub URL (e.g. "https://github.com/user/repo") to clone a repo. Omit when the user wants to create a new project from scratch.',
            },
            name: {
              type: 'string',
             description: 'A short descriptive name for the project (e.g., "blog", "todo-app"). Used to check if a project with this name already exists in the builder.',
            },
          },
        },
      },
    },
    handler: { type: 'builtin', action: 'project_mode' },
    active: true,
    locked: true,
    createdAt: new Date().toISOString(),
  },
]

export class SkillsService {
  private store: FileStore
  private webSearch: WebSearchService

  constructor(store: FileStore, webSearch: WebSearchService) {
    this.store = store
    this.webSearch = webSearch
  }

  async init(): Promise<void> {
    const existing = await this.store.read<SkillEntry[]>('skills.json')
    if (!existing) {
      await this.store.write('skills.json', BUILTIN_SKILLS)
    } else {
      // Replace builtin skills with code-defined versions, remove deleted ones
      const builtinById = new Map(BUILTIN_SKILLS.map((b) => [b.id, b]))
      const updated = existing
        .filter((s) => !s.id.startsWith('builtin_') || builtinById.has(s.id))
        .map((s) => {
          if (s.id.startsWith('builtin_') && builtinById.has(s.id)) {
            return { ...s, definition: builtinById.get(s.id)!.definition, handler: builtinById.get(s.id)!.handler }
          }
          return s
        })
      const existingIds = new Set(updated.map((s) => s.id))
      const newBuiltins = BUILTIN_SKILLS.filter((b) => !existingIds.has(b.id))
      await this.store.write('skills.json', [...updated, ...newBuiltins])
    }
  }

  async list(): Promise<SkillEntry[]> {
    return this.store.read<SkillEntry[]>('skills.json', [])
  }

  async add(
    definition: SkillDefinition,
    handler: BuiltinHandler | ApiHandler | CodeHandler
  ): Promise<SkillEntry> {
    const skills = await this.list()
    const entry: SkillEntry = {
      id: `skill_${uuidv4()}`,
      name: definition.function.name,
      definition,
      handler,
      active: true,
      locked: false,
      createdAt: new Date().toISOString(),
    }
    skills.push(entry)
    await this.store.write('skills.json', skills)
    return entry
  }

  async update(id: string, updates: Partial<Pick<SkillEntry, 'active' | 'handler' | 'locked'>>): Promise<SkillEntry | null> {
    const skills = await this.list()
    const index = skills.findIndex((s) => s.id === id)
    if (index === -1) return null
    skills[index] = { ...skills[index], ...updates }
    await this.store.write('skills.json', skills)
    return skills[index]
  }

  async delete(id: string): Promise<void> {
    const skills = await this.list()
    const filtered = skills.filter((s) => s.id !== id)
    await this.store.write('skills.json', filtered)
  }

  async deleteAll(): Promise<void> {
    const skills = await this.list()
    const kept = skills.filter((s) => s.id.startsWith('builtin_') || s.locked)
    await this.store.write('skills.json', kept)
  }

  async getActiveDefinitions(): Promise<SkillDefinition[]> {
    const skills = await this.list()
    return skills.filter((s) => s.active).map((s) => s.definition)
  }

  async findByName(name: string): Promise<SkillEntry | null> {
    const skills = await this.list()
    return skills.find((s) => s.name === name) ?? null
  }

  async executeBuiltin(action: string, args: Record<string, unknown>): Promise<string> {
    if (action === 'search_web') {
      const result = await this.webSearch.search({
        query: args.query,
        url: args.url,
        design: args.design,
        flags: args.flags,
      })

      if (result.error) {
        throw new Error(result.error)
      }

      const content = result.content || ''
      return content.length > 50000
        ? content.slice(0, 50000) + '\n\n[Content truncated to fit context window]'
        : content
    }

    if (action === 'project_mode') {
      return 'Project mode suggestion displayed. Waiting for user choice.'
    }

    throw new Error(`Unknown builtin action: ${action}`)
  }

  async executeApi(handler: ApiHandler, args: Record<string, unknown>): Promise<string> {
    const url = new URL(handler.url)
    const options: RequestInit = {
      method: handler.method,
      headers: { 'Content-Type': 'application/json', ...handler.headers },
    }

    if (handler.method === 'GET') {
      for (const [key, value] of Object.entries(args)) {
        url.searchParams.set(key, String(value))
      }
    } else {
      options.body = JSON.stringify(args)
    }

    const response = await fetch(url.toString(), options)
    return response.text()
  }

  async executeCode(code: string, args: Record<string, unknown>): Promise<string> {
    try {
      const fn = new Function('args', code)
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Code execution timed out (5s limit)')), 5000)
      )
      const result = await Promise.race([fn(args), timeout])
      if (result instanceof Promise) {
        return String(await Promise.race([result, timeout]))
      }
      return String(result ?? '')
    } catch (err) {
      throw new Error(`Code execution failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

}