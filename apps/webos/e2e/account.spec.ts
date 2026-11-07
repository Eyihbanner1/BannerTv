import { type Browser, expect, type Page, test } from '@playwright/test';
import { DEMO_ROW, FIRST_ROW, mockAddons } from './addons';
import { readKv } from './play';
import { GUEST_ID, lockedWith, main, seedProfiles } from './profiles';
import {
  type FakeSync,
  fakeSync,
  mockSync,
  openAccount,
  openSettings,
  shownCode,
  typeInto,
} from './sync';
import {
  APP_URL,
  expectFocus,
  expectFocusLabel,
  focusedKey,
  press,
  pressBack,
  watchErrors,
} from './tv';

const BUNNY = 'tt1254207';
const SINTEL = 'tt1727587';
const CONTINUE_TILE = 'home-continue-tile-0';
const ADA = { id: 'ada001', name: 'Ada', colour: 2 };
const GUEST = { id: GUEST_ID, name: 'Guest', colour: 1 };
const CHECK_LABEL = 'Last four characters of the code';
const CODE_LABEL = 'Account code';
/** The copy a join keeps in IndexedDB of what it wrote to localStorage (data/sync-joined.ts). */
const JOINED = 'sync-joined';

/** An error status the service answers with on purpose, which Chromium logs. */
const ANSWERED = /^Failed to load resource: the server responded with a status of 40[13]/;
/** A request to the service while it is down, which Chromium logs. */
const UNREACHED = /^Failed to load resource: net::ERR_FAILED/;

/**
 * Sintel on My List and Big Buck Bunny part way, saved a minute ago, at the
 * first launch only: never on a reload, which may not see sessionStorage yet
 * (see seedProfiles). The times are never whole seconds: whole seconds would
 * read as Trakt's.
 */
async function seedWatching(page: Page): Promise<void> {
  const at = Math.floor((Date.now() - 60000) / 1000) * 1000 + 123;
  await page.addInitScript(
    (seed: Record<string, unknown>) => {
      const navigation = performance.getEntriesByType('navigation')[0] as
        PerformanceNavigationTiming | undefined;
      if (navigation?.type === 'reload') return;
      if (sessionStorage.getItem('bannertv.test.watching')) return;
      sessionStorage.setItem('bannertv.test.watching', '1');
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
        for (const key of Object.keys(seed)) tx.objectStore('kv').put(seed[key], key);
        tx.oncomplete = () => db.close();
      };
    },
    {
      library: {
        items: [{ id: SINTEL, type: 'movie', name: 'Sintel', releaseInfo: '2010', addedAt: at }],
        outbox: [],
        synced: [],
      },
      progress: [
        {
          metaId: BUNNY,
          type: 'movie',
          videoId: BUNNY,
          position: 30,
          duration: 120,
          watched: false,
          updatedAt: at,
        },
      ],
      played: [
        {
          videoId: BUNNY,
          metaId: BUNNY,
          type: 'movie',
          name: 'Big Buck Bunny',
          releaseInfo: '2008',
          poster: `https://images.metahub.space/poster/small/${BUNNY}/img`,
          updatedAt: at,
        },
      ],
    },
  );
}

/** Another TV: a browser context of its own, with the same service. */
async function secondScreen(browser: Browser, sync: FakeSync): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();
  await mockAddons(page);
  await mockSync(page, sync);
  return page;
}

/** Presses digits on the remote's number keys. */
async function typeDigits(page: Page, digits: string): Promise<void> {
  for (const digit of digits) {
    await page.keyboard.press(digit);
    await page.waitForTimeout(60);
  }
}

/** On the account screen signed out: makes the account and returns its code. */
async function createAccount(page: Page, pin?: string): Promise<string> {
  if (pin) {
    await press(page, 'Enter', 'account-pin-1');
    await expect(page.getByRole('dialog', { name: 'Enter the PIN for Main' })).toBeVisible();
    await typeDigits(page, pin);
    await expectFocus(page, 'account-code-saved');
  } else {
    await press(page, 'Enter', 'account-code-saved');
  }
  const code = await shownCode(page);
  await press(page, 'Enter', 'account-check-field');
  await typeInto(page, CHECK_LABEL, code.slice(-4));
  await page.keyboard.press('Enter');
  await expect(page.getByText('This screen is in your account.')).toBeVisible();
  await expectFocus(page, 'account-sync');
  return code;
}

/**
 * Runs `action`, which ends in a join starting BannerTV again, and waits for
 * that launch to settle. A launch that missed some of the join's
 * localStorage writes puts them back from the join's copy in IndexedDB and
 * starts once more; the copy goes once a launch has read everything.
 */
async function reloadsAfter(page: Page, action: () => Promise<void>): Promise<void> {
  const loaded = page.waitForEvent('load', { timeout: 20000 });
  await action();
  await loaded;
  await expect
    .poll(async () => (await readKv(page, JOINED).catch(() => 'starting again')) ?? 'settled', {
      timeout: 20000,
    })
    .toBe('settled');
  await page.waitForLoadState();
}

/** On the account screen signed out: types the code and carries on. */
async function typeCode(page: Page, code: string): Promise<void> {
  await press(page, 'ArrowDown', 'account-join');
  await press(page, 'Enter', 'account-code-field');
  // Typed as a person might: lower case, in dashed groups.
  await typeInto(page, CODE_LABEL, code.toLowerCase().replace(/(.{4})(?=.)/g, '$1-'));
  await page.keyboard.press('Enter');
}

function profileIds(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('bannertv.profiles') ?? '{"profiles":[]}') as {
      profiles: { id: string }[];
    };
    return saved.profiles.map((profile) => profile.id);
  });
}

async function libraryIds(page: Page): Promise<string[]> {
  const library = (await readKv(page, 'library')) as { items: { id: string }[] } | undefined;
  return (library?.items ?? []).map((item) => item.id);
}

/** On Settings > Profiles: adds a profile called `name`, as the person would. */
async function addProfile(page: Page, name: string): Promise<void> {
  for (let i = 0; i < 8 && (await focusedKey(page)) !== 'profiles-add'; i++) {
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(150);
  }
  await press(page, 'Enter', 'profile-name');
  await typeInto(page, 'Name', name);
  await press(page, 'Enter', 'profile-name');
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(150);
  await press(page, 'ArrowDown', 'profile-kids');
  await press(page, 'ArrowDown', 'profile-save');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Profiles' })).toBeVisible();
}

/** From Settings > Profiles to BannerTV account, Sync now, and back to Profiles. */
async function syncFromProfiles(page: Page): Promise<void> {
  await pressBack(page);
  await expectFocus(page, 'settings-profiles');
  await press(page, 'ArrowDown', 'settings-home-rows');
  await press(page, 'ArrowDown', 'settings-account');
  await press(page, 'Enter', 'account-sync');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status').filter({ hasText: 'In sync just now' })).toBeVisible();
  await pressBack(page);
  await expectFocus(page, 'settings-account');
  await press(page, 'ArrowUp', 'settings-home-rows');
  await press(page, 'ArrowUp', 'settings-profiles');
  await press(page, 'Enter', 'profiles-main');
}

/** The keys of one document in the copy Use keeps of what the screen had. */
async function asideKeys(page: Page, document: string): Promise<string[]> {
  const aside = (await readKv(page, 'sync-aside')) as
    { documents: Record<string, Array<[string, unknown]>> } | undefined;
  return (aside?.documents[document] ?? []).map(([key]) => key);
}

test('Settings offers BannerTV account to Main only once its service answers, and asks it once a day', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await mockAddons(page);
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);

  // The service is not set up: Home rows is the last of Main's settings.
  await openSettings(page);
  await press(page, 'ArrowRight', 'settings-profiles');
  await press(page, 'ArrowDown', 'settings-home-rows');
  await page.waitForTimeout(500);
  await expect(page.locator('[data-focus-key="settings-account"]')).toHaveCount(0);

  // Now it answers: Settings shows the account when it opens again.
  const sync = fakeSync();
  await mockSync(page, sync);
  await pressBack(page);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await openSettings(page);
  await openAccount(page, 'account-create');
  await expect(page.getByRole('heading', { name: 'BannerTV account' })).toBeVisible();
  await expect(page.getByText('Everything is encrypted on this screen')).toBeVisible();
  // Looking makes no account and sends nothing but the one question.
  expect(sync.requests).toEqual(['GET /v1/status']);

  await pressBack(page);
  await expectFocus(page, 'settings-account');
  await pressBack(page);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await openSettings(page);
  await press(page, 'ArrowRight', 'settings-profiles');
  await press(page, 'ArrowDown', 'settings-home-rows');
  await press(page, 'ArrowDown', 'settings-account');
  expect(sync.requests).toEqual(['GET /v1/status']);
  expect(errors).toEqual([]);
});

test('no profile but Main sees BannerTV account, and new accounts can be closed', async ({
  page,
}) => {
  const sync = fakeSync();
  sync.maxAccounts = 0;
  await mockAddons(page);
  await mockSync(page, sync);
  await seedProfiles(page, {
    profiles: [main(), GUEST],
    lastId: GUEST_ID,
    askAtLaunch: false,
  });
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);

  await openSettings(page);
  await press(page, 'ArrowRight', 'settings-profiles');
  await press(page, 'ArrowDown', 'settings-home-rows');
  await page.waitForTimeout(500);
  await expect(page.locator('[data-focus-key="settings-account"]')).toHaveCount(0);
  // Guest's Settings never even asks the service.
  expect(sync.requests).toEqual([]);

  // Main does see it; with the service full, only joining is offered.
  await pressBack(page);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await press(page, 'ArrowLeft', 'rail-home');
  for (const item of ['search', 'discover', 'library', 'addons', 'settings', 'profile']) {
    await press(page, 'ArrowDown', `rail-${item}`);
  }
  await press(page, 'Enter', `profile-${GUEST_ID}`);
  await press(page, 'ArrowLeft', 'profile-main');
  await page.keyboard.press('Enter');
  await page.waitForLoadState();
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await openSettings(page);
  await openAccount(page, 'account-join');
  await expect(page.getByText("New accounts aren't open yet.")).toBeVisible();
  await expect(page.locator('[data-focus-key="account-create"]')).toHaveCount(0);
});

test('a new account shows its code to write down, and a second screen joins by typing it and gets My List and Continue Watching', async ({
  page,
  browser,
}) => {
  test.slow();
  const errors = watchErrors(page);
  const sync = fakeSync();
  await mockAddons(page);
  await mockSync(page, sync);
  await seedWatching(page);
  await page.goto(APP_URL);
  await expectFocus(page, CONTINUE_TILE);

  await openSettings(page);
  await openAccount(page, 'account-create');
  await press(page, 'Enter', 'account-code-saved');
  const code = await shownCode(page);
  expect(code).toMatch(/^[0-9A-Z]{20}$/);
  // Large, in five groups of four, with what to do with it.
  await expect(page.locator('[data-account-code] span')).toHaveText(code.match(/.{4}/g)!);
  await expect(
    page.getByText(
      'Write this down: it is the only way to add another screen, and nobody can recover it.',
    ),
  ).toBeVisible();
  // The account is held for the code, but nothing of the screen's is sent until it is read back.
  expect(sync.requests).not.toContain('POST /v1/push');

  await press(page, 'Enter', 'account-check-field');
  await typeInto(page, CHECK_LABEL, code.slice(-4) === 'AAAA' ? 'BBBB' : 'AAAA');
  await page.keyboard.press('Enter');
  await expect(page.getByText("That doesn't match. Look at the code again.")).toBeVisible();
  await expectFocus(page, 'account-check-field');
  // Typed again over the wrong answer, in lower case.
  await page.keyboard.press('Enter');
  const field = page.locator(`input[aria-label="${CHECK_LABEL}"]`);
  await expect(field).toBeFocused();
  await field.fill(code.slice(-4).toLowerCase());
  await page.keyboard.press('Enter');
  await expect(page.getByText('This screen is in your account.')).toBeVisible();
  await expectFocus(page, 'account-sync');
  await expect(page.getByRole('status').filter({ hasText: /^In sync/ })).toBeVisible();
  expect(sync.requests).toContain('POST /v1/account/create');
  expect(sync.requests).toContain('POST /v1/push');
  expect(await page.evaluate(() => localStorage.getItem('bannertv.syncOn'))).toBe('1');

  // The second screen has nothing of its own, so it simply becomes the account's.
  const other = await secondScreen(browser, sync);
  const otherErrors = watchErrors(other);
  await other.goto(APP_URL);
  await expectFocus(other, `${FIRST_ROW}-tile-0`);
  await openSettings(other);
  await openAccount(other, 'account-create');
  // BannerTV starts again as one of the account's screens.
  await reloadsAfter(other, () => typeCode(other, code));
  await expectFocus(other, CONTINUE_TILE);
  await expect(other.locator('[data-focused="true"]')).toHaveAttribute(
    'aria-label',
    /Big Buck Bunny/,
  );
  expect(await libraryIds(other)).toEqual([SINTEL]);

  // Sintel comes off My List there…
  await press(other, 'ArrowLeft', 'rail-home');
  for (const item of ['search', 'discover', 'library']) {
    await press(other, 'ArrowDown', `rail-${item}`);
  }
  await press(other, 'Enter', 'discover-tile-0');
  await expectFocusLabel(other, 'Sintel, 2010');
  await press(other, 'Enter', 'details-watch');
  await press(other, 'ArrowRight', 'details-trailer');
  await press(other, 'ArrowRight', 'details-streams');
  await press(other, 'ArrowRight', 'details-my-list');
  const pushes = () => sync.requests.filter((request) => request === 'POST /v1/push').length;
  const pushed = pushes();
  await other.keyboard.press('Enter');
  await expectFocusLabel(other, 'Add Sintel to My List');
  expect(await libraryIds(other)).toEqual([]);
  // Sent a few seconds after the change…
  await expect.poll(pushes, { timeout: 10000 }).toBeGreaterThan(pushed);

  // …and gone from My List here after Sync now.
  await page.keyboard.press('Enter');
  await expect.poll(() => libraryIds(page)).toEqual([]);
  await expect(page.getByRole('status').filter({ hasText: 'In sync just now' })).toBeVisible();
  expect(errors).toEqual([]);
  expect(otherErrors).toEqual([]);
});

test('joining from a screen with profiles of its own says what happens to each, and Bring keeps them', async ({
  page,
  browser,
}) => {
  test.slow();
  const sync = fakeSync();
  await mockAddons(page);
  await mockSync(page, sync);
  await seedProfiles(page, { profiles: [main(), ADA], lastId: 'main', askAtLaunch: false });
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await openSettings(page);
  await openAccount(page, 'account-create');
  const code = await createAccount(page);

  const other = await secondScreen(browser, sync);
  const errors = watchErrors(other);
  await seedProfiles(other, { profiles: [main(), GUEST], lastId: 'main', askAtLaunch: false });
  await other.goto(APP_URL);
  await expectFocus(other, `${FIRST_ROW}-tile-0`);
  await openSettings(other);
  await openAccount(other, 'account-create');
  await typeCode(other, code);

  await expectFocus(other, 'account-use');
  await expect(other.getByText('This screen already has its own profiles')).toBeVisible();
  const plans = other.locator('ul');
  await expect(plans.first().locator('li')).toHaveText([
    "Main joins the account's Main.",
    'Guest is added to the account.',
    'Ada comes from the account.',
    /^Where both have a setting/,
  ]);
  await expect(plans.nth(1).locator('li')).toHaveText([
    "Main becomes the account's Main.",
    'Guest is removed from this screen.',
    'Ada comes from the account.',
    /^This screen's profiles, addons/,
  ]);
  // Back goes back a step without joining.
  await pressBack(other);
  await expectFocus(other, 'account-create');
  await typeCode(other, code);
  await expectFocus(other, 'account-use');
  await press(other, 'ArrowLeft', 'account-bring');
  await reloadsAfter(other, () => other.keyboard.press('Enter'));

  // BannerTV starts again with both screens' profiles.
  await expectFocus(other, `${FIRST_ROW}-tile-0`);
  await expect.poll(() => profileIds(other)).toEqual(['main', GUEST_ID, ADA.id]);
  expect(errors).toEqual([]);

  // The first screen has Guest after Sync now.
  await page.keyboard.press('Enter');
  await expect.poll(() => profileIds(page)).toEqual(['main', ADA.id, GUEST_ID]);
});

test("Use replaces a screen's profiles with the account's, after asking, and keeps a copy", async ({
  page,
  browser,
}) => {
  test.slow();
  const sync = fakeSync();
  await mockAddons(page);
  await mockSync(page, sync);
  await seedProfiles(page, { profiles: [main(), ADA], lastId: 'main', askAtLaunch: false });
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await openSettings(page);
  await openAccount(page, 'account-create');
  const code = await createAccount(page);

  const other = await secondScreen(browser, sync);
  await seedProfiles(other, { profiles: [main(), GUEST], lastId: 'main', askAtLaunch: false });
  await seedWatching(other);
  await other.goto(APP_URL);
  await expectFocus(other, CONTINUE_TILE);
  await openSettings(other);
  await openAccount(other, 'account-create');
  await typeCode(other, code);
  await expectFocus(other, 'account-use');
  await press(other, 'Enter', 'account-use-dialog-cancel');
  await expect(other.getByRole('dialog', { name: "Use the account's profiles?" })).toBeVisible();
  await pressBack(other);
  await expectFocus(other, 'account-use');
  await press(other, 'Enter', 'account-use-dialog-cancel');
  await press(other, 'ArrowLeft', 'account-use-dialog-confirm');
  await reloadsAfter(other, () => other.keyboard.press('Enter'));

  await expectFocus(other, `${FIRST_ROW}-tile-0`);
  await expect.poll(() => profileIds(other)).toEqual(['main', ADA.id]);
  expect(await libraryIds(other)).toEqual([]);
  // The copy holds what the screen had, not the account's.
  expect(await asideKeys(other, 'profiles')).toContain(GUEST_ID);
  expect(await asideKeys(other, 'profiles')).not.toContain(ADA.id);
  expect(await asideKeys(other, 'p/main/list')).toEqual([SINTEL]);
});

test('Back waits while a join runs, and the copy Use keeps still holds what the screen had', async ({
  page,
  browser,
}) => {
  test.slow();
  const sync = fakeSync();
  await mockAddons(page);
  await mockSync(page, sync);
  await seedProfiles(page, { profiles: [main(), ADA], lastId: 'main', askAtLaunch: false });
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await openSettings(page);
  await openAccount(page, 'account-create');
  const code = await createAccount(page);

  const other = await secondScreen(browser, sync);
  await seedProfiles(other, { profiles: [main(), GUEST], lastId: 'main', askAtLaunch: false });
  await seedWatching(other);
  await other.goto(APP_URL);
  await expectFocus(other, CONTINUE_TILE);
  await openSettings(other);
  await openAccount(other, 'account-create');
  await typeCode(other, code);
  await expectFocus(other, 'account-use');
  await press(other, 'Enter', 'account-use-dialog-cancel');
  await press(other, 'ArrowLeft', 'account-use-dialog-confirm');

  // A slow connection: each answer takes a second and a half.
  sync.delay = 1500;
  const joining = other.getByText("Joining the account. BannerTV starts again when it's done.");
  await reloadsAfter(other, async () => {
    await other.keyboard.press('Enter');
    await expect(joining).toBeVisible();
    // Back does nothing while the join runs: no menu offering to try again.
    await pressBack(other);
    await pressBack(other);
    await other.waitForTimeout(300);
    await expect(joining).toBeVisible();
    await expect(other.locator('[data-focus-key="account-try"]')).toHaveCount(0);
  });
  sync.delay = 0;

  await expectFocus(other, `${FIRST_ROW}-tile-0`);
  await expect.poll(() => profileIds(other)).toEqual(['main', ADA.id]);
  expect(await asideKeys(other, 'profiles')).toContain(GUEST_ID);
  expect(await asideKeys(other, 'p/main/list')).toEqual([SINTEL]);
});

test("a join's reload that misses what the join wrote to localStorage puts it back", async ({
  page,
  browser,
}) => {
  test.slow();
  const sync = fakeSync();
  await mockAddons(page);
  await mockSync(page, sync);
  await seedProfiles(page, { profiles: [main(), ADA], lastId: 'main', askAtLaunch: false });
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await openSettings(page);
  await openAccount(page, 'account-create');
  const code = await createAccount(page);

  const other = await secondScreen(browser, sync);
  const errors = watchErrors(other);
  await seedProfiles(other, { profiles: [main(), GUEST], lastId: 'main', askAtLaunch: false });
  // As on a TV whose reload reads localStorage before the join's last writes have arrived.
  // The address carries what to lose, since a reload here may not see sessionStorage yet,
  // and window.name is the join's own.
  await other.addInitScript(() => {
    const prefix = '#lost-join=';
    if (location.hash.indexOf(prefix) !== 0) return;
    const lost = decodeURIComponent(location.hash.slice(prefix.length));
    history.replaceState(null, '', location.pathname + location.search);
    localStorage.setItem('bannertv.profiles', lost);
    localStorage.removeItem('bannertv.syncOn');
  });
  await other.goto(APP_URL);
  await expectFocus(other, `${FIRST_ROW}-tile-0`);
  await openSettings(other);
  await openAccount(other, 'account-create');
  await typeCode(other, code);
  await expectFocus(other, 'account-use');
  await press(other, 'Enter', 'account-use-dialog-cancel');
  await press(other, 'ArrowLeft', 'account-use-dialog-confirm');
  await other.evaluate(() => {
    const lost = encodeURIComponent(localStorage.getItem('bannertv.profiles')!);
    history.replaceState(null, '', `${location.pathname}${location.search}#lost-join=${lost}`);
  });
  let loads = 0;
  other.on('load', () => (loads += 1));
  await reloadsAfter(other, () => other.keyboard.press('Enter'));

  // The launch read Guest again, so BannerTV put the join's profiles back and started once more.
  expect(loads).toBe(2);
  await expectFocus(other, `${FIRST_ROW}-tile-0`);
  expect(await profileIds(other)).toEqual(['main', ADA.id]);
  expect(await other.evaluate(() => localStorage.getItem('bannertv.syncOn'))).toBe('1');
  await openSettings(other);
  await press(other, 'ArrowRight', 'settings-profiles');
  await press(other, 'Enter', 'profiles-main');
  await expect(other.getByRole('button', { name: 'Guest' })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('a code no account has says so, and the screen stays as it was', async ({ page }) => {
  const errors = watchErrors(page);
  const sync = fakeSync();
  await mockAddons(page);
  await mockSync(page, sync);
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await openSettings(page);
  await openAccount(page, 'account-create');
  await typeCode(page, 'ABCDEFGHJKMNPQRSTUVW');
  await expect(
    page.getByText('No account has that code. Check each character and try again.'),
  ).toBeVisible();
  await expectFocus(page, 'account-code-field');
  // Back leaves the code and makes nothing.
  await pressBack(page);
  await expectFocus(page, 'account-create');
  expect(await page.evaluate(() => localStorage.getItem('bannertv.syncOn'))).toBeNull();
  expect(await readKv(page, 'sync/state')).toBeUndefined();
  expect(errors.filter((error) => !ANSWERED.test(error))).toEqual([]);
});

test('creating and joining while the service is out of reach carry on once it answers', async ({
  page,
  browser,
}) => {
  test.slow();
  const errors = watchErrors(page);
  const sync = fakeSync();
  await mockAddons(page);
  await mockSync(page, sync);
  await seedProfiles(page, { profiles: [main(), ADA], lastId: 'main', askAtLaunch: false });
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await openSettings(page);
  await openAccount(page, 'account-create');

  // Create: the code is kept for when the service answers.
  sync.down = true;
  await page.keyboard.press('Enter');
  await expect(
    page.getByText("BannerTV can't reach its account service. Check the connection and try again."),
  ).toBeVisible();
  await expect(
    page.getByText("Setting up the account isn't finished: its code still needs writing down."),
  ).toBeVisible();
  await expectFocus(page, 'account-setup-show');
  sync.down = false;
  await press(page, 'Enter', 'account-code-saved');
  const code = await shownCode(page);
  await press(page, 'Enter', 'account-check-field');
  await typeInto(page, CHECK_LABEL, code.slice(-4));
  await page.keyboard.press('Enter');
  await expect(page.getByText('This screen is in your account.')).toBeVisible();
  expect(errors.filter((error) => !UNREACHED.test(error))).toEqual([]);

  // Join: the code is checked, then the service goes as Bring starts.
  const other = await secondScreen(browser, sync);
  const otherErrors = watchErrors(other);
  await seedProfiles(other, { profiles: [main(), GUEST], lastId: 'main', askAtLaunch: false });
  await other.goto(APP_URL);
  await expectFocus(other, `${FIRST_ROW}-tile-0`);
  await openSettings(other);
  await openAccount(other, 'account-create');
  await typeCode(other, code);
  await expectFocus(other, 'account-use');
  await press(other, 'ArrowLeft', 'account-bring');
  sync.down = true;
  await other.keyboard.press('Enter');
  await expect(
    other.getByText(
      "BannerTV couldn't reach its account service. Try again: joining carries on where it stopped.",
    ),
  ).toBeVisible();
  await expect(
    other.getByText(
      "Joining the account didn't finish. BannerTV carries on when it can reach its service.",
    ),
  ).toBeVisible();
  await expectFocus(other, 'account-try');
  sync.down = false;
  await reloadsAfter(other, () => other.keyboard.press('Enter'));
  await expectFocus(other, `${FIRST_ROW}-tile-0`);
  await expect.poll(() => profileIds(other)).toEqual(['main', GUEST_ID, ADA.id]);
  expect(otherErrors.filter((error) => !UNREACHED.test(error))).toEqual([]);
});

test('Bring is not offered when the profiles would pass six', async ({ page, browser }) => {
  test.slow();
  const sync = fakeSync();
  await mockAddons(page);
  await mockSync(page, sync);
  const theirs = [
    ADA,
    { id: 'bea002', name: 'Bea', colour: 3 },
    { id: 'cy0003', name: 'Cy', colour: 4 },
  ];
  await seedProfiles(page, { profiles: [main(), ...theirs], lastId: 'main', askAtLaunch: false });
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await openSettings(page);
  await openAccount(page, 'account-create');
  const code = await createAccount(page);

  const other = await secondScreen(browser, sync);
  const errors = watchErrors(other);
  const ours = [
    GUEST,
    { id: 'dee004', name: 'Dee', colour: 5 },
    { id: 'eli005', name: 'Eli', colour: 6 },
  ];
  await seedProfiles(other, { profiles: [main(), ...ours], lastId: 'main', askAtLaunch: false });
  await other.goto(APP_URL);
  await expectFocus(other, `${FIRST_ROW}-tile-0`);
  await openSettings(other);
  await openAccount(other, 'account-create');
  await typeCode(other, code);
  await expectFocus(other, 'account-use');
  await expect(
    other.getByText(
      "The account has 4 profiles and this screen would add 3, but BannerTV allows six. Use the account's profiles, or delete a profile on this screen first.",
    ),
  ).toBeVisible();
  await expect(other.locator('[data-focus-key="account-bring"]')).toHaveCount(0);
  await pressBack(other);
  await expectFocus(other, 'account-create');
  // Nothing was joined.
  expect(await readKv(other, 'sync/state')).toBeUndefined();
  expect(await profileIds(other)).toEqual(['main', ...ours.map((profile) => profile.id)]);
  expect(errors).toEqual([]);
});

test('a service that needs its setup key asks for it before making the account, and again when it is wrong', async ({
  page,
}) => {
  const errors = watchErrors(page);
  const sync = fakeSync();
  sync.createKey = 'Owner2468Key';
  await mockAddons(page);
  await mockSync(page, sync);
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await openSettings(page);
  await openAccount(page, 'account-create');
  await press(page, 'Enter', 'account-key-field');
  await expect(page.getByRole('heading', { name: 'Setup key' })).toBeVisible();
  await expect(
    page.getByText("Type the setup key added in the account service's settings. Capitals count."),
  ).toBeVisible();
  expect(sync.requests).not.toContain('POST /v1/account/create');

  // Nothing typed: nothing sent.
  await press(page, 'ArrowDown', 'account-key-continue');
  await page.keyboard.press('Enter');
  await expect(page.getByText('Type the setup key first.')).toBeVisible();
  await expectFocus(page, 'account-key-field');
  expect(sync.requests).not.toContain('POST /v1/account/create');

  await typeInto(page, 'Setup key', 'owner2468key');
  await page.keyboard.press('Enter');
  await expect(page.getByText("That setup key isn't right.")).toBeVisible();
  await expectFocus(page, 'account-key-field');
  expect(sync.requests.filter((request) => request === 'POST /v1/account/create')).toHaveLength(1);

  // Typed again, on a slow connection: Back waits for the account.
  await page.keyboard.press('Enter');
  const field = page.locator('input[aria-label="Setup key"]');
  await expect(field).toBeFocused();
  await field.fill(' Owner2468Key ');
  sync.delay = 1500;
  await page.keyboard.press('Enter');
  await expect(page.getByText('Setting up your account')).toBeVisible();
  await pressBack(page);
  await expect(page.getByText('Setting up your account')).toBeVisible();
  await expectFocus(page, 'account-code-saved');
  sync.delay = 0;
  const code = await shownCode(page);
  await press(page, 'Enter', 'account-check-field');
  await typeInto(page, CHECK_LABEL, code.slice(-4));
  await page.keyboard.press('Enter');
  await expect(page.getByText('This screen is in your account.')).toBeVisible();
  // The key is never kept once the account exists.
  expect(JSON.stringify(await readKv(page, 'sync/state'))).not.toContain('Owner2468Key');
  expect(errors.filter((error) => !ANSWERED.test(error))).toEqual([]);
});

test('Create answered with new accounts closed leaves only Join', async ({ page }) => {
  const errors = watchErrors(page);
  const sync = fakeSync();
  await mockAddons(page);
  await mockSync(page, sync);
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await openSettings(page);
  // Settings asked while there was room; the service has closed since.
  await openAccount(page, 'account-create');
  sync.maxAccounts = 0;
  await page.keyboard.press('Enter');
  await expectFocus(page, 'account-join');
  await expect(page.getByText("New accounts aren't open yet.")).toHaveCount(1);
  await expect(page.locator('[data-focus-key="account-create"]')).toHaveCount(0);
  expect(sync.requests.filter((request) => request === 'POST /v1/account/create')).toHaveLength(1);
  // Kept, so Settings does not offer Create again until it asks the service the next day.
  const saved = await page.evaluate(() => localStorage.getItem('bannertv.syncStatus'));
  expect(JSON.parse(saved ?? '{}')).toMatchObject({ create: false });
  await pressBack(page);
  await expectFocus(page, 'settings-account');
  await page.keyboard.press('Enter');
  await expectFocus(page, 'account-join');
  expect(errors.filter((error) => !ANSWERED.test(error))).toEqual([]);
});

test('Settings > Profiles says when the account has more profiles than a screen shows', async ({
  page,
  browser,
}) => {
  test.slow();
  const sync = fakeSync();
  await mockAddons(page);
  await mockSync(page, sync);
  const theirs = [
    ADA,
    { id: 'bea002', name: 'Bea', colour: 3 },
    { id: 'cy0003', name: 'Cy', colour: 4 },
    { id: 'dee004', name: 'Dee', colour: 5 },
  ];
  await seedProfiles(page, { profiles: [main(), ...theirs], lastId: 'main', askAtLaunch: false });
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await openSettings(page);
  await openAccount(page, 'account-create');
  const code = await createAccount(page);

  const other = await secondScreen(browser, sync);
  const errors = watchErrors(other);
  await other.goto(APP_URL);
  await expectFocus(other, `${FIRST_ROW}-tile-0`);
  await openSettings(other);
  await openAccount(other, 'account-create');
  await reloadsAfter(other, () => typeCode(other, code));
  // With the account's five profiles, BannerTV asks who is watching.
  await expectFocus(other, 'profile-main');
  await other.keyboard.press('Enter');
  await expectFocus(other, `${FIRST_ROW}-tile-0`);

  // Both screens add a sixth profile before they hear of the other's: the account has seven.
  await pressBack(page);
  await expectFocus(page, 'settings-account');
  await press(page, 'ArrowUp', 'settings-home-rows');
  await press(page, 'ArrowUp', 'settings-profiles');
  await press(page, 'Enter', 'profiles-main');
  await addProfile(page, 'Zed');
  await openSettings(other);
  await press(other, 'ArrowRight', 'settings-profiles');
  await press(other, 'Enter', 'profiles-main');
  await addProfile(other, 'Yan');
  const note = 'The account has 1 more profile. Screens show six, and deleting one here shows it.';
  await expect(page.getByText(note)).toHaveCount(0);

  await syncFromProfiles(page);
  await syncFromProfiles(other);
  await syncFromProfiles(page);
  // Each screen shows six, the same six, and says one more is in the account.
  await expect(other.getByText(note)).toBeVisible();
  await expect(page.getByText(note)).toBeVisible();
  const shown = await profileIds(page);
  expect(shown).toHaveLength(6);
  expect((await profileIds(other)).slice().sort()).toEqual(shown.slice().sort());
  expect(errors).toEqual([]);
});

test('Leave forgets the account on this screen and keeps everything on it', async ({ page }) => {
  const errors = watchErrors(page);
  const sync = fakeSync();
  await mockAddons(page);
  await mockSync(page, sync);
  await seedWatching(page);
  await page.goto(APP_URL);
  await expectFocus(page, CONTINUE_TILE);
  await openSettings(page);
  await openAccount(page, 'account-create');
  await createAccount(page);

  await press(page, 'ArrowDown', 'account-show-code');
  await press(page, 'ArrowDown', 'account-leave');
  await press(page, 'Enter', 'account-leave-dialog-cancel');
  await expect(
    page.getByRole('dialog', { name: 'Leave the account on this screen?' }),
  ).toBeVisible();
  await press(page, 'ArrowLeft', 'account-leave-dialog-confirm');
  await page.keyboard.press('Enter');
  await expect(
    page.getByText('This screen has left the account and keeps everything it had.'),
  ).toBeVisible();
  await expectFocus(page, 'account-create');
  expect(await page.evaluate(() => localStorage.getItem('bannertv.syncOn'))).toBeNull();
  expect(await libraryIds(page)).toEqual([SINTEL]);
  expect(errors).toEqual([]);
});

test("Show account code and Delete ask for Main's PIN, which cannot be taken off without it, and deleting ends the account on every screen", async ({
  page,
  browser,
}) => {
  test.slow();
  const errors = watchErrors(page);
  const sync = fakeSync();
  await mockAddons(page);
  await mockSync(page, sync);
  await seedProfiles(page, {
    profiles: [main(lockedWith('2468'))],
    lastId: 'main',
    askAtLaunch: false,
  });
  const mainPin = () =>
    page.evaluate(() => {
      const saved = JSON.parse(localStorage.getItem('bannertv.profiles')!) as {
        profiles: { id: string; pin?: unknown }[];
      };
      return saved.profiles.find((profile) => profile.id === 'main')?.pin ?? null;
    });
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await openSettings(page);
  await openAccount(page, 'account-create');
  // Back from the PIN pad goes back to the button pressed.
  await press(page, 'Enter', 'account-pin-1');
  await pressBack(page);
  await expectFocus(page, 'account-create');
  const code = await createAccount(page, '2468');

  const other = await secondScreen(browser, sync);
  const otherErrors = watchErrors(other);
  await other.goto(APP_URL);
  await expectFocus(other, `${FIRST_ROW}-tile-0`);
  await openSettings(other);
  await openAccount(other, 'account-create');
  await reloadsAfter(other, () => typeCode(other, code));
  await expectFocus(other, `${FIRST_ROW}-tile-0`);

  // The only profile opens without its PIN, but Main's page asks for it before removing it.
  await pressBack(page);
  await expectFocus(page, 'settings-account');
  await press(page, 'ArrowUp', 'settings-home-rows');
  await press(page, 'ArrowUp', 'settings-profiles');
  await press(page, 'Enter', 'profiles-main');
  await press(page, 'Enter', 'profile-name');
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(150);
  await press(page, 'ArrowDown', 'profile-save');
  await press(page, 'ArrowDown', 'profile-pin');
  await press(page, 'ArrowDown', 'profile-pin-remove');
  await press(page, 'Enter', 'profile-pin-pad-1');
  await expect(page.getByRole('dialog', { name: 'Enter the PIN for Main' })).toBeVisible();
  await pressBack(page);
  await expectFocus(page, 'profile-pin-remove');
  expect(await mainPin()).not.toBeNull();
  await pressBack(page);
  await expectFocus(page, 'profiles-main');
  await pressBack(page);
  await expectFocus(page, 'settings-profiles');
  await press(page, 'ArrowDown', 'settings-home-rows');
  await press(page, 'ArrowDown', 'settings-account');
  await press(page, 'Enter', 'account-sync');

  // The code again, still behind Main's PIN.
  await press(page, 'ArrowDown', 'account-show-code');
  await press(page, 'Enter', 'account-pin-1');
  await pressBack(page);
  await expectFocus(page, 'account-show-code');
  await press(page, 'Enter', 'account-pin-1');
  await typeDigits(page, '1111');
  await expect(page.getByText('That PIN is not right.')).toBeVisible();
  await typeDigits(page, '2468');
  await expectFocus(page, 'account-hide-code');
  expect(await shownCode(page)).toBe(code);
  await press(page, 'Enter', 'account-sync');

  await press(page, 'ArrowDown', 'account-show-code');
  await press(page, 'ArrowDown', 'account-leave');
  await press(page, 'ArrowDown', 'account-delete');
  await press(page, 'Enter', 'account-pin-1');
  await pressBack(page);
  await expectFocus(page, 'account-delete');
  await press(page, 'Enter', 'account-pin-1');
  await typeDigits(page, '2468');
  await expectFocus(page, 'account-delete-dialog-cancel');
  const dialog = page.getByRole('dialog', { name: 'Delete the account for every screen?' });
  await expect(dialog).toContainText('Cloudflare keeps backups of the service for up to 7 days');
  await press(page, 'ArrowLeft', 'account-delete-dialog-confirm');
  // A slow connection: Back does nothing while the delete runs, so it cannot be asked twice.
  sync.delay = 1500;
  await page.keyboard.press('Enter');
  const deleting = page.getByText('Deleting the account');
  await expect(deleting).toBeVisible();
  await pressBack(page);
  await pressBack(page);
  await page.waitForTimeout(300);
  await expect(deleting).toBeVisible();
  await expect(page.locator('[data-focus-key="account-delete"]')).toHaveCount(0);
  await expect(
    page.getByText('The account is deleted. This screen keeps everything it has.'),
  ).toBeVisible();
  sync.delay = 0;
  await expectFocus(page, 'account-create');
  expect(sync.requests.filter((request) => request === 'POST /v1/account/delete')).toHaveLength(1);
  expect(errors).toEqual([]);

  // The other screen finds out at its next sync, and keeps what it has.
  await openSettings(other);
  await openAccount(other, 'account-sync');
  await other.keyboard.press('Enter');
  await expect(
    other.getByText('This account was deleted on another screen.', { exact: false }),
  ).toBeVisible();
  await expectFocus(other, 'account-leave');
  await other.keyboard.press('Enter');
  await expectFocus(other, 'account-create');
  expect(otherErrors.filter((error) => !ANSWERED.test(error))).toEqual([]);
});

test("a profile's page opened with its PIN asks for it again once another screen has changed it", async ({
  page,
  browser,
}) => {
  test.slow();
  const errors = watchErrors(page);
  const sync = fakeSync();
  // This screen's next regular pull is half an hour away: the journey moves its clock on.
  await page.clock.install();
  await mockAddons(page);
  await mockSync(page, sync);
  await seedProfiles(page, {
    profiles: [main(), { ...GUEST, ...lockedWith('1357') }],
    lastId: 'main',
    askAtLaunch: false,
  });
  const guestPin = (screen: Page) =>
    screen.evaluate((id) => {
      const saved = JSON.parse(localStorage.getItem('bannertv.profiles')!) as {
        profiles: { id: string; pin?: { hash: string } }[];
      };
      return saved.profiles.find((profile) => profile.id === id)?.pin?.hash ?? null;
    }, GUEST_ID);
  /** From Settings, Guest's page opened with its PIN, down to `to`. */
  const openGuest = async (screen: Page, to: string) => {
    await press(screen, 'Enter', 'profiles-main');
    await press(screen, 'ArrowDown', `profiles-${GUEST_ID}`);
    await press(screen, 'Enter', 'profiles-pin-1');
    await typeDigits(screen, '1357');
    await expectFocus(screen, 'profile-name');
    await screen.keyboard.press('ArrowDown');
    await expect(screen.locator('[data-focused="true"]')).toHaveAttribute(
      'data-focus-key',
      /^profile-colour-/,
    );
    await screen.waitForTimeout(150);
    for (const key of ['profile-kids', 'profile-save', 'profile-pin', 'profile-pin-remove']) {
      await press(screen, 'ArrowDown', key);
      if (key === to) return;
    }
  };
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await openSettings(page);
  await openAccount(page, 'account-create');
  const code = await createAccount(page);

  // The other screen has nothing of its own: it becomes the account's, Guest's PIN included.
  const other = await secondScreen(browser, sync);
  const otherErrors = watchErrors(other);
  await seedProfiles(other, { profiles: [main()], lastId: 'main', askAtLaunch: false });
  await other.goto(APP_URL);
  await expectFocus(other, `${FIRST_ROW}-tile-0`);
  await openSettings(other);
  await openAccount(other, 'account-create');
  await reloadsAfter(other, () => typeCode(other, code));
  await expectFocus(other, `${FIRST_ROW}-tile-0`);

  // Guest's page opens here with its PIN.
  await pressBack(page);
  await expectFocus(page, 'settings-account');
  await press(page, 'ArrowUp', 'settings-home-rows');
  await press(page, 'ArrowUp', 'settings-profiles');
  await openGuest(page, 'profile-pin-remove');

  // There, Guest's PIN changes.
  await openSettings(other);
  await press(other, 'ArrowRight', 'settings-profiles');
  await openGuest(other, 'profile-pin');
  const pushes = () => sync.requests.filter((request) => request === 'POST /v1/push').length;
  const pushed = pushes();
  await other.keyboard.press('Enter');
  await expect(other.getByRole('dialog', { name: 'Choose a four-digit PIN' })).toBeVisible();
  await typeDigits(other, '2468');
  await expect(other.getByRole('dialog', { name: 'Enter the PIN again' })).toBeVisible();
  await typeDigits(other, '2468');
  await expectFocus(other, 'profile-pin');
  const changed = await guestPin(other);
  await expect.poll(pushes, { timeout: 10000 }).toBeGreaterThan(pushed);

  // Here the regular pull brings it, and Remove PIN asks for the new one.
  await page.clock.fastForward('31:00');
  await expect.poll(() => guestPin(page), { timeout: 10000 }).toBe(changed);
  await page.keyboard.press('Enter');
  const pad = page.getByRole('dialog', { name: 'Enter the PIN for Guest' });
  await expect(pad).toBeVisible();
  await typeDigits(page, '1357');
  await expect(pad.getByText('That PIN is not right.')).toBeVisible();
  await pressBack(page);
  await expectFocus(page, 'profile-pin-remove');
  expect(await guestPin(page)).toBe(changed);
  await page.keyboard.press('Enter');
  await expect(pad).toBeVisible();
  await typeDigits(page, '2468');
  await expectFocus(page, 'profile-pin');
  expect(await guestPin(page)).toBeNull();
  expect(errors).toEqual([]);
  expect(otherErrors).toEqual([]);
});

test('a new PIN being chosen when another screen changes it asks for the changed one first', async ({
  page,
  browser,
}) => {
  test.slow();
  const errors = watchErrors(page);
  const sync = fakeSync();
  await page.clock.install();
  await mockAddons(page);
  await mockSync(page, sync);
  await seedProfiles(page, {
    profiles: [main(), { ...GUEST, ...lockedWith('1357') }],
    lastId: 'main',
    askAtLaunch: false,
  });
  const guestPin = (screen: Page) =>
    screen.evaluate((id) => {
      const saved = JSON.parse(localStorage.getItem('bannertv.profiles')!) as {
        profiles: { id: string; pin?: { hash: string } }[];
      };
      return saved.profiles.find((profile) => profile.id === id)?.pin?.hash ?? null;
    }, GUEST_ID);
  /** From Settings, Guest's page opened with its PIN, down to Change PIN. */
  const openGuest = async (screen: Page) => {
    await press(screen, 'Enter', 'profiles-main');
    await press(screen, 'ArrowDown', `profiles-${GUEST_ID}`);
    await press(screen, 'Enter', 'profiles-pin-1');
    await typeDigits(screen, '1357');
    await expectFocus(screen, 'profile-name');
    await screen.keyboard.press('ArrowDown');
    await expect(screen.locator('[data-focused="true"]')).toHaveAttribute(
      'data-focus-key',
      /^profile-colour-/,
    );
    await screen.waitForTimeout(150);
    for (const key of ['profile-kids', 'profile-save', 'profile-pin']) {
      await press(screen, 'ArrowDown', key);
    }
  };
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await openSettings(page);
  await openAccount(page, 'account-create');
  const code = await createAccount(page);

  const other = await secondScreen(browser, sync);
  const otherErrors = watchErrors(other);
  await seedProfiles(other, { profiles: [main()], lastId: 'main', askAtLaunch: false });
  await other.goto(APP_URL);
  await expectFocus(other, `${FIRST_ROW}-tile-0`);
  await openSettings(other);
  await openAccount(other, 'account-create');
  await reloadsAfter(other, () => typeCode(other, code));
  await expectFocus(other, `${FIRST_ROW}-tile-0`);

  // Here, Change PIN on Guest's page opened with its PIN goes straight to the new one.
  await pressBack(page);
  await expectFocus(page, 'settings-account');
  await press(page, 'ArrowUp', 'settings-home-rows');
  await press(page, 'ArrowUp', 'settings-profiles');
  await openGuest(page);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Choose a four-digit PIN' })).toBeVisible();

  // There, Guest's PIN changes, and the regular pull brings it here while the pad is open.
  await openSettings(other);
  await press(other, 'ArrowRight', 'settings-profiles');
  await openGuest(other);
  const pushes = () => sync.requests.filter((request) => request === 'POST /v1/push').length;
  const pushed = pushes();
  await other.keyboard.press('Enter');
  await typeDigits(other, '2468');
  await expect(other.getByRole('dialog', { name: 'Enter the PIN again' })).toBeVisible();
  await typeDigits(other, '2468');
  await expectFocus(other, 'profile-pin');
  const changed = await guestPin(other);
  await expect.poll(pushes, { timeout: 10000 }).toBeGreaterThan(pushed);
  await page.clock.fastForward('31:00');
  await expect.poll(() => guestPin(page), { timeout: 10000 }).toBe(changed);

  // The new PIN typed here is not kept until the changed one is entered.
  await typeDigits(page, '9999');
  const pad = page.getByRole('dialog', { name: 'Enter the PIN for Guest' });
  await expect(pad).toBeVisible();
  await expect(
    pad.getByText('This PIN was just changed on another screen.', { exact: false }),
  ).toBeVisible();
  expect(await guestPin(page)).toBe(changed);
  await typeDigits(page, '2468');
  await expect(page.getByRole('dialog', { name: 'Choose a four-digit PIN' })).toBeVisible();
  await typeDigits(page, '9999');
  await expect(page.getByRole('dialog', { name: 'Enter the PIN again' })).toBeVisible();
  await typeDigits(page, '9999');
  await expectFocus(page, 'profile-pin');
  const chosen = await guestPin(page);
  expect(chosen).not.toBe(changed);
  expect(chosen).not.toBeNull();
  expect(errors).toEqual([]);
  expect(otherErrors).toEqual([]);
});

test('the welcome offers the account beside it: Create opens BannerTV account on Create, and Join on the code', async ({
  page,
  browser,
}) => {
  test.slow();
  const errors = watchErrors(page);
  const sync = fakeSync();
  await mockAddons(page, { firstRun: true });
  await mockSync(page, sync);
  await page.goto(APP_URL);
  // Start browsing keeps focus: the account is offered, never in the way.
  await expectFocus(page, 'welcome-start');
  const welcome = page.getByRole('dialog', { name: 'Welcome to BannerTV' });
  await expect(
    welcome.getByRole('region', { name: 'Watching on more than one screen?' }),
  ).toBeVisible();
  await press(page, 'ArrowRight', 'welcome-add');
  await press(page, 'ArrowRight', 'welcome-account-join');
  await press(page, 'ArrowUp', 'welcome-account-create');

  // Create leaves the welcome for the account, on its own Create, with what it means; nothing is made yet.
  await press(page, 'Enter', 'account-create');
  await expect(welcome).toHaveCount(0);
  await expect(page.getByText('Everything is encrypted on this screen')).toBeVisible();
  expect(sync.requests).toEqual(['GET /v1/status']);
  const code = await createAccount(page);
  await pressBack(page);
  await expectFocus(page, 'settings-account');

  // A new screen, with no more accounts allowed: the welcome offers only Join.
  sync.maxAccounts = 1;
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const other = await context.newPage();
  const otherErrors = watchErrors(other);
  await mockAddons(other, { firstRun: true });
  await mockSync(other, sync);
  await other.goto(APP_URL);
  await expectFocus(other, 'welcome-start');
  await expect(other.locator('[data-focus-key="welcome-account-join"]')).toBeVisible();
  await expect(other.locator('[data-focus-key="welcome-account-create"]')).toHaveCount(0);
  await press(other, 'ArrowRight', 'welcome-add');
  await press(other, 'ArrowRight', 'welcome-account-join');

  // Join opens straight on the code; Back goes to the account's menu, then Settings.
  await press(other, 'Enter', 'account-code-field');
  await pressBack(other);
  await expectFocus(other, 'account-join');
  await pressBack(other);
  await expectFocus(other, 'settings-account');
  await press(other, 'Enter', 'account-join');
  await press(other, 'Enter', 'account-code-field');
  await typeInto(other, CODE_LABEL, code);
  // The screen has nothing of its own yet, so it simply becomes the account's, and starts
  // again on Home: the welcome was left for good.
  await reloadsAfter(other, () => other.keyboard.press('Enter'));
  await expectFocus(other, `${DEMO_ROW}-tile-0`);
  expect(await other.evaluate(() => localStorage.getItem('bannertv.syncOn'))).toBe('1');
  expect(errors).toEqual([]);
  expect(otherErrors).toEqual([]);
});

test('a screen in an account whose localStorage lost the welcome and its flag offers no account there', async ({
  page,
}) => {
  const sync = fakeSync();
  await mockAddons(page);
  await mockSync(page, sync);
  // At the next launch only: the welcome and the account's flag are gone, as a lost write leaves them.
  await page.addInitScript(() => {
    if (sessionStorage.getItem('bannertv.test.lose') !== '1') return;
    sessionStorage.setItem('bannertv.test.lose', 'done');
    localStorage.removeItem('bannertv.welcomed');
    localStorage.removeItem('bannertv.syncOn');
  });
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await openSettings(page);
  await openAccount(page, 'account-create');
  await createAccount(page);

  await page.evaluate(() => sessionStorage.setItem('bannertv.test.lose', '1'));
  await page.reload();
  await expectFocus(page, 'welcome-start');
  // The engine finds the account it kept, and the welcome leaves the offer out.
  await expect.poll(() => page.evaluate(() => localStorage.getItem('bannertv.syncOn'))).toBe('1');
  await expect(page.getByRole('region', { name: 'Watching on more than one screen?' })).toHaveCount(
    0,
  );
});

test('Diagnostics says whether this is a secure context and Web Crypto gives the known answers', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await mockAddons(page);
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await openSettings(page);
  await press(page, 'ArrowDown', 'settings-probing');
  await press(page, 'ArrowDown', 'settings-subtitle-style');
  await press(page, 'ArrowDown', 'settings-still-watching');
  await press(page, 'ArrowDown', 'settings-diagnostics');
  await press(page, 'Enter', 'diagnostics-refresh');
  const row = (label: string) =>
    page.locator('div', { has: page.getByText(label, { exact: true }) }).last();
  await expect(row('Secure context')).toContainText('yes');
  await expect(row('Web Crypto')).toContainText('works');
  expect(errors).toEqual([]);
});
