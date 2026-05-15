import { execFile } from 'child_process'
import { promisify } from 'util'
import { mkdtempSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const execFileAsync = promisify(execFile)

// ── Design extraction JS ──────────────────────────────────────────────────────

export const DESIGN_EXTRACTION_JS = `
(async () => {
  const allCSS = [...document.styleSheets].flatMap(sheet => {
    try { return [...sheet.cssRules] } catch { return [] }
  });
  const vars = {};
  allCSS.forEach(rule => {
    if (rule.selectorText === ':root' || rule.selectorText?.startsWith(':root')) {
      for (const s of rule.style) {
        if (s.startsWith('--')) vars[s] = rule.style.getPropertyValue(s).trim();
      }
    }
  });
  const colors = new Set();
  allCSS.forEach(rule => {
    const v = rule.cssText;
    for (const m of v.matchAll(/(?:color|background[^-]*)\\s*:\\s*([^;]+)/gi)) colors.add(m[1].trim());
  });
  const fonts = new Set();
  allCSS.forEach(rule => {
    const v = rule.cssText;
    for (const m of v.matchAll(/font-family\\s*:\\s*([^;]+)/gi)) fonts.add(m[1].trim());
  });
  const spacing = new Set();
  allCSS.forEach(rule => {
    const v = rule.cssText;
    for (const m of v.matchAll(/(?:padding|margin|gap)\\s*:\\s*([^;]+)/gi)) spacing.add(m[1].trim());
  });
  const radii = new Set();
  allCSS.forEach(rule => {
    const v = rule.cssText;
    for (const m of v.matchAll(/border-radius\\s*:\\s*([^;]+)/gi)) radii.add(m[1].trim());
  });
  const shadows = new Set();
  allCSS.forEach(rule => {
    const v = rule.cssText;
    for (const m of v.matchAll(/box-shadow\\s*:\\s*([^;]+)/gi)) shadows.add(m[1].trim());
  });
  const el = document.createElement('div');
  el.id = 'design-extraction-data';
  el.style.display = 'none';
  el.textContent = JSON.stringify({ cssVariables: vars, colors: [...colors], fonts: [...fonts], spacing: [...spacing], borderRadii: [...radii], shadows: [...shadows] });
  document.body.appendChild(el);
})();
`

// ── Crawl4ai CLI argument builders ───────────────────────────────────────────

export function buildCrawlArgs(targetUrl: string, flags: Record<string, unknown>): string[] {
  const args: string[] = ['crawl', targetUrl, '-o', 'md-fit', '-bc']

  if (flags.deep_crawl) {
    args.push('--deep-crawl', String(flags.deep_crawl))
    if (flags.max_pages) args.push('--max-pages', String(flags.max_pages))
  }

  const browserParams: string[] = []
  if (flags.enable_stealth === true) browserParams.push('enable_stealth=true')
  if (flags.user_agent_mode) browserParams.push(`user_agent_mode=${flags.user_agent_mode}`)
  if (flags.avoid_ads === true) browserParams.push('avoid_ads=true')
  if (browserParams.length > 0) args.push('-b', browserParams.join(','))

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
  if (crawlerParams.length > 0) args.push('-c', crawlerParams.join(','))

  return args
}

export function buildDesignCrawlArgs(targetUrl: string, flags: Record<string, unknown>): { args: string[]; configDir: string } {
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

export { execFileAsync }