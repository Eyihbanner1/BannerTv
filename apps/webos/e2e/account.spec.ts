import { type Browser, expect, type Page, test } from '@playwright/test';
import { FIRST_ROW, mockAddons } from './addons';
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
import { APP_URL, expectFocus, expectFocusLabel, press, pressBack, watchErrors } from './tv';

const BUNNY = 'tt1254207';
const SINTEL = 'tt1727587';
const CONTINUE_TILE = 'home-continue-tile-0';
const ADA = { id: 'ada001', name: 'Ada', colour: 2 };
const GUEST = { id: GUEST_ID, name: 'Guest', colour: 1 };
const CHECK_LABEL = 'Last four characters of the code';
const CODE_LABEL = 'Account code';

// Chromium here gives a reloaded page a new document with a storage connection of its own,
// which can open before the old document's last localStorage writes have arrived, so a
// join's reload could start from an empty localStorage. The TVs' engines (Chromium 68 on
// webOS, the Android WebView) keep one, as this does.
test.use({ launchOptions: { args: ['--disable-features=RenderDocument'] } });

/** An error status the service answers with on purpose, which Chromium logs. */
const ANSWERED = /^Failed to load resource: the server responded with a status of 401/;

/**
 * Sintel on My List and Big Buck Bunny part way, saved a minute ago. The
 * times are not whole seconds: whole seconds would read as Trakt's.
 */
async function seedWatching(page: Page): Promise<void> {
  const at = Date.now() - 60000 + 123;
  await page.addInitScript(
    (seed: Record<string, unknown>) => {
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

/** Runs `action`, which ends in BannerTV starting again, and waits for that. */
async function reloadsAfter(page: Page, action: () => Promise<void>): Promise<void> {
  const loaded = page.waitForEvent('load', { timeout: 20000 });
  await action();
  await loaded;
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
  await other.goto(APP_URL);
  await expectFocus(other, `${FIRST_ROW}-tile-0`);
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
  expect(await readKv(other, 'sync-aside')).toBeTruthy();
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

test("Show account code and Delete ask for Main's PIN, and deleting ends the account on every screen", async ({
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
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await openSettings(page);
  await openAccount(page, 'account-create');
  const code = await createAccount(page, '2468');

  const other = await secondScreen(browser, sync);
  const otherErrors = watchErrors(other);
  await other.goto(APP_URL);
  await expectFocus(other, `${FIRST_ROW}-tile-0`);
  await openSettings(other);
  await openAccount(other, 'account-create');
  await reloadsAfter(other, () => typeCode(other, code));
  await expectFocus(other, `${FIRST_ROW}-tile-0`);

  // The code again, behind Main's PIN.
  await press(page, 'ArrowDown', 'account-show-code');
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
  await typeDigits(page, '2468');
  await expectFocus(page, 'account-delete-dialog-cancel');
  const dialog = page.getByRole('dialog', { name: 'Delete the account for every screen?' });
  await expect(dialog).toContainText('Cloudflare keeps backups of the service for up to 7 days');
  await press(page, 'ArrowLeft', 'account-delete-dialog-confirm');
  await page.keyboard.press('Enter');
  await expect(
    page.getByText('The account is deleted. This screen keeps everything it has.'),
  ).toBeVisible();
  await expectFocus(page, 'account-create');
  expect(sync.requests).toContain('POST /v1/account/delete');
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
  await press(page, 'ArrowDown', 'settings-diagnostics');
  await press(page, 'Enter', 'diagnostics-refresh');
  const row = (label: string) =>
    page.locator('div', { has: page.getByText(label, { exact: true }) }).last();
  await expect(row('Secure context')).toContainText('yes');
  await expect(row('Web Crypto')).toContainText('works');
  expect(errors).toEqual([]);
});
