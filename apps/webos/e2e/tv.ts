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

/**
 * Waits until focus is not on a row or grid tile whose catalog has yet to answer. Such a tile
 * takes focus and says "Loading" (home.loadingTile), and OK on it opens nothing, so a person
 * waits for the title to show before pressing OK. Arrows on it are fine: journeys test those.
 */
export async function expectLoadedFocus(page: Page): Promise<void> {
  await expect(page.locator('[data-focused="true"][aria-label="Loading"]')).toHaveCount(0);
}

/**
 * Presses a remote key and waits for focus to land on `focusKey`. OK waits first for a
 * loading tile under focus to show its title, as a person would.
 */
export async function press(page: Page, key: string, focusKey: string): Promise<void> {
  if (key === 'Enter') await expectLoadedFocus(page);
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

/**
 * Presses a remote key and waits for focus to land on the element labelled `label`. OK
 * waits first for a loading tile under focus to show its title, as `press` does.
 */
export async function pressTo(page: Page, key: string, label: string): Promise<void> {
  if (key === 'Enter') await expectLoadedFocus(page);
  await page.keyboard.press(key);
  await expectFocusLabel(page, label);
  await page.waitForTimeout(KEY_GAP_MS);
}

/** The rail's sections, top down, as the page shows them: Sports only with a sports addon. */
export async function railSections(page: Page): Promise<string[]> {
  const keys = await page
    .locator('nav [data-focus-key^="rail-"]')
    .evaluateAll((items) => items.map((item) => item.getAttribute('data-focus-key') ?? ''));
  return keys.map((key) => key.replace(/^rail-/, ''));
}

/** From Home's first tile, opens a section through the rail. */
export async function openSection(page: Page, section: string): Promise<void> {
  await press(page, 'ArrowLeft', 'rail-home');
  const sections = await railSections(page);
  for (const item of sections.slice(1, sections.indexOf(section) + 1)) {
    await press(page, 'ArrowDown', `rail-${item}`);
  }
  await page.keyboard.press('Enter');
  await page.waitForTimeout(KEY_GAP_MS);
}

/** The focus key of what has focus now, or '' when nothing has. */
export async function focusedKey(page: Page): Promise<string> {
  return (await page.locator('[data-focused="true"]').getAttribute('data-focus-key')) ?? '';
}

/**
 * Whether the stack of rows that holds `rowKey` has slid that row to the
 * top of its window, as Home, Search and Sports do with the focused row.
 */
export function slidTo(page: Page, rowKey: string): Promise<boolean> {
  return page.locator(`[data-row-key="${rowKey}"]`).evaluate((row: HTMLElement) => {
    const transform = row.parentElement?.style.transform ?? '';
    return row.offsetTop === 0
      ? transform === '' || transform === 'translateY(0px)'
      : transform === `translateY(${-row.offsetTop}px)`;
  });
}
