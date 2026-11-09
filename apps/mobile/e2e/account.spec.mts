import { type Browser, expect, type Page, test } from '@playwright/test';
import { mockAddons } from '../../webos/e2e/addons.ts';
import { mockPlayback, readKv, seedStreamAddon } from '../../webos/e2e/play.ts';
import { GUEST_ID, lockedWith, main, seedProfiles } from '../../webos/e2e/profiles.ts';
import { type FakeSync, fakeSync, mockSync } from '../../webos/e2e/sync.ts';

/*
 * The BannerTV account on the phone's web build, against the TV journeys' fake service: the
 * real Worker over an SQLite database in memory, shared by every phone (browser context) of a
 * test. Nothing leaves the test. Confirmations that use the phone's own alert (Leave, Delete,
 * Use) are not here: the web build has no alert to press.
 */

const APP = 'http://localhost:8765';
const CHECK_LABEL = 'Last four characters of the code';
/** The copy a join keeps in IndexedDB of what it wrote to localStorage (data/sync-joined.ts). */
const JOINED = 'sync-joined';
const NOT_OPEN = "New accounts aren't open yet.";
/** Tears of Steel, Cinemeta's copy, which the test stream addon answers for. */
const FILM = 'tt2285752';
/** Morevna Project, a series of the fake Cinemeta. */
const SERIES = 'tt8000001';
const OFF_LEAD = /^Everything is encrypted on this screen/;

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

/** Opens the app with the fake addons and service. The app's own address is let through. */
async function openApp(page: Page, sync: FakeSync): Promise<void> {
  await mockAddons(page);
  await mockSync(page, sync);
  await page.route(/^http:\/\/localhost:8765\//, (route) => route.continue());
  await page.goto('/');
}

/** Another phone: a browser context of its own, with the same service. */
async function secondPhone(browser: Browser, sync: FakeSync): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, baseURL: APP });
  const page = await context.newPage();
  await openApp(page, sync);
  return page;
}

/** From Home to Settings > BannerTV account. */
async function openAccount(page: Page): Promise<void> {
  await page.getByRole('tab', { name: 'Settings' }).click();
  await page.getByText('BannerTV account', { exact: true }).click();
}

/** The account screen signed in: Sync now, and the status line under Settings' own. */
async function expectSignedIn(page: Page): Promise<void> {
  await expect(page.getByRole('button', { name: 'Sync now' })).toBeVisible();
  await expect(page.getByText(/^In sync/).last()).toBeVisible();
}

/** The account code on screen, without the spaces between its groups. */
async function shownCode(page: Page): Promise<string> {
  const code = page.getByTestId('account-code');
  await expect(code).toBeVisible();
  return ((await code.textContent()) ?? '').replace(/\s+/g, '');
}

/** From the code on screen: written down, its last four typed back, and the account made. */
async function confirmCode(page: Page, code: string): Promise<void> {
  await page.getByRole('button', { name: "I've written it down" }).click();
  await page.getByLabel(CHECK_LABEL).fill(code.slice(-4));
  await page.getByRole('button', { name: 'Check', exact: true }).click();
  await expect(page.getByText('This screen is in your account.')).toBeVisible();
  await expectSignedIn(page);
}

function creates(sync: FakeSync): number {
  return sync.requests.filter((request) => request === 'POST /v1/account/create').length;
}

/** Counts what this phone alone asks the service at `path`, such as `/v1/pull`. */
function asked(page: Page, path: string): () => number {
  let count = 0;
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === path) count += 1;
  });
  return () => count;
}

/** The phone goes to the background (true) or comes back (false), as the browser tells it. */
async function background(page: Page, away: boolean): Promise<void> {
  await page.evaluate((hidden) => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => (hidden ? 'hidden' : 'visible'),
    });
    document.dispatchEvent(new Event('visibilitychange'));
  }, away);
}

/** Where a phone has saved it is up to in a video, in seconds. */
async function savedPosition(page: Page, metaId: string): Promise<number | undefined> {
  const saved = (await readKv(page, 'progress')) as
    { metaId: string; position: number }[] | undefined;
  return saved?.find((entry) => entry.metaId === metaId)?.position;
}

test('Create an account on the phone: its code to write down or copy, the last four typed back, and a second phone joins with it', async ({
  page,
  browser,
}) => {
  const errors = watchErrors(page);
  const sync = fakeSync();
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await openApp(page, sync);
  await openAccount(page);
  await page.getByRole('button', { name: 'Create an account' }).click();

  const code = await shownCode(page);
  expect(code).toMatch(/^[0-9A-Z]{20}$/);
  await expect(page.getByTestId('account-code')).toHaveText(code.match(/.{4}/g)!.join(' '));
  await expect(
    page.getByText(
      'Write this down: it is the only way to add another screen, and nobody can recover it.',
    ),
  ).toBeVisible();
  // The account is held for the code, but nothing of the phone's is sent until it is read back.
  expect(sync.requests).not.toContain('POST /v1/push');

  await page.getByRole('button', { name: 'Copy the code' }).click();
  await expect(page.getByText(/^Copied\. Keep it somewhere private/)).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(code);

  // A wrong answer says so; the right one in lower case is taken.
  await page.getByRole('button', { name: "I've written it down" }).click();
  await page.getByLabel(CHECK_LABEL).fill(code.slice(-4) === 'AAAA' ? 'BBBB' : 'AAAA');
  await page.getByRole('button', { name: 'Check', exact: true }).click();
  await expect(page.getByText("That doesn't match. Look at the code again.")).toBeVisible();
  // Show the code again goes back to it, and on.
  await page.getByRole('button', { name: 'Show the code again' }).click();
  expect(await shownCode(page)).toBe(code);
  await page.getByRole('button', { name: "I've written it down" }).click();
  await page.getByLabel(CHECK_LABEL).fill(code.slice(-4).toLowerCase());
  await page.getByRole('button', { name: 'Check', exact: true }).click();
  await expect(page.getByText('This screen is in your account.')).toBeVisible();
  await expectSignedIn(page);
  expect(creates(sync)).toBe(1);
  expect(sync.requests).toContain('POST /v1/push');
  expect(await page.evaluate(() => localStorage.getItem('bannertv.syncOn'))).toBe('1');
  expect(errors).toEqual([]);

  // The second phone has nothing of its own, so it simply becomes the account's and starts again.
  const other = await secondPhone(browser, sync);
  const otherErrors = watchErrors(other);
  await openAccount(other);
  await other.getByRole('button', { name: 'Join with an account code' }).click();
  await other.getByLabel('Account code').fill(code.toLowerCase().replace(/(.{4})(?=.)/g, '$1-'));
  const loaded = other.waitForEvent('load', { timeout: 20000 });
  await other.getByRole('button', { name: 'Continue', exact: true }).click();
  await loaded;
  // The test server has no page at /account, where the web build starts again, so the app is
  // opened at Home, as a phone starts it. window.name, which the join's reload reads, stays.
  await other.goto('/');
  await expect
    .poll(async () => (await readKv(other, JOINED).catch(() => 'starting again')) ?? 'settled', {
      timeout: 20000,
    })
    .toBe('settled');
  expect(await other.evaluate(() => localStorage.getItem('bannertv.syncOn'))).toBe('1');
  await openAccount(other);
  await expectSignedIn(other);
  await expect(other.getByRole('button', { name: 'Show account code' })).toBeVisible();
  expect(otherErrors).toEqual([]);
});

test('Create answered with new accounts closed leaves only Join', async ({ page }) => {
  const errors = watchErrors(page);
  const sync = fakeSync();
  await openApp(page, sync);
  // Settings asked while there was room; the service has closed since.
  await openAccount(page);
  await expect(page.getByText(OFF_LEAD)).toBeVisible();
  // Once the account page has looked, Settings' row says what it offers: Create or Join.
  await page.getByRole('button', { name: 'Back' }).first().click();
  await expect(
    page.getByText('Make one, or join with a code', { exact: true }).last(),
  ).toBeVisible();
  await page.getByText('BannerTV account', { exact: true }).click();
  await expect(page.getByText(OFF_LEAD)).toBeVisible();
  await expect(page.getByText(NOT_OPEN)).toHaveCount(0);
  sync.maxAccounts = 0;
  await page.getByRole('button', { name: 'Create an account' }).click();
  await expect(page.getByText(NOT_OPEN)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create an account' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Join with an account code' })).toBeVisible();
  expect(creates(sync)).toBe(1);
  // Kept, so the account screen does not offer Create again until the service is asked again.
  const saved = await page.evaluate(() => localStorage.getItem('bannertv.syncStatus'));
  expect(JSON.parse(saved ?? '{}')).toMatchObject({ create: false });
  // Settings' row says what the account page offers now: Join alone.
  await page.getByRole('button', { name: 'Back' }).first().click();
  await expect(page.getByText('Join with an account code', { exact: true }).last()).toBeVisible();
  await expect(page.getByText('Make one, or join with a code', { exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('a service that needs its setup key asks for it before making the account, and again when it is wrong', async ({
  page,
}) => {
  const errors = watchErrors(page);
  const sync = fakeSync();
  sync.createKey = 'Owner2468Key';
  await openApp(page, sync);
  await openAccount(page);
  await page.getByRole('button', { name: 'Create an account' }).click();
  await expect(page.getByText('Setup key', { exact: true })).toBeVisible();
  expect(creates(sync)).toBe(0);

  // Nothing typed: nothing sent.
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByText('Type the setup key first.')).toBeVisible();
  expect(creates(sync)).toBe(0);

  await page.getByLabel('Setup key').fill('owner2468key');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByText("That setup key isn't right.")).toBeVisible();
  expect(creates(sync)).toBe(1);

  await page.getByLabel('Setup key').fill(' Owner2468Key ');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  const code = await shownCode(page);
  await confirmCode(page, code);
  // The key is never kept once the account exists.
  expect(JSON.stringify(await readKv(page, 'sync/state'))).not.toContain('Owner2468Key');
  expect(errors).toEqual([]);
});

test("a create with no service carries on at the next launch, behind Main's PIN, or is cancelled", async ({
  page,
}) => {
  const errors = watchErrors(page);
  const sync = fakeSync();
  await seedProfiles(page, {
    profiles: [main(lockedWith('2468'))],
    lastId: 'main',
    askAtLaunch: false,
  });
  await openApp(page, sync);
  await openAccount(page);

  // Main's PIN comes first; with the service out of reach the code is kept for when it answers.
  await page.getByRole('button', { name: 'Create an account' }).click();
  await expect(page.getByText('Enter the PIN for Main')).toBeVisible();
  sync.down = true;
  for (const digit of '2468') await page.getByRole('button', { name: digit, exact: true }).click();
  await expect(
    page.getByText("BannerTV can't reach its account service. Check the connection and try again."),
  ).toBeVisible();
  const unfinished = page.getByText(
    "Setting up the account isn't finished: its code still needs writing down.",
  );
  await expect(unfinished).toBeVisible();

  // The next launch: still unfinished, and Cancel setting up ends it there.
  await page.goto('/');
  await openAccount(page);
  await expect(unfinished).toBeVisible();
  sync.down = false;
  await page.getByRole('button', { name: 'Cancel setting up' }).click();
  await expect(page.getByRole('button', { name: 'Create an account' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('bannertv.syncOn'))).toBeNull();

  // Made again and left before the code was typed back: Show the code asks for the PIN again.
  await page.getByRole('button', { name: 'Create an account' }).click();
  for (const digit of '2468') await page.getByRole('button', { name: digit, exact: true }).click();
  const code = await shownCode(page);
  await page.goto('/');
  await openAccount(page);
  await expect(unfinished).toBeVisible();
  await page.getByRole('button', { name: 'Show the code' }).click();
  await expect(page.getByText('Enter the PIN for Main')).toBeVisible();
  for (const digit of '2468') await page.getByRole('button', { name: digit, exact: true }).click();
  expect(await shownCode(page)).toBe(code);
  await confirmCode(page, code);
  expect(errors).toEqual([]);
});

test("a film paused on one phone reaches the other's Home without pulling to refresh, and Main's Home says when it synced", async ({
  page,
  browser,
}) => {
  test.slow();
  const errors = watchErrors(page);
  const sync = fakeSync();
  // This phone stays on Home, and its clock is moved on rather than waited for.
  await page.clock.install();
  const episode = {
    metaId: SERIES,
    type: 'series' as const,
    videoId: `${SERIES}:1:2`,
    position: 600,
    duration: 1500,
  };
  const card = {
    videoId: episode.videoId,
    metaId: SERIES,
    type: 'series' as const,
    name: 'Morevna Project',
    season: 1,
    episode: 2,
  };
  await seedProfiles(page, {
    profiles: [main(), { id: GUEST_ID, name: 'Guest', colour: 1 }],
    lastId: 'main',
    askAtLaunch: false,
  });
  // Main and Guest each have an episode part way.
  await seedStreamAddon(page, {
    progress: [episode],
    played: [card],
    kv: {
      [`p/${GUEST_ID}/progress`]: [{ ...episode, watched: false, updatedAt: 1000 }],
      [`p/${GUEST_ID}/played`]: [{ ...card, updatedAt: 1000 }],
    },
  });
  await mockPlayback(page);
  await openApp(page, sync);
  const pulls = asked(page, '/v1/pull');
  const caption = page.getByText(/^Synced /);

  // Without an account, Continue watching says nothing of syncing, and Home asks nothing.
  await expect(page.getByRole('button', { name: 'Play Morevna Project' })).toBeVisible();
  await expect(page.getByText('Continue watching')).toBeVisible();
  await expect(caption).toHaveCount(0);
  await openAccount(page);
  await page.getByRole('button', { name: 'Create an account' }).click();
  const code = await shownCode(page);
  await confirmCode(page, code);
  expect(pulls()).toBe(0);
  // Making the account only pushed: Home, back in focus over half a minute later, pulls.
  await page.getByRole('button', { name: 'Back' }).first().click();
  await page.clock.fastForward('00:31');
  await page.getByRole('tab', { name: 'Home' }).click();
  await expect(page.getByText('Synced just now')).toBeVisible();
  expect(pulls()).toBe(1);

  // The other phone joins, plays the film and pauses it.
  const other = await secondPhone(browser, sync);
  const otherErrors = watchErrors(other);
  await mockPlayback(other);
  await openAccount(other);
  await other.getByRole('button', { name: 'Join with an account code' }).click();
  await other.getByLabel('Account code').fill(code);
  const loaded = other.waitForEvent('load', { timeout: 20000 });
  await other.getByRole('button', { name: 'Continue', exact: true }).click();
  await loaded;
  await other.goto('/');
  await expect
    .poll(async () => (await readKv(other, JOINED).catch(() => 'starting again')) ?? 'settled', {
      timeout: 20000,
    })
    .toBe('settled');
  // The account brought Guest, so the phone asks who is watching.
  await other.getByRole('button', { name: 'Main', exact: true }).click();
  await other
    .getByLabel(/Tears of Steel/)
    .last()
    .click();
  await other.getByRole('button', { name: /All streams/ }).click();
  await other
    .getByText(/Open Movie 1080p/)
    .first()
    .click();
  const pause = other.getByLabel('Pause', { exact: true }).first();
  await expect(pause).toBeVisible();
  // The browser waits for a tap before it plays; the phone does not.
  await pause.click();
  await other.getByLabel('Play', { exact: true }).first().click();
  await expect
    .poll(() => other.evaluate(() => document.querySelector('video')?.currentTime ?? 0))
    .toBeGreaterThan(2);
  // What the tap before Play sent has gone by now.
  await other.waitForTimeout(4000);
  const pushes = asked(other, '/v1/push');
  if (!(await pause.isVisible())) await other.mouse.click(206, 160);
  await pause.click();
  const pausedAt = Date.now();
  // Sent within seconds, where it used to wait 15 seconds after the last progress save.
  await expect.poll(pushes, { timeout: 10000 }).toBe(1);
  expect(Date.now() - pausedAt).toBeLessThan(10000);
  expect(await savedPosition(other, FILM)).toBeGreaterThan(2);

  // Here, Home's pull every 2 minutes brings it, with no pull to refresh. The test file is 40
  // seconds long, too short for Continue watching to show it (30 seconds is the least that
  // resumes, and the last minute counts as the end), so what the phone now holds is read.
  expect(await savedPosition(page, FILM)).toBeUndefined();
  await page.clock.fastForward('02:00');
  await expect.poll(() => savedPosition(page, FILM)).toBeGreaterThan(2);
  const cards = (await readKv(page, 'played')) as { videoId: string; name: string }[];
  expect(cards.find((played) => played.videoId === FILM)?.name).toBe('Tears of Steel');
  await expect(page.getByText('Synced just now')).toBeVisible();

  // Away from Home, its pulls stop (Settings pulls once as it opens, for its profiles); back in
  // focus, one.
  let before = pulls();
  await page.getByRole('tab', { name: 'Settings' }).click();
  await expect.poll(pulls).toBe(before + 1);
  before = pulls();
  await page.clock.fastForward('05:00');
  await page.waitForTimeout(500);
  expect(pulls()).toBe(before);
  await page.getByRole('tab', { name: 'Home' }).click();
  await expect.poll(pulls).toBe(before + 1);

  // In the background, nothing. Coming back pulls once, as the account does after 15 seconds
  // away, and Home's 2 minutes start again from there.
  before = pulls();
  await background(page, true);
  await page.clock.fastForward('05:00');
  await page.waitForTimeout(500);
  expect(pulls()).toBe(before);
  await background(page, false);
  await expect.poll(pulls).toBe(before + 1);
  await page.waitForTimeout(500);
  expect(pulls()).toBe(before + 1);
  await page.clock.fastForward('02:00');
  await expect.poll(pulls).toBe(before + 2);

  // Guest has Continue watching too, but only Main sees the account.
  await page.getByRole('button', { name: 'Switch profile' }).click();
  const switched = page.waitForEvent('load', { timeout: 20000 });
  await page.getByRole('button', { name: 'Guest', exact: true }).click();
  await switched;
  // The test server has no page at /profiles, where the web build starts again.
  const pulled = page.waitForResponse((response) => response.url().endsWith('/v1/pull'));
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Switch profile' })).toHaveText('G');
  await expect(page.getByRole('button', { name: 'Play Morevna Project' })).toBeVisible();
  await expect(page.getByText('Continue watching')).toBeVisible();
  // Once the launch's pull is in, Main would say so.
  await pulled;
  await page.waitForTimeout(1000);
  await expect(caption).toHaveCount(0);
  expect(errors).toEqual([]);
  expect(otherErrors).toEqual([]);
});

test('the welcome offers Create an account beside Join while new accounts are open', async ({
  page,
}) => {
  const sync = fakeSync();
  await mockAddons(page, { firstRun: true });
  await mockSync(page, sync);
  await page.route(/^http:\/\/localhost:8765\//, (route) => route.continue());
  await page.goto('/');
  await expect(page.getByText('Watching on more than one screen?')).toBeVisible();
  await expect(page.getByText(/^A free BannerTV account keeps your profiles/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Join with a code' })).toBeVisible();
  await page.getByRole('button', { name: 'Create an account' }).click();
  // The account screen, on its menu.
  await expect(page.getByText(OFF_LEAD)).toBeVisible();
  await page.getByRole('button', { name: 'Create an account' }).click();
  await shownCode(page);
});

test('the welcome offers only Join while new accounts are closed', async ({ page }) => {
  const sync = fakeSync();
  sync.maxAccounts = 0;
  await mockAddons(page, { firstRun: true });
  await mockSync(page, sync);
  await page.route(/^http:\/\/localhost:8765\//, (route) => route.continue());
  await page.goto('/');
  await expect(page.getByText('Watching on more than one screen?')).toBeVisible();
  await expect(page.getByText(/^Already use BannerTV on your TV\?/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create an account' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Join with a code' }).click();
  await expect(page.getByLabel('Account code')).toBeVisible();
});

/**
 * The copy a join with Use keeps of what the phone had (ADR 0006, decision 12), as if the join
 * were ten days ago: Main and Guest, a title on My List, a film part way, and one addon.
 */
async function seedAside(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const DAY = 24 * 60 * 60 * 1000;
    const at = Date.now() - 10 * DAY;
    const aside = {
      v: 1,
      at,
      until: at + 30 * DAY,
      documents: {
        profiles: [
          ['main', { v: 1, t: at }],
          ['main/name', { v: 'Main', t: at }],
          ['guest4', { v: 1, t: at }],
          ['guest4/name', { v: 'Guest', t: at }],
        ],
        'p/main/list': [['tt1727587', { v: { type: 'movie' }, t: at }]],
        'p/main/watch': [['tt1254207', { v: { metaId: 'tt1254207', watched: false }, t: at }]],
        addons: [
          ['a/one', { v: { u: 'https://addon.example/manifest.json', m: { name: 'Cinemeta' } } }],
        ],
      },
    };
    const request = indexedDB.open('bannertv', 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      if (!db.objectStoreNames.contains('cache')) {
        db.createObjectStore('cache').createIndex('storedAt', 'storedAt');
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(aside, 'sync-aside');
      tx.oncomplete = () => db.close();
    };
  });
}

test('the copy Use kept says on the phone what it holds and until when, with Bring back', async ({
  page,
}) => {
  const errors = watchErrors(page);
  const sync = fakeSync();
  await seedAside(page);
  await openApp(page, sync);
  await openAccount(page);
  await expect(page.getByText(OFF_LEAD)).toBeVisible();
  await expect(page.getByText('What this screen had before', { exact: true })).toBeVisible();
  await expect(page.getByText(/^When this screen joined with Use/)).toHaveText(
    /The copy is kept until \d{1,2} [A-Z][a-z]+ \d{4}\.$/,
  );
  for (const line of [
    'Profiles: Main, Guest',
    '1 title on My List',
    '1 film or episode part way through',
    'Addons: Cinemeta',
  ]) {
    await expect(page.getByText(line, { exact: true })).toBeVisible();
  }
  await expect(
    page.getByRole('button', { name: 'Bring back what this screen had before' }),
  ).toBeVisible();
  // Reading the copy asks the service nothing but its status.
  expect(sync.requests.filter((request) => request !== 'GET /v1/status')).toEqual([]);
  expect(errors).toEqual([]);
});
