import { test, expect } from '@playwright/test'

test.describe('Backend Settings', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForSelector('.chat-layout', { timeout: 30000 })

    // Dismiss onboarding if present
    const onboarding = page.locator('.onboarding-modal')
    if (await onboarding.isVisible()) {
      await page.locator('.onboarding-modal__skip-all').click()
    }
  })

  test('shows model selection in settings', async ({ page }) => {
    await page.locator('button:has-text("Settings")').click()
    const modelSection = page.locator('.model-selection')
    await expect(modelSection).toBeVisible()
  })

  test('shows context settings in settings panel', async ({ page }) => {
    await page.locator('button:has-text("Settings")').click()
    const contextSection = page.locator('.context-settings')
    await expect(contextSection).toBeVisible()
  })

  test('shows memory manager in settings panel', async ({ page }) => {
    await page.locator('button:has-text("Settings")').click()
    const memorySection = page.locator('.memory-manager')
    await expect(memorySection).toBeVisible()
  })

  test('can add a memory entry', async ({ page }) => {
    await page.locator('button:has-text("Settings")').click()
    const memoryInput = page.locator('.memory-manager__input')
    await memoryInput.fill('Test memory fact')
    await page.locator('.memory-manager__add-btn').click()
    const addedMemory = page.locator('.memory-manager__fact', { hasText: 'Test memory fact' })
    await expect(addedMemory).toBeVisible()
  })

  test('shows skills manager in settings panel', async ({ page }) => {
    await page.locator('button:has-text("Settings")').click()
    const skillsSection = page.locator('.skills-manager')
    await expect(skillsSection).toBeVisible()
  })

  test('can open add skill modal', async ({ page }) => {
    await page.locator('button:has-text("Settings")').click()
    await page.locator('.skills-manager__add-btn').click()
    const modal = page.locator('.skills-manager__modal')
    await expect(modal).toBeVisible()
    // Verify the example is shown
    const example = page.locator('.skills-manager__example')
    await expect(example).toBeVisible()
  })
})