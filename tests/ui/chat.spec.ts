import { test, expect } from '@playwright/test';

test.describe('Chat Message Flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Wait for intro to complete
    await page.waitForSelector('.chat-layout', { timeout: 30000 });
  });

  test('displays mock conversations in sidebar', async ({ page }) => {
    const items = page.locator('.conversation-item');
    await expect(items).toHaveCount(3);
  });

  test('displays messages in active conversation', async ({ page }) => {
    const messages = page.locator('.ai-message');
    await expect(messages.first()).toBeVisible();
  });

  test('user can send a message', async ({ page }) => {
    const input = page.locator('.chat-input__textarea');
    await input.fill('Hello, AI!');
    await input.press('Enter');

    const userMsg = page.locator('.user-message__bubble').last();
    await expect(userMsg).toContainText('Hello, AI!');
  });

  test('AI responds with streaming effect', async ({ page }) => {
    const input = page.locator('.chat-input__textarea');
    await input.fill('Test message');
    await input.press('Enter');

    // Typing indicator appears
    const typing = page.locator('.typing-indicator__dot').first();
    await expect(typing).toBeVisible({ timeout: 2000 });

    // AI message appears
    const aiMsg = page.locator('.ai-message__card').last();
    await expect(aiMsg).toBeVisible({ timeout: 5000 });
  });

  test('markdown renders in AI messages', async ({ page }) => {
    const codeBlock = page.locator('.code-block').first();
    await expect(codeBlock).toBeVisible();
  });

  test('copy button exists on code blocks', async ({ page }) => {
    const copyBtn = page.locator('.code-block__copy').first();
    await expect(copyBtn).toBeVisible();
  });
});

test.describe('Sidebar', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.chat-layout', { timeout: 30000 });
  });

  test('can switch conversations', async ({ page }) => {
    const items = page.locator('.conversation-item');
    await items.nth(1).click();

    const activeItem = page.locator('.conversation-item--active');
    await expect(activeItem).toBeVisible();
  });

  test('can create new conversation', async ({ page }) => {
    const newBtn = page.locator('.sidebar__new-btn');
    await newBtn.click();

    const items = page.locator('.conversation-item');
    await expect(items).toHaveCount(4);
  });

  test('can toggle sidebar', async ({ page }) => {
    const toggleBtn = page.locator('.sidebar__toggle');

    // Sidebar should be visible initially
    const sidebar = page.locator('.sidebar');
    await expect(sidebar).toBeVisible();

    // Click to close — AnimatePresence will remove the element from DOM
    await toggleBtn.click();
    await expect(sidebar).not.toBeVisible();

    // Click to open
    await toggleBtn.click();
    await expect(sidebar).toBeVisible();
  });
});