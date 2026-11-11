import { expect, test, type Page } from '@playwright/test';
import { mockAddons } from '../../webos/e2e/addons.ts';
import { lockedWith, main, seedProfiles } from '../../webos/e2e/profiles.ts';

/*
 * Problems and Send a report on the phone: the crash screen instead of a blank one, and the
 * report Android's share sheet gets, which must never carry an addon's keys, a link's path, an
 * email address or a token. The web build shares through the browser's navigator.share, which
 * these journeys stand in for to read what was shared.
 */

const KIDS = 'kids23';

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

async function openApp(page: Page): Promise<void> {
  await page.route(/^http:\/\/localhost:8765\//, (route) => route.continue());
  await page.goto('/');
}

interface Shared {
  text: string;
  title: string;
}

/** What the page shared, and whether a share should fail, as with no share sheet. */
interface SharePage {
  shared: Shared[];
  refuse?: boolean;
}

/** Keeps what the app shares; a share started while `refuse` is set fails. */
async function catchShares(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const shares = window as unknown as SharePage;
    shares.shared = [];
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async (data: Shared) => {
        if (shares.refuse) throw new DOMException('No share sheet', 'NotAllowedError');
        shares.shared.push(data);
      },
    });
  });
}

async function lastShared(page: Page): Promise<Shared> {
  const shared = () => page.evaluate(() => (window as unknown as SharePage).shared);
  await expect.poll(async () => (await shared()).length).toBeGreaterThan(0);
  return (await shared()).at(-1)!;
}

/** The secrets the problems below carry, none of which may reach a report. */
const SECRETS = [
  'realdebrid=',
  'ABCDEFGHJKMNPQRST234',
  'manifest.json',
  'ada@example.com',
  's3cr3tTraktToken',
  'K7QM',
  'private-sports-id',
];

/** A browser function Settings uses as it draws is made to fail, as a bug in a screen would. */
async function breakDrawing(page: Page, message: string): Promise<void> {
  await page.evaluate((text) => {
    Intl.PluralRules.prototype.select = () => {
      throw new Error(text);
    };
  }, message);
}

test('Send a report shares recent problems without links, keys or emails, also after a restart', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await catchShares(page);
  await mockAddons(page);
  await openApp(page);
  await page.getByRole('tab', { name: 'Search' }).click();
  await page.getByRole('tab', { name: 'Settings' }).click();

  // With nothing gone wrong, the report still has the app, the phone and the screens.
  await page.getByRole('button', { name: /^Send a report/ }).click();
  let report = await lastShared(page);
  expect(report.title).toBe('BannerTV phone report');
  expect(report.text).toContain('BannerTV phone report');
  expect(report.text).toContain('built-in code, takes no updates');
  expect(report.text).toContain('Screen: /settings');
  expect(report.text).toMatch(/Recent screens: \/ [\d:]+, \/search [\d:]+, \/settings [\d:]+/);
  expect(report.text).toContain('No problems recorded.');

  // An error nothing caught, and a promise nothing handled, each quoting secrets.
  await page.evaluate(() => {
    setTimeout(() => {
      throw new Error(
        'Injected: addon failed https://torrentio.strem.fun/realdebrid=ABCDEFGHJKMNPQRST234/manifest.json for ada@example.com',
      );
    }, 0);
    void Promise.reject(
      new Error(
        'Injected: Trakt said no to token=s3cr3tTraktToken for account K7QM 3XTP W9RD HE4A 6BNC at https://sports.example/private-sports-id/live.json',
      ),
    );
  });
  await expect.poll(() => errors.length).toBe(2);

  await page.getByRole('button', { name: /^Send a report/ }).click();
  await expect.poll(async () => (await lastShared(page)).text).toContain('2 problems');
  report = await lastShared(page);
  expect(report.text).toContain('Unhandled promise on /settings');
  expect(report.text).toContain('Error on /settings');
  expect(report.text).toContain(
    'Error: Injected: addon failed https://torrentio.strem.fun/… for [email]',
  );
  expect(report.text).toContain('https://sports.example/…');
  for (const secret of SECRETS) expect(report.text).not.toContain(secret);

  // The problems are kept on the phone: at the next launch they are still in the report.
  await page.goto('/');
  await page.getByRole('tab', { name: 'Settings' }).click();
  await page.getByRole('button', { name: /^Send a report/ }).click();
  await expect.poll(async () => (await lastShared(page)).text).toContain('2 problems');
  for (const secret of SECRETS) expect((await lastShared(page)).text).not.toContain(secret);
  expect(
    JSON.stringify(await page.evaluate(() => localStorage.getItem('bannertv.phone.problems'))),
  ).not.toMatch(/realdebrid=|s3cr3t|ada@example|K7QM/);

  // With no share sheet, the row says so.
  await page.evaluate(() => {
    (window as unknown as { refuse: boolean }).refuse = true;
  });
  await page.getByRole('button', { name: /^Send a report/ }).click();
  await expect(page.getByText('Couldn’t share', { exact: true })).toBeVisible();
  expect(errors.every((message) => message.includes('Injected'))).toBe(true);
});

test('a screen that fails to draw shows Something went wrong, with Send a report and Start again', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await catchShares(page);
  await mockAddons(page);
  await openApp(page);
  await expect(page.getByRole('tab', { name: 'Settings' })).toBeVisible();

  await breakDrawing(
    page,
    'Injected: drawing failed near https://addon.example/abc123secret/manifest.json',
  );
  await page.getByRole('tab', { name: 'Settings' }).click();
  await expect(page.getByText('Something went wrong')).toBeVisible();
  await expect(page.getByText(/Starting again usually sorts it/)).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Settings' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Send a report' }).click();
  const report = await lastShared(page);
  expect(report.text).toContain('1 problem:');
  expect(report.text).toContain('Screen error on /settings');
  expect(report.text).toContain('Error: Injected: drawing failed near https://addon.example/…');
  expect(report.text).not.toContain('abc123secret');
  expect(report.text).not.toContain('manifest.json');

  // Start again: the app comes back, the browser function with it, and the problem is kept.
  await page.getByRole('button', { name: 'Start again' }).click();
  await page.getByRole('tab', { name: 'Settings' }).click();
  await expect(page.getByText('App version', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /^Send a report/ }).click();
  await expect
    .poll(async () => (await lastShared(page)).text)
    .toContain('Screen error on /settings');
  // A screen that fails to draw is caught, not thrown at the page.
  expect(errors).toEqual([]);
});

test('a kids profile has no Send a report, in Settings or on the crash screen', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await catchShares(page);
  await mockAddons(page);
  await seedProfiles(page, {
    profiles: [main(lockedWith('2468')), { id: KIDS, name: 'Ada', colour: 2, kids: 'U' }],
    lastId: KIDS,
    askAtLaunch: false,
  });
  await openApp(page);
  await page.getByRole('tab', { name: 'Settings' }).click();
  await expect(
    page.getByText('Grown-ups can change the settings from their own profile.'),
  ).toBeVisible();
  await expect(page.getByText('Send a report')).toHaveCount(0);

  // "Who's watching?" draws Main's PIN pad, ready for its PIN, and that fails to draw here.
  await breakDrawing(page, 'Injected: the PIN pad failed');
  await page.getByRole('button', { name: 'Switch profile' }).click();
  await expect(page.getByText('Something went wrong')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start again' })).toBeVisible();
  await expect(page.getByText('Send a report')).toHaveCount(0);
  expect(errors).toEqual([]);
});
