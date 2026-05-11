import { test, expect } from '@playwright/test';

test.describe('Intro Sequence', () => {
  test('plays intro and transitions to chat', async ({ page }) => {
    await page.goto('/');

    const intro = page.locator('.intro-sequence');
    await expect(intro).toBeVisible({ timeout: 2000 });

    const chat = page.locator('.chat-layout');
    await expect(chat).toBeVisible({ timeout: 30000 });
  });

  test('system online text appears during intro', async ({ page }) => {
    await page.goto('/');

    const overlay = page.locator('.intro-text-overlay');
    await expect(overlay).toBeVisible({ timeout: 2000 });
    await expect(overlay).toContainText('A.U.R.A.');
  });

  test('ambient particles visible after intro', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.chat-layout', { timeout: 30000 });

    const bgCanvas = page.locator('.particle-background canvas');
    await expect(bgCanvas).toBeVisible();
  });
});