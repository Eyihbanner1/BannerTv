import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, type Page } from '@playwright/test';

export const APP_URL = pathToFileURL(resolve(import.meta.dirname, '../dist/index.html')).href;

// A person's pace between presses. Quicker presses all count too; a journey tests that.
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

/** Waits for focus to land on the element Audio Guidance would read as `label`. */
export async function expectFocusLabel(page: Page, label: string): Promise<void> {
  await expect(page.locator('[data-focused="true"]')).toHaveAttribute('aria-label', label);
}

/** Presses a remote key and waits for focus to land on the element labelled `label`. */
export async function pressTo(page: Page, key: string, label: string): Promise<void> {
  await page.keyboard.press(key);
  await expectFocusLabel(page, label);
  await page.waitForTimeout(KEY_GAP_MS);
}

const SECTIONS = ['home', 'search', 'discover', 'library', 'addons', 'settings'];

/** From Home's first tile, opens a section through the rail. */
export async function openSection(page: Page, section: string): Promise<void> {
  await press(page, 'ArrowLeft', 'rail-home');
  for (const item of SECTIONS.slice(1, SECTIONS.indexOf(section) + 1)) {
    await press(page, 'ArrowDown', `rail-${item}`);
  }
  await page.keyboard.press('Enter');
  await page.waitForTimeout(KEY_GAP_MS);
}
