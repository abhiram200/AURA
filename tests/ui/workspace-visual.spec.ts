import { test, expect } from '@playwright/test'

const PROJECT_URL = 'http://localhost:5173/project-mode/proj_c02b6a58-b53d-4bce-9bcf-e42ccc0fc407'

test.describe('Workspace IDE Visual Check', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(PROJECT_URL)
    await page.waitForLoadState('networkidle')
    // Click on Workspace tab
    await page.click('button:has-text("Workspace")')
    await page.waitForTimeout(1000)
  })

  test('screenshot: workspace loads with layout', async ({ page }) => {
    await page.screenshot({ path: 'test-results/01-workspace-layout.png', fullPage: true })
  })

  test('file explorer: shows directory tree', async ({ page }) => {
    // Wait for file tree to load
    await page.waitForTimeout(1000)
    await page.screenshot({ path: 'test-results/02-file-explorer.png', fullPage: true })

    // Check if file entries are visible
    const fileItems = page.locator('.file-explorer__item')
    const count = await fileItems.count()
    console.log(`File items found: ${count}`)

    // Expand src directory
    const srcDir = page.locator('.file-explorer__item:has-text("src")')
    if (await srcDir.count() > 0) {
      await srcDir.click()
      await page.waitForTimeout(500)
      await page.screenshot({ path: 'test-results/03-file-explorer-expanded.png', fullPage: true })
    }
  })

  test('file opening: click file opens in editor', async ({ page }) => {
    await page.waitForTimeout(1000)

    // Try clicking a file
    const packageJson = page.locator('.file-explorer__item:has-text("package.json")')
    if (await packageJson.count() > 0) {
      await packageJson.click()
      await page.waitForTimeout(500)
      await page.screenshot({ path: 'test-results/04-file-opened.png', fullPage: true })
    }

    // Check if editor tab appeared
    const editorTab = page.locator('.editor-tab')
    const tabCount = await editorTab.count()
    console.log(`Editor tabs found: ${tabCount}`)

    // Check if CodeMirror editor loaded
    const cmEditor = page.locator('.cm-editor')
    const editorCount = await cmEditor.count()
    console.log(`CodeMirror editors found: ${editorCount}`)
  })

  test('status bar: shows info', async ({ page }) => {
    await page.waitForTimeout(1000)
    const statusBar = page.locator('.status-bar')
    if (await statusBar.count() > 0) {
      await page.screenshot({ path: 'test-results/05-status-bar.png', fullPage: true })
    }
  })

  test('terminal: toggle open/close', async ({ page }) => {
    await page.waitForTimeout(1000)

    // Press Ctrl+` to open terminal
    await page.keyboard.down('Control')
    await page.keyboard.press('`')
    await page.keyboard.up('Control')
    await page.waitForTimeout(500)
    await page.screenshot({ path: 'test-results/06-terminal-opened.png', fullPage: true })

    // Click "Start Terminal" button
    const startBtn = page.locator('button:has-text("Start Terminal")')
    if (await startBtn.count() > 0) {
      await startBtn.click()
      await page.waitForTimeout(1000)
      await page.screenshot({ path: 'test-results/07-terminal-started.png', fullPage: true })
    }

    // Press Ctrl+` to close terminal
    await page.keyboard.down('Control')
    await page.keyboard.press('`')
    await page.keyboard.up('Control')
    await page.waitForTimeout(500)
    await page.screenshot({ path: 'test-results/08-terminal-closed.png', fullPage: true })
  })

  test('explorer: toggle open/close', async ({ page }) => {
    await page.waitForTimeout(1000)

    // Press Ctrl+B to toggle explorer
    await page.keyboard.down('Control')
    await page.keyboard.press('b')
    await page.keyboard.up('Control')
    await page.waitForTimeout(500)
    await page.screenshot({ path: 'test-results/09-explorer-hidden.png', fullPage: true })

    // Toggle back
    await page.keyboard.down('Control')
    await page.keyboard.press('b')
    await page.keyboard.up('Control')
    await page.waitForTimeout(500)
    await page.screenshot({ path: 'test-results/10-explorer-shown.png', fullPage: true })
  })

  test('multiple files: open multiple tabs', async ({ page }) => {
    await page.waitForTimeout(1000)

    // Expand src if needed
    const srcDir = page.locator('.file-explorer__item:has-text("src")')
    if (await srcDir.count() > 0) {
      await srcDir.click()
      await page.waitForTimeout(500)
    }

    // Open package.json
    const pkg = page.locator('.file-explorer__item:has-text("package.json")')
    if (await pkg.count() > 0) {
      await pkg.click()
      await page.waitForTimeout(300)
    }

    // Open index.html
    const html = page.locator('.file-explorer__item:has-text("index.html")')
    if (await html.count() > 0) {
      await html.click()
      await page.waitForTimeout(300)
    }

    await page.screenshot({ path: 'test-results/11-multiple-tabs.png', fullPage: true })
  })

  test('resize panels: drag explorer width', async ({ page }) => {
    await page.waitForTimeout(1000)

    const handle = page.locator('.panel-resize-handle--horizontal')
    if (await handle.count() > 0) {
      const box = await handle.boundingBox()
      if (box) {
        await page.mouse.move(box.x, box.y)
        await page.mouse.down()
        await page.mouse.move(box.x + 50, box.y)
        await page.mouse.up()
        await page.waitForTimeout(300)
        await page.screenshot({ path: 'test-results/12-resized-explorer.png', fullPage: true })
      }
    }
  })

  test('quick file open: Ctrl+P search', async ({ page }) => {
    await page.waitForTimeout(1000)

    // Press Ctrl+P to open quick search
    await page.keyboard.down('Control')
    await page.keyboard.press('p')
    await page.keyboard.up('Control')
    await page.waitForTimeout(300)
    await page.screenshot({ path: 'test-results/13-quick-open.png', fullPage: true })

    // Type a search query
    const input = page.locator('.quick-open__input')
    if (await input.count() > 0) {
      await input.fill('package')
      await page.waitForTimeout(500)
      await page.screenshot({ path: 'test-results/14-quick-open-results.png', fullPage: true })

      // Check results appeared
      const results = page.locator('.quick-open__result')
      const count = await results.count()
      console.log(`Quick open results found: ${count}`)

      // Press Escape to close
      await page.keyboard.press('Escape')
      await page.waitForTimeout(200)
    }
  })

  test('save file: Ctrl+S with dirty indicator', async ({ page }) => {
    await page.waitForTimeout(1000)

    // Open a file
    const pkg = page.locator('.file-explorer__item:has-text("package.json")')
    if (await pkg.count() > 0) {
      await pkg.click()
      await page.waitForTimeout(500)
    }

    // Type in the CodeMirror editor to make it dirty
    const cmEditor = page.locator('.cm-editor')
    if (await cmEditor.count() > 0) {
      await cmEditor.click()
      await page.keyboard.type('// test edit')
      await page.waitForTimeout(300)
      await page.screenshot({ path: 'test-results/15-dirty-file.png', fullPage: true })

      // Check for dirty dot indicator
      const dirtyDot = page.locator('.editor-tab__dot')
      const dotCount = await dirtyDot.count()
      console.log(`Dirty dot indicators found: ${dotCount}`)
    }
  })
})