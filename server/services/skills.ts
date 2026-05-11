import { v4 as uuidv4 } from 'uuid'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { mkdtempSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { SkillEntry, SkillDefinition, BuiltinHandler, ApiHandler, CodeHandler } from '../storage/types.ts'
import type { FileStore } from '../storage/fileStore.ts'

const execFileAsync = promisify(execFile)

const DESIGN_EXTRACTION_JS = `(function() {
  var trivial = new Set(['0px', 'none', 'normal', 'transparent', 'rgba(0, 0, 0, 0)', 'rgba(0,0,0,0)', 'currentcolor', 'inherit', 'initial', 'revert', 'unset', 'auto', '0', '0em', '0rem', 'medium', '0s']);
  function isTrivial(v) { if (!v) return true; var lv = v.toLowerCase().trim(); return trivial.has(lv) || lv === ''; }
  function unique(arr) { var seen = {}; var result = []; for (var i = 0; i < arr.length; i++) { var v = arr[i]; if (v && !isTrivial(v) && !seen[v]) { seen[v] = true; result.push(v); } } return result; }

  // CSS Custom Properties
  var customProps = {};
  var sheets = document.styleSheets;
  for (var si = 0; si < sheets.length; si++) {
    try {
      var rules = sheets[si].cssRules;
      for (var ri = 0; ri < rules.length; ri++) {
        var rule = rules[ri];
        if (rule.selectorText && rule.selectorText.indexOf(':root') !== -1) {
          var style = rule.style;
          for (var pi = 0; pi < style.length; pi++) {
            var prop = style[pi];
            if (prop.indexOf('--') === 0) {
              customProps[prop] = style.getPropertyValue(prop).trim();
            }
          }
        }
      }
    } catch(e) {}
  }

  // Computed styles from semantic elements
  var selectors = ['body', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'a', 'button', 'input', 'nav', 'header', 'footer', 'section', 'article', 'aside'];
  var props = ['color', 'background-color', 'font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'margin-top', 'margin-bottom', 'padding-top', 'padding-bottom', 'border-radius', 'box-shadow', 'border-width', 'text-decoration', 'text-transform'];
  var elementStyles = {};
  var colors = [], bgColors = [], fonts = [], fontSizes = [], fontWeights = [], lineHeights = [], letterSpacings = [];
  var marginsT = [], marginsB = [], paddingsT = [], paddingsB = [], radii = [], shadows = [];

  for (var i = 0; i < selectors.length; i++) {
    var el = document.querySelector(selectors[i]);
    if (!el) continue;
    var cs = getComputedStyle(el);
    var data = {};
    for (var j = 0; j < props.length; j++) {
      var val = cs.getPropertyValue(props[j]).trim();
      if (!isTrivial(val)) data[props[j]] = val;
    }
    if (Object.keys(data).length > 0) elementStyles[selectors[i]] = data;

    var c = cs.getPropertyValue('color').trim();
    if (!isTrivial(c)) colors.push(c);
    var bg = cs.getPropertyValue('background-color').trim();
    if (!isTrivial(bg)) bgColors.push(bg);
    var ff = cs.getPropertyValue('font-family').trim();
    if (!isTrivial(ff)) fonts.push(ff);
    var fs = cs.getPropertyValue('font-size').trim();
    if (!isTrivial(fs)) fontSizes.push(fs);
    var fw = cs.getPropertyValue('font-weight').trim();
    if (!isTrivial(fw)) fontWeights.push(fw);
    var lh = cs.getPropertyValue('line-height').trim();
    if (!isTrivial(lh)) lineHeights.push(lh);
    var ls = cs.getPropertyValue('letter-spacing').trim();
    if (!isTrivial(ls)) letterSpacings.push(ls);
    var mt = cs.getPropertyValue('margin-top').trim();
    if (!isTrivial(mt)) marginsT.push(mt);
    var mb = cs.getPropertyValue('margin-bottom').trim();
    if (!isTrivial(mb)) marginsB.push(mb);
    var pt = cs.getPropertyValue('padding-top').trim();
    if (!isTrivial(pt)) paddingsT.push(pt);
    var pb = cs.getPropertyValue('padding-bottom').trim();
    if (!isTrivial(pb)) paddingsB.push(pb);
    var br = cs.getPropertyValue('border-radius').trim();
    if (!isTrivial(br)) radii.push(br);
    var bs = cs.getPropertyValue('box-shadow').trim();
    if (!isTrivial(bs)) shadows.push(bs);
  }

  // Build HTML output
  var html = '<h1>Design Extraction</h1>';

  // CSS Custom Properties
  html += '<h2>CSS Custom Properties</h2>';
  var cpKeys = Object.keys(customProps);
  if (cpKeys.length > 0) {
    html += '<dl>';
    for (var k = 0; k < cpKeys.length; k++) {
      html += '<dt><code>' + cpKeys[k] + '</code></dt><dd>' + customProps[cpKeys[k]] + '</dd>';
    }
    html += '</dl>';
  } else {
    html += '<p>No CSS custom properties found on :root.</p>';
  }

  // Color Palette
  var uColors = unique(colors);
  var uBgColors = unique(bgColors);
  html += '<h2>Color Palette</h2>';
  html += '<h3>Text Colors</h3><ul>';
  for (var ci = 0; ci < uColors.length; ci++) html += '<li><code>' + uColors[ci] + '</code></li>';
  if (uColors.length === 0) html += '<li>None found</li>';
  html += '</ul>';
  html += '<h3>Background Colors</h3><ul>';
  for (var bi = 0; bi < uBgColors.length; bi++) html += '<li><code>' + uBgColors[bi] + '</code></li>';
  if (uBgColors.length === 0) html += '<li>None found</li>';
  html += '</ul>';

  // Typography
  html += '<h2>Typography</h2>';
  var uFonts = unique(fonts);
  html += '<h3>Font Families</h3><ul>';
  for (var fi = 0; fi < uFonts.length; fi++) html += '<li><code>' + uFonts[fi] + '</code></li>';
  html += '</ul>';
  html += '<h3>Font Sizes</h3><ul>';
  var uFS = unique(fontSizes);
  for (var fsi = 0; fsi < uFS.length; fsi++) html += '<li><code>' + uFS[fsi] + '</code></li>';
  html += '</ul>';
  html += '<h3>Font Weights</h3><ul>';
  var uFW = unique(fontWeights);
  for (var fwi = 0; fwi < uFW.length; fwi++) html += '<li><code>' + uFW[fwi] + '</code></li>';
  html += '</ul>';
  html += '<h3>Line Heights</h3><ul>';
  var uLH = unique(lineHeights);
  for (var lhi = 0; lhi < uLH.length; lhi++) html += '<li><code>' + uLH[lhi] + '</code></li>';
  html += '</ul>';
  html += '<h3>Letter Spacings</h3><ul>';
  var uLS = unique(letterSpacings);
  for (var lsi = 0; lsi < uLS.length; lsi++) html += '<li><code>' + uLS[lsi] + '</code></li>';
  html += '</ul>';

  // Spacing
  html += '<h2>Spacing</h2>';
  html += '<h3>Margin Top</h3><ul>';
  var uMT = unique(marginsT);
  for (var mti = 0; mti < uMT.length; mti++) html += '<li><code>' + uMT[mti] + '</code></li>';
  html += '</ul>';
  html += '<h3>Margin Bottom</h3><ul>';
  var uMB = unique(marginsB);
  for (var mbi = 0; mbi < uMB.length; mbi++) html += '<li><code>' + uMB[mbi] + '</code></li>';
  html += '</ul>';
  html += '<h3>Padding Top</h3><ul>';
  var uPT = unique(paddingsT);
  for (var pti = 0; pti < uPT.length; pti++) html += '<li><code>' + uPT[pti] + '</code></li>';
  html += '</ul>';
  html += '<h3>Padding Bottom</h3><ul>';
  var uPB = unique(paddingsB);
  for (var pbi = 0; pbi < uPB.length; pbi++) html += '<li><code>' + uPB[pbi] + '</code></li>';
  html += '</ul>';

  // Border Radii
  var uRadii = unique(radii);
  html += '<h2>Border Radii</h2><ul>';
  for (var bri = 0; bri < uRadii.length; bri++) html += '<li><code>' + uRadii[bri] + '</code></li>';
  if (uRadii.length === 0) html += '<li>None found</li>';
  html += '</ul>';

  // Box Shadows
  var uShadows = unique(shadows);
  html += '<h2>Box Shadows</h2><ul>';
  for (var shi = 0; shi < uShadows.length; shi++) html += '<li><code>' + uShadows[shi] + '</code></li>';
  if (uShadows.length === 0) html += '<li>None found</li>';
  html += '</ul>';

  // Computed Styles by Element
  html += '<h2>Computed Styles by Element</h2>';
  var esKeys = Object.keys(elementStyles);
  for (var eki = 0; eki < esKeys.length; eki++) {
    html += '<h3>' + esKeys[eki] + '</h3><dl>';
    var ed = elementStyles[esKeys[eki]];
    var edKeys = Object.keys(ed);
    for (var edi = 0; edi < edKeys.length; edi++) {
      html += '<dt><code>' + edKeys[edi] + '</code></dt><dd>' + ed[edKeys[edi]] + '</dd>';
    }
    html += '</dl>';
  }

  var div = document.createElement('div');
  div.id = 'design-extraction-data';
  div.innerHTML = html;
  document.body.insertBefore(div, document.body.firstChild);
})();`

const BUILTIN_SKILLS: SkillEntry[] = [
  {
    id: 'builtin_search_web',
    name: 'search_web',
    definition: {
      type: 'function',
      function: {
        name: 'search_web',
        description: 'Fetch and render web page content with full JavaScript rendering via crawl4ai. ALWAYS use "url" when a specific URL is available — it returns the full rendered page. Use "query" ONLY when you need to discover pages about a topic you don\'t have a URL for. Use "design: true" to extract a website\'s visual design tokens (colors, fonts, spacing, etc.) instead of reading its content. Use "flags" for advanced behavior like deep crawling, stealth mode, or targeting specific page sections.',
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

function buildCrawlArgs(targetUrl: string, flags: Record<string, unknown>): string[] {
  const args: string[] = ['crawl', targetUrl, '-o', 'md-fit', '-bc']

  // Top-level flags
  if (flags.deep_crawl) {
    args.push('--deep-crawl', String(flags.deep_crawl))
    if (flags.max_pages) {
      args.push('--max-pages', String(flags.max_pages))
    }
  }

  // Browser params (-b)
  const browserParams: string[] = []
  if (flags.enable_stealth === true) browserParams.push('enable_stealth=true')
  if (flags.user_agent_mode) browserParams.push(`user_agent_mode=${flags.user_agent_mode}`)
  if (flags.avoid_ads === true) browserParams.push('avoid_ads=true')
  if (browserParams.length > 0) {
    args.push('-b', browserParams.join(','))
  }

  // Crawler params (-c)
  const crawlerParams: string[] = []
  if (flags.css_selector) crawlerParams.push(`css_selector=${flags.css_selector}`)
  if (flags.wait_until) crawlerParams.push(`wait_until=${flags.wait_until}`)
  if (flags.delay_before_return_html != null) crawlerParams.push(`delay_before_return_html=${flags.delay_before_return_html}`)
  if (flags.scan_full_page === true) crawlerParams.push('scan_full_page=true')
  if (flags.remove_overlay_elements === true) crawlerParams.push('remove_overlay_elements=true')
  if (flags.magic === true) crawlerParams.push('magic=true')
  if (flags.simulate_user === true) crawlerParams.push('simulate_user=true')
  if (flags.process_iframes === true) crawlerParams.push('process_iframes=true')
  if (flags.exclude_external_links === true) crawlerParams.push('exclude_external_links=true')
  if (flags.exclude_social_media_links === true) crawlerParams.push('exclude_social_media_links=true')
  if (flags.word_count_threshold != null) crawlerParams.push(`word_count_threshold=${flags.word_count_threshold}`)
  if (crawlerParams.length > 0) {
    args.push('-c', crawlerParams.join(','))
  }

  return args
}

function buildDesignCrawlArgs(targetUrl: string, flags: Record<string, unknown>): { args: string[]; configDir: string } {
  const configDir = mkdtempSync(join(tmpdir(), 'aura-design-'))

  const configParams: Record<string, unknown> = {
    js_code: DESIGN_EXTRACTION_JS,
    css_selector: '#design-extraction-data',
    scan_full_page: true,
    delay_before_return_html: 0.5,
  }

  if (flags.wait_until) configParams.wait_until = flags.wait_until
  if (flags.word_count_threshold != null) configParams.word_count_threshold = flags.word_count_threshold

  writeFileSync(join(configDir, 'crawler_config.json'), JSON.stringify({
    type: 'CrawlerRunConfig',
    params: configParams,
  }))

  const args: string[] = ['crawl', targetUrl, '-o', 'md-fit', '-bc', '-C', join(configDir, 'crawler_config.json')]

  if (flags.deep_crawl) {
    args.push('--deep-crawl', String(flags.deep_crawl))
    if (flags.max_pages) args.push('--max-pages', String(flags.max_pages))
  }

  const browserParams: string[] = []
  if (flags.enable_stealth === true) browserParams.push('enable_stealth=true')
  if (flags.user_agent_mode) browserParams.push(`user_agent_mode=${flags.user_agent_mode}`)
  if (flags.avoid_ads === true) browserParams.push('avoid_ads=true')
  if (browserParams.length > 0) args.push('-b', browserParams.join(','))

  return { args, configDir }
}

export class SkillsService {
  private store: FileStore

  constructor(store: FileStore) {
    this.store = store
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
      const design = args.design === true
      const query = String(args.query ?? '')
      const url = String(args.url ?? '')
      const flags = (args.flags ?? {}) as Record<string, unknown>

      if (design && !url) {
        throw new Error('The "design" flag requires a URL. Design extraction cannot be performed on search results.')
      }

      const targetUrl = url || `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`

      if (!url && !query) {
        throw new Error('Either query or url is required for search_web')
      }

      let configDir: string | null = null
      try {
        let cliArgs: string[]
        if (design) {
          const result = buildDesignCrawlArgs(targetUrl, flags)
          cliArgs = result.args
          configDir = result.configDir
        } else {
          cliArgs = buildCrawlArgs(targetUrl, flags)
        }

        const timeout = flags.deep_crawl ? 120000 : 30000
        const maxBuffer = flags.deep_crawl ? 5 * 1024 * 1024 : 1024 * 1024

        const { stdout } = await execFileAsync('crwl', cliArgs, { timeout, maxBuffer })
        let content = stdout.trim()
        if (content.length > 50000) {
          content = content.slice(0, 50000) + '\n\n[Content truncated to fit context window]'
        }
        return content || `No content returned from ${targetUrl}`
      } catch {
        if (design) {
          throw new Error('Design extraction requires crawl4ai (crwl CLI). Ensure crawl4ai is installed and the URL is accessible.')
        }
        // Fallback: plain fetch if crawl4ai is unavailable
        try {
          const response = await fetch(targetUrl, {
            signal: AbortSignal.timeout(10000),
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.7',
            },
          })
          if (!response.ok) {
            return `Error: HTTP ${response.status} ${response.statusText} for ${targetUrl}`
          }
          const text = await response.text()
          return text.length > 50000 ? text.slice(0, 50000) + '\n\n[Content truncated]' : text
        } catch (fetchErr) {
          throw new Error(`Failed to fetch ${targetUrl}: ${fetchErr instanceof Error ? fetchErr.message : String(fetchErr)}`)
        }
      } finally {
        if (configDir) {
          try { rmSync(configDir, { recursive: true, force: true }) } catch {}
        }
      }
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