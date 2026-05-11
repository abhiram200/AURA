import { test, expect } from '@playwright/test';

test.describe('Responsive Layout', () => {
  test('sidebar collapses on mobile viewport', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.chat-layout', { timeout: 30000 });

    await page.setViewportSize({ width: 375, height: 812 });

    const sidebar = page.locator('.sidebar');
    await expect(sidebar).not.toBeVisible();
  });

  test('chat layout adapts to tablet viewport', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.chat-layout', { timeout: 30000 });

    await page.setViewportSize({ width: 768, height: 1024 });

    const chatMain = page.locator('.chat-layout__main');
    await expect(chatMain).toBeVisible();
  });

  test('input bar remains accessible on all viewports', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.chat-layout', { timeout: 30000 });

    await page.setViewportSize({ width: 375, height: 812 });

    const input = page.locator('.chat-input__textarea');
    await expect(input).toBeVisible();
  });
});