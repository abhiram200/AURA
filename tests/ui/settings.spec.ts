import { test, expect } from '@playwright/test';

test.describe('Settings Panel', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.chat-layout', { timeout: 30000 });
  });

  test('opens and closes settings panel', async ({ page }) => {
    const settingsBtn = page.locator('button:has-text("Settings")');
    await settingsBtn.click();

    const panel = page.locator('.settings-panel');
    await expect(panel).toBeVisible();

    const closeBtn = page.locator('.settings-panel__close');
    await closeBtn.click();
    await expect(panel).not.toBeVisible();
  });

  test('can edit system prompt', async ({ page }) => {
    await page.locator('button:has-text("Settings")').click();

    const textarea = page.locator('.system-prompt-editor__textarea');
    await textarea.fill('You are a helpful coding assistant.');
    await expect(textarea).toHaveValue('You are a helpful coding assistant.');
  });

  test('can change animation intensity', async ({ page }) => {
    await page.locator('button:has-text("Settings")').click();

    const select = page.locator('.user-preferences__select');
    await select.selectOption('intense');
    await expect(select).toHaveValue('intense');
  });
});

test.describe('Theme Toggle', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.chat-layout', { timeout: 30000 });
  });

  test('switches from dark to light theme', async ({ page }) => {
    const root = page.locator('html');
    await expect(root).toHaveClass(/dark/);

    const toggle = page.locator('.theme-toggle').first();
    await toggle.click();

    await expect(root).toHaveClass(/light/);
  });

  test('switches back to dark theme', async ({ page }) => {
    const toggle = page.locator('.theme-toggle').first();
    await toggle.click();
    await toggle.click();

    const root = page.locator('html');
    await expect(root).toHaveClass(/dark/);
  });
});