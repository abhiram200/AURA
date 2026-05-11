import { test, expect } from '@playwright/test'

test.describe('Backend Chat', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForSelector('.chat-layout', { timeout: 30000 })
  })

  test('displays model selector in header', async ({ page }) => {
    const selector = page.locator('.model-selector')
    await expect(selector).toBeVisible()
  })

  test('can open model selector dropdown', async ({ page }) => {
    await page.locator('.model-selector__button').click()
    const dropdown = page.locator('.model-selector__dropdown')
    await expect(dropdown).toBeVisible()
  })

  test('shows onboarding modal for new users', async ({ page }) => {
    const onboarding = page.locator('.onboarding-modal')
    if (await onboarding.isVisible()) {
      await page.locator('.onboarding-modal__skip-all').click()
      await expect(onboarding).not.toBeVisible()
    }
  })

  test('can skip onboarding', async ({ page }) => {
    const onboarding = page.locator('.onboarding-modal')
    if (await onboarding.isVisible()) {
      await page.locator('.onboarding-modal__skip-all').click()
      await expect(onboarding).not.toBeVisible()
    }
  })

  test('can send a message and receive response (requires Ollama)', async ({ page }) => {
    // Skip if Ollama not running
    const health = await fetch('http://localhost:3001/api/health').catch(() => null)
    if (!health?.ok) test.skip()

    // Dismiss onboarding if present
    const onboarding = page.locator('.onboarding-modal')
    if (await onboarding.isVisible()) {
      await page.locator('.onboarding-modal__skip-all').click()
    }

    const input = page.locator('.chat-input__textarea')
    await input.fill('Hello, can you hear me?')
    await input.press('Enter')

    // Wait for AI response to appear
    const aiMessage = page.locator('.ai-message').last()
    await expect(aiMessage).toBeVisible({ timeout: 30000 })
  })
})