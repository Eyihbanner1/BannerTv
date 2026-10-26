import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, type Page } from '@playwright/test';

export const APP_URL = pathToFileURL(resolve(import.meta.dirname, '../dist/index.html')).href;

// Spatial navigation drops key presses closer together than 100 ms, like a held key.
const KEY_GAP_MS = 120;

/** Collects page errors and console errors, which should stay empty. */
export function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  return errors;
}

export async function expectFocus(page: Page, focusKey: string): Promise<void> {
  await expect(page.locator('[data-focused="true"]')).toHaveAttribute('data-focus-key', focusKey);
}

/** Presses a remote key and waits for focus to land on `focusKey`. */
export async function press(page: Page, key: string, focusKey: string): Promise<void> {
  await page.keyboard.press(key);
  await expectFocus(page, focusKey);
  await page.waitForTimeout(KEY_GAP_MS);
}

/** The LG Back key: keyCode 461, which a desktop keyboard cannot type. */
export async function pressBack(page: Page): Promise<void> {
  await page.evaluate(() => {
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'keyCode', { get: () => 461 });
    Object.defineProperty(event, 'which', { get: () => 461 });
    (document.activeElement ?? document.body).dispatchEvent(event);
  });
  await page.waitForTimeout(KEY_GAP_MS);
}
