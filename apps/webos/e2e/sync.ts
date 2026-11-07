import { expect, type Page } from '@playwright/test';
import { type TestD1, testD1 } from '../../../services/sync/src/test/d1';
import syncWorker from '../../../services/sync/src/worker';
import { SYNC_SERVICE } from '../src/data/sync-service';
import { press } from './tv';

/**
 * BannerTV's account service for the journeys: the real Worker from
 * services/sync over an SQLite database in memory, shared by every screen
 * (browser context) of a test, so one screen's pushes are another's pulls.
 * Nothing leaves the test.
 */
export interface FakeSync {
  readonly db: TestD1;
  /** What each screen asked, as `METHOD /path`, in order. */
  readonly requests: string[];
  /** How many accounts may exist: 0 closes account creation, as the Worker's MAX_ACCOUNTS does. */
  maxAccounts: number;
  /** While true, the service does not answer at all. */
  down: boolean;
  /** How long each answer takes, in milliseconds: a slow connection. */
  delay: number;
  /** The Worker's CREATE_KEY secret: when set, making an account needs it. */
  createKey?: string;
}

export function fakeSync(): FakeSync {
  return { db: testD1(), requests: [], maxAccounts: 5, down: false, delay: 0 };
}

/** Routes the page's account requests to `sync`. Call after mockAddons, which answers otherwise. */
export async function mockSync(page: Page, sync: FakeSync): Promise<void> {
  await page.route(`${SYNC_SERVICE}/**`, async (route) => {
    const request = route.request();
    const url = request.url();
    sync.requests.push(`${request.method()} ${new URL(url).pathname}`);
    if (sync.down) return route.abort();
    if (sync.delay > 0) await new Promise((done) => setTimeout(done, sync.delay));
    const body = request.postData();
    const response = await syncWorker.fetch(
      new Request(url, {
        method: request.method(),
        headers: { 'Content-Type': 'text/plain' },
        body: request.method() === 'POST' ? (body ?? '') : undefined,
      }),
      {
        DB: sync.db,
        MAX_ACCOUNTS: String(sync.maxAccounts),
        PULL_MINUTES: '30',
        CREATE_KEY: sync.createKey,
      },
    );
    const headers: Record<string, string> = {};
    response.headers.forEach((value, name) => (headers[name] = value));
    return route.fulfill({ status: response.status, headers, body: await response.text() });
  });
}

/** From Home's first tile to Settings, through the rail. */
export async function openSettings(
  page: Page,
  rail = ['search', 'discover', 'library', 'addons', 'settings'],
): Promise<void> {
  await press(page, 'ArrowLeft', 'rail-home');
  for (const item of rail) await press(page, 'ArrowDown', `rail-${item}`);
  await press(page, 'Enter', 'settings-stream-choice');
}

/** From the top of Settings to BannerTV account. */
export async function openAccount(page: Page, focus: string): Promise<void> {
  await press(page, 'ArrowRight', 'settings-profiles');
  await press(page, 'ArrowDown', 'settings-home-rows');
  await press(page, 'ArrowDown', 'settings-account');
  await press(page, 'Enter', focus);
}

/** The account code on screen, as the person would copy it. */
export async function shownCode(page: Page): Promise<string> {
  const code = page.locator('[data-account-code]');
  await expect(code).toBeVisible();
  return (await code.getAttribute('data-account-code')) ?? '';
}

/** Types into the text box that has focus, as with the TV keyboard: OK, the text, OK. */
export async function typeInto(page: Page, label: string, text: string): Promise<void> {
  await page.keyboard.press('Enter');
  const input = page.locator(`input[aria-label="${label}"]`);
  await expect(input).toBeFocused();
  await page.keyboard.type(text);
}
