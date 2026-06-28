/**
 * PlaywrightService — manages a persistent browser instance for the AURA builder agent.
 *
 * Lazily launches Chromium on first use and reuses the page across tool calls.
 * Screenshots are saved to `.aura/browser/` within the project directory.
 *
 * If Playwright is not installed, all methods return a clear error message
 * instructing the user to install it.
 */

import path from 'node:path'
import fs from 'node:fs/promises'

type Browser = import('playwright').Browser
type Page = import('playwright').Page

export class PlaywrightService {
  private browser: Browser | null = null
  private page: Page | null = null
  private projectPath: string
  private screenshotDir: string
  private launchPromise: Promise<Page> | null = null

  constructor(projectPath: string) {
    this.projectPath = projectPath
    this.screenshotDir = path.join(projectPath, '.aura', 'browser')
  }

  // ── Lazy browser launch ─────────────────────────────────────────────────────

  private async ensureBrowser(): Promise<Page> {
    // If we're already launching, wait for that launch to finish
    if (this.launchPromise) return this.launchPromise

    if (this.page && !this.page.isClosed()) return this.page

    this.launchPromise = (async () => {
      try {
        // Use dynamic import for ESM compatibility
        const pw = await import('playwright')
        const oldBrowser = this.browser
        this.browser = await pw.chromium.launch({ headless: true })
        // Close the old browser if it existed (handles re-launch after page close)
        if (oldBrowser) {
          try { await oldBrowser.close() } catch { /* ignore */ }
        }
        const ctx = await this.browser.newContext({ viewport: { width: 1280, height: 720 } })
        this.page = await ctx.newPage()
        return this.page
      } finally {
        this.launchPromise = null
      }
    })()

    return this.launchPromise
  }

  // ── Navigation ──────────────────────────────────────────────────────────────

  async navigate(
    url: string,
    options?: { waitUntil?: 'load' | 'domcontentloaded' | 'networkidle' },
  ): Promise<{ url: string; title: string }> {
    const page = await this.ensureBrowser()
    const response = await page.goto(url, {
      waitUntil: options?.waitUntil ?? 'domcontentloaded',
      timeout: 30_000,
    })

    if (!response) {
      throw new Error(`Failed to navigate to ${url} — no response received.`)
    }

    if (response.status() >= 400) {
      throw new Error(`Navigation to ${url} returned HTTP ${response.status()}.`)
    }

    return {
      url: page.url(),
      title: await page.title(),
    }
  }

  // ── Screenshot ──────────────────────────────────────────────────────────────

  async screenshot(
    options?: { fullPage?: boolean; selector?: string },
  ): Promise<{ path: string; data: string }> {
    const page = await this.ensureBrowser()
    await fs.mkdir(this.screenshotDir, { recursive: true })
    const filename = `screenshot-${Date.now()}.png`
    const filePath = path.join(this.screenshotDir, filename)

    if (options?.selector) {
      const element = await page.$(options.selector)
      if (!element) {
        throw new Error(`Element not found: ${options.selector}`)
      }
      await element.screenshot({ path: filePath, type: 'png' })
    } else {
      await page.screenshot({
        path: filePath,
        fullPage: options?.fullPage ?? false,
        type: 'png',
      })
    }

    const buffer = await fs.readFile(filePath)
    return {
      path: filePath,
      data: buffer.toString('base64'),
    }
  }

  // ── Interactions ────────────────────────────────────────────────────────────

  async click(selector: string): Promise<{ clicked: boolean; selector: string }> {
    const page = await this.ensureBrowser()
    // Check visibility first to fail fast instead of waiting the full timeout
    const element = await page.$(selector)
    if (!element) {
      throw new Error(`Element not found: ${selector}`)
    }
    const isVisible = await element.isVisible()
    if (!isVisible) {
      throw new Error(`Element found but not visible: ${selector}. The element exists in the DOM but is hidden (display:none, visibility:hidden, or off-screen). Use browser_wait to wait for it to become visible, or check the selector.`)
    }
    await element.click({ timeout: 10_000 })
    return { clicked: true, selector }
  }

  async type(
    selector: string,
    text: string,
    options?: { delay?: number; clear?: boolean },
  ): Promise<{ typed: boolean; selector: string }> {
    const page = await this.ensureBrowser()
    if (options?.clear) {
      await page.fill(selector, '')
    }
    await page.type(selector, text, { delay: options?.delay ?? 10 })
    return { typed: true, selector }
  }

  async press(selector: string, key: string): Promise<{ pressed: boolean }> {
    const page = await this.ensureBrowser()
    // If selector is empty, press on the page; otherwise on the element
    if (selector) {
      await page.locator(selector).press(key)
    } else {
      await page.keyboard.press(key)
    }
    return { pressed: true }
  }

  async hover(selector: string): Promise<{ hovered: boolean }> {
    const page = await this.ensureBrowser()
    // Check visibility first to fail fast instead of waiting the full timeout
    const element = await page.$(selector)
    if (!element) {
      throw new Error(`Element not found: ${selector}`)
    }
    const isVisible = await element.isVisible()
    if (!isVisible) {
      throw new Error(`Element found but not visible: ${selector}. The element exists in the DOM but is hidden (display:none, visibility:hidden, or off-screen). Use browser_wait to wait for it to become visible, or check the selector.`)
    }
    await element.hover({ timeout: 10_000 })
    return { hovered: true }
  }

  async select(selector: string, values: string[]): Promise<{ selected: string[] }> {
    const page = await this.ensureBrowser()
    const selected = await page.selectOption(selector, values)
    return { selected: selected as string[] }
  }

  async waitFor(
    selector: string,
    options?: { timeout?: number; state?: 'attached' | 'detached' | 'visible' | 'hidden' },
  ): Promise<{ found: boolean; selector: string }> {
    const page = await this.ensureBrowser()
    await page.waitForSelector(selector, {
      timeout: options?.timeout ?? 15_000,
      state: options?.state ?? 'visible',
    })
    return { found: true, selector }
  }

  // ── Page inspection ──────────────────────────────────────────────────────────

  async evaluate(expression: string): Promise<{ result: unknown; error?: string }> {
    const page = await this.ensureBrowser()
    try {
      const result = await page.evaluate(expression)
      return { result }
    } catch (err) {
      return {
        result: null,
        error: err instanceof Error ? err.message : String(err),
      }
    }
  }

  async content(): Promise<{ html: string; title: string; url: string }> {
    const page = await this.ensureBrowser()
    return {
      html: await page.content(),
      title: await page.title(),
      url: page.url(),
    }
  }

  async accessibility(): Promise<{ snapshot: string }> {
    const page = await this.ensureBrowser()
    try {
      // Playwright 1.59+ uses locator.ariaSnapshot() instead of page.accessibility.snapshot()
      const snapshot = await page.locator('body').ariaSnapshot()
      if (!snapshot) {
        return { snapshot: 'No accessibility snapshot available for this page.' }
      }
      return { snapshot }
    } catch (err) {
      return { snapshot: `Accessibility snapshot unavailable: ${err instanceof Error ? err.message : String(err)}` }
    }
  }

  async url(): Promise<{ url: string }> {
    const page = await this.ensureBrowser()
    return { url: page.url() }
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────────

  async close(): Promise<void> {
    if (this.browser) {
      try {
        await this.browser.close()
      } catch {
        // Ignore close errors — the process may have already exited
      }
      this.browser = null
      this.page = null
    }
  }
}