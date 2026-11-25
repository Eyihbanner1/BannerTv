import { expect, type Page, type Route, test } from '@playwright/test';
import { PAIR_SERVICE, POLL_MS } from '../src/data/pairing';
import { FIRST_ROW, mockAddons, SERIES_ROW } from './addons';
import { ANDROID_URL, androidOpens, openAsAndroid, openFocusedTitle, playerOps } from './android';
import { DEFAULT_STREAMS, mockPlayback, readKv, seedStreamAddon, type TestStream } from './play';
import { leavePlayer, MOVIE, openMovie, openSheet, subtitlesDiagnostics, video } from './player';
import { KIDS_ID, main, seedProfiles } from './profiles';
import {
  FAKE_SUBDL_KEY,
  type KeyRelay,
  keyRelay,
  readQrCode,
  standInSubdl,
  SUBDL_EPISODE_RELEASE,
  SUBDL_FILM_FILE,
  SUBDL_FILM_RELEASE,
  type SubdlScenario,
} from './subdl';
import {
  addStorageInitScript,
  APP_URL,
  expectFocus,
  expectFocusLabel,
  openSection,
  press,
  pressBack,
  watchErrors,
} from './tv';

/*
 * SubDL beside the addons, with the viewer's own key (ADR 0003, step D), against a stand-in for
 * SubDL's API and download host (e2e/subdl.ts). The key is obviously fake. A key sent from the
 * phone goes through the real phone page and the real pairing relay, both run in the test, and
 * the journeys read the TV's QR codes as a phone camera would.
 */

/** Elephants Dream's stream, named for the made-up film's release. */
const FILM_STREAM: TestStream = { ...DEFAULT_STREAMS[0]!, filename: `${SUBDL_FILM_RELEASE}.mkv` };

/** The key as the TV keeps it once SubDL accepted it. */
const SAVED_KEY = { 'subdl/key': { key: FAKE_SUBDL_KEY, state: 'works' } };

/** A SubDL version row in the subtitles sheet. */
const subdlRows = (page: Page) => page.locator('[data-focus-key^="player-tracks-file-subdl#"]');

/** Starts the TV with the film's stream, OpenSubtitles' usual files, and SubDL's stand-in. */
async function setUp(
  page: Page,
  scenario: SubdlScenario,
  options: { key?: boolean; streams?: Record<string, readonly TestStream[]> } = {},
) {
  await mockAddons(page);
  await seedStreamAddon(page, {
    preferences: { subtitleLanguage: 'eng' },
    kv: options.key === false ? {} : SAVED_KEY,
  });
  const mock = await mockPlayback(page, { streams: options.streams ?? { [MOVIE]: [FILM_STREAM] } });
  const subdl = await standInSubdl(page, scenario);
  return { mock, subdl };
}

/** Plays Elephants Dream from Home. */
async function playFilm(page: Page) {
  await openMovie(page);
  await press(page, 'Enter', 'player-surface');
  await expect.poll(async () => (await video(page)).playing).toBe(true);
}

/** Settings > SubDL subtitles, from Home. */
async function openSubdlScreen(page: Page) {
  await openSection(page, 'settings');
  await expectFocus(page, 'settings-stream-choice');
  await press(page, 'ArrowRight', 'settings-profiles');
  await press(page, 'ArrowDown', 'settings-home-rows');
  await press(page, 'ArrowDown', 'settings-subdl');
  await press(page, 'Enter', 'subdl-key');
}

const json = (route: Route, body: unknown) =>
  route.fulfill({
    contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*' },
    body: JSON.stringify(body),
  });

const status = (page: Page) => page.getByTestId('subdl-status');

/**
 * Holds SubDL's key checks until the returned function is called, so a journey sees what the
 * screen says while one runs. Call after standInSubdl, which then answers.
 */
async function holdKeyChecks(page: Page): Promise<() => void> {
  let answer = () => undefined as void;
  const answered = new Promise<void>((resolve) => {
    answer = resolve;
  });
  await page.route(/^https:\/\/api\.subdl\.com\/api\/v2\/me/, async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fallback();
    await answered;
    return route.fallback();
  });
  return answer;
}

/**
 * SubDL's own page for making and copying a key, which the screen's QR code opens when the phone
 * way cannot work: SUBDL_KEY_PAGE in src/data/subdl.ts, written out so the journeys need not
 * load the app's stores in Node.
 */
const SUBDL_KEY_PAGE = 'https://subdl.com/panel/api';

/** The relay's SubDL key page, with a session's code and the TV's K (43 base64url characters). */
const PHONE_KEY_PAGE = new RegExp(
  `^${PAIR_SERVICE.replace(/[.]/g, '\\.')}/subdl#code=([A-Z0-9]{6})&k=([A-Za-z0-9_-]{43})$`,
);

/**
 * The SubDL screen's phone QR code, read: the address in it, the session's code and the TV's
 * sealing key K. Nothing here prints what the code holds, since K is in it.
 */
async function readPhoneQr(page: Page): Promise<{ address: string; code: string; k: string }> {
  const address = await readQrCode(page.getByTestId('subdl-phone-qr'));
  const parts = PHONE_KEY_PAGE.exec(address);
  expect(parts !== null, "the QR code opens the relay's SubDL key page").toBe(true);
  const [, code, k] = parts as unknown as [string, string, string];
  expect(Buffer.from(k, 'base64url').length, 'K is 32 bytes').toBe(32);
  return { address, code, k };
}

/**
 * Opens what the phone page sealed, with K and the session's code, the way the TV does
 * (src/data/phone-key.ts) but with Node's Web Crypto: AES-256-GCM, the 12-byte IV first, the
 * code in the additional data. Rejects if anything about it is otherwise.
 */
async function openSealed(k: string, code: string, sealed: string): Promise<string> {
  const bytes = Uint8Array.from(Buffer.from(sealed, 'base64url'));
  const key = await crypto.subtle.importKey(
    'raw',
    Uint8Array.from(Buffer.from(k, 'base64url')),
    'AES-GCM',
    false,
    ['decrypt'],
  );
  const plain = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: bytes.subarray(0, 12),
      additionalData: new TextEncoder().encode(`bannertv subdl-key v1 ${code}`),
      tagLength: 128,
    },
    key,
    bytes.subarray(12),
  );
  return new TextDecoder().decode(plain);
}

/** Waits for the screen's phone QR code to hold a session other than `last`, and reads it. */
async function nextPhoneQr(page: Page, last: { code: string }) {
  let next = { address: '', code: '', k: '' };
  await expect(async () => {
    next = await readPhoneQr(page);
    expect(next.code).not.toBe(last.code);
  }).toPass();
  return next;
}

/**
 * The viewer's phone: a second page of the TV's browser opens what the QR code holds, as its
 * camera would, from the relay, and the viewer pastes `key` and sends it to the TV.
 */
async function sendFromPhone(relay: KeyRelay, page: Page, address: string, key: string) {
  const phone = await page.context().newPage();
  await phone.setViewportSize({ width: 390, height: 844 });
  await relay.servePhone(phone);
  await phone.goto(address);
  // The page has read the fragment and cleared it from the address bar.
  expect(phone.url().includes('#'), 'the fragment is left in the address bar').toBe(false);
  await expect(
    phone.getByRole('heading', { name: 'Send your SubDL key to BannerTV' }),
  ).toBeVisible();
  await expect(phone.getByRole('link', { name: 'Open SubDL' })).toHaveAttribute(
    'href',
    SUBDL_KEY_PAGE,
  );
  const field = phone.getByLabel('SubDL key');
  await field.fill(key);
  await phone.getByRole('button', { name: 'Send to TV' }).click();
  await expect(phone.getByRole('status')).toHaveText(
    "Sent. Check your TV: it's checking the key with SubDL now.",
  );
  await expect(field).toHaveValue('');
  return phone;
}

test('a SubDL key typed on the TV is checked, kept and never shown', async ({ page }) => {
  const { subdl } = await setUp(page, 'films', { key: false });
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await openSection(page, 'settings');
  await expectFocus(page, 'settings-stream-choice');
  await press(page, 'ArrowRight', 'settings-profiles');
  await press(page, 'ArrowDown', 'settings-home-rows');
  await press(page, 'ArrowDown', 'settings-subdl');
  await expectFocusLabel(page, 'SubDL subtitles: Off');
  await press(page, 'Enter', 'subdl-key');
  await expect(page.getByText("This code opens SubDL's API page.", { exact: false })).toBeVisible();
  await expect(page.locator('[data-focus-key="subdl-remove"]')).toHaveCount(0);

  // Not a key: said so, and nothing is kept or asked.
  const input = page.locator('[data-focus-key="subdl-key"] input');
  await page.keyboard.press('Enter');
  await expect(input).toBeFocused();
  await page.keyboard.type('not a key');
  await page.keyboard.press('Enter');
  await expect(status(page)).toHaveText(
    "That doesn't look like a SubDL key. Check it and try again.",
  );
  expect(await readKv(page, 'subdl/key')).toBeUndefined();

  await input.fill(` ${FAKE_SUBDL_KEY} `);
  await page.keyboard.press('Enter');
  await expect(status(page)).toHaveText('Your key works. BannerTV will look on SubDL too.');
  await expect(input).toHaveValue('');
  await expect(page.getByText('A key is saved. Type a new one to replace it.')).toBeVisible();
  await expect
    .poll(() => readKv(page, 'subdl/key'))
    .toEqual({ key: FAKE_SUBDL_KEY, state: 'works' });
  expect(subdl.meChecks).toBe(1);
  expect(subdl.searches).toEqual([]);
  // The key shows nowhere on the screen.
  expect(await page.locator('body').innerText()).not.toContain(FAKE_SUBDL_KEY);

  await pressBack(page);
  await expectFocusLabel(page, 'SubDL subtitles: On');
});

test('a SubDL key pasted on the phone page reaches the TV sealed, and is checked, kept and never shown', async ({
  page,
}) => {
  test.skip(!PAIR_SERVICE, 'The pairing relay is not deployed yet');
  const { subdl } = await setUp(page, 'films', { key: false });
  const relay = keyRelay();
  await relay.serveTv(page);
  const answerCheck = await holdKeyChecks(page);
  const urls: string[] = [];
  page.context().on('request', (request) => urls.push(request.url()));
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await openSubdlScreen(page);

  // The TV asks for a key session, and draws its QR code with the relay's host under it.
  await expect(page.getByRole('heading', { name: 'Send it from your phone' })).toBeVisible();
  await expect(
    page.getByText(
      "Scan with your phone's camera. Get your free key at SubDL on the phone and paste it on the page that opens.",
    ),
  ).toBeVisible();
  await expect(page.getByText(new URL(PAIR_SERVICE).host, { exact: true })).toBeVisible();
  await expect(page.getByTestId('subdl-page-qr')).toHaveCount(0);
  expect(relay.opened).toEqual(['subdl-key']);
  const qr = await readPhoneQr(page);
  expect(qr.code).toBe(relay.codes[0]);

  const phone = await sendFromPhone(relay, page, qr.address, FAKE_SUBDL_KEY);
  await expect(status(page)).toHaveText('Key received from your phone. Checking it…');
  answerCheck();
  await expect(status(page)).toHaveText('Your key works. BannerTV will look on SubDL too.');
  await expect
    .poll(() => readKv(page, 'subdl/key'))
    .toEqual({ key: FAKE_SUBDL_KEY, state: 'works' });
  expect(relay.deliveries).toBe(1);
  expect(subdl.meChecks).toBe(1);
  expect(subdl.searches).toEqual([]);
  await expect(page.getByText('A key is saved. Type a new one to replace it.')).toBeVisible();

  // A new code, with a new K, so another key can follow.
  const next = await nextPhoneQr(page, qr);
  expect(relay.opened).toEqual(['subdl-key', 'subdl-key']);
  expect(next.code).toBe(relay.codes[1]);
  expect(next.k === qr.k, 'the new code has a new K').toBe(false);

  // The key is never shown, nor put in an address, and the relay only ever had it sealed:
  // the phone sent the sealed key alone (IV, ciphertext and tag, as base64url), and K never.
  expect(await page.locator('body').innerText()).not.toContain(FAKE_SUBDL_KEY);
  await expect(page.locator('[data-focus-key="subdl-key"] input')).toHaveValue('');
  expect(relay.submitted).toHaveLength(1);
  const sent = JSON.parse(relay.submitted[0]!) as Record<string, unknown>;
  expect(Object.keys(sent)).toEqual(['sealed']);
  expect(sent.sealed).toMatch(/^[A-Za-z0-9_-]+$/);
  const sealed = String(sent.sealed);
  expect(sealed).toHaveLength(Math.ceil(((12 + FAKE_SUBDL_KEY.length + 16) * 4) / 3));
  expect(Buffer.from(sealed, 'base64url').includes(FAKE_SUBDL_KEY), 'the key in the clear').toBe(
    false,
  );
  // Sealed with this session's K, for this session's code only.
  const opened = await openSealed(qr.k, qr.code, sealed);
  expect(opened === FAKE_SUBDL_KEY, 'K and the code open what the phone sent').toBe(true);
  await expect(openSealed(qr.k, next.code, sealed)).rejects.toThrow();
  for (const body of relay.bodies) {
    expect(body).not.toContain(FAKE_SUBDL_KEY);
    expect(body.includes(qr.k), 'K reached the relay').toBe(false);
  }
  expect(urls.length).toBeGreaterThan(0);
  for (const url of urls) {
    expect(url).not.toContain(FAKE_SUBDL_KEY);
    expect(url.includes(qr.k), 'K in an address').toBe(false);
  }
  expect(subdl.keyInUrl).toBe(false);
  await phone.close();
});

test("a key changed on its way from the phone didn't come through: nothing is kept and a new code follows", async ({
  page,
}) => {
  test.skip(!PAIR_SERVICE, 'The pairing relay is not deployed yet');
  const { subdl } = await setUp(page, 'films', { key: false });
  // The relay changes one character of the first sealed key it passes on.
  const relay = keyRelay({ tamper: true });
  await relay.serveTv(page);
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await openSubdlScreen(page);
  const first = await readPhoneQr(page);

  const phone = await sendFromPhone(relay, page, first.address, FAKE_SUBDL_KEY);
  await expect(status(page)).toHaveText(
    "That didn't come through. Scan the new code and send it again.",
  );
  expect(relay.deliveries).toBe(1);
  const second = await nextPhoneQr(page, first);
  expect(relay.opened).toEqual(['subdl-key', 'subdl-key']);
  expect(second.code).toBe(relay.codes[1]);
  expect(second.k === first.k, 'the new code has a new K').toBe(false);
  // Nothing was kept, and SubDL was asked nothing.
  expect(await readKv(page, 'subdl/key')).toBeUndefined();
  expect(subdl.meChecks).toBe(0);
  await expect(page.getByText('A key is saved. Type a new one to replace it.')).toHaveCount(0);
  expect(await page.locator('body').innerText()).not.toContain(FAKE_SUBDL_KEY);
  await phone.close();

  // Sent again with the new code, as the TV asks, it comes through.
  const again = await sendFromPhone(relay, page, second.address, FAKE_SUBDL_KEY);
  await expect(status(page)).toHaveText('Your key works. BannerTV will look on SubDL too.');
  await expect
    .poll(() => readKv(page, 'subdl/key'))
    .toEqual({ key: FAKE_SUBDL_KEY, state: 'works' });
  expect(subdl.meChecks).toBe(1);
  await again.close();
});

test("an older relay's addon session is not used: the screen shows the code that opens SubDL's page", async ({
  page,
}) => {
  test.skip(!PAIR_SERVICE, 'The pairing relay is not deployed yet');
  await setUp(page, 'films', { key: false });
  // The relay ignores ?for= and answers as it did before session kinds: no kind, the addon page.
  const relay = keyRelay({ older: true });
  await relay.serveTv(page);
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await openSubdlScreen(page);
  await expect(page.getByTestId('subdl-page-qr')).toBeVisible();
  expect(await readQrCode(page.getByTestId('subdl-page-qr'))).toBe(SUBDL_KEY_PAGE);
  await expect(page.getByText("This code opens SubDL's API page.", { exact: false })).toBeVisible();
  await expect(page.getByTestId('subdl-phone-qr')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Send it from your phone' })).toHaveCount(0);
  await expect(page.locator('[data-focus-key="subdl-phone-retry"]')).toHaveCount(0);
  expect(relay.opened).toEqual(['subdl-key']);
  expect(relay.codes).toHaveLength(1);

  // Nor does the TV wait on the session it was given, or ask for another.
  await page.waitForTimeout(POLL_MS + 1000);
  expect(relay.collects).toBe(0);
  expect(relay.opened).toHaveLength(1);
  await expect(page.getByTestId('subdl-page-qr')).toBeVisible();
});

test('an unreachable relay and a code that has run out each offer a new code, and the new one works', async ({
  page,
}) => {
  test.skip(!PAIR_SERVICE, 'The pairing relay is not deployed yet');
  const { subdl } = await setUp(page, 'films', { key: false });
  // The first session fails to open, and the next one runs out before the phone sends.
  const relay = keyRelay({ failFirstOpen: true, expireFirst: true });
  await relay.serveTv(page);
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await openSubdlScreen(page);

  await expect(page.getByText("BannerTV can't reach its pairing service right now.")).toBeVisible();
  await expect(page.getByTestId('subdl-phone-qr')).toHaveCount(0);
  await expect(page.getByTestId('subdl-page-qr')).toHaveCount(0);
  await press(page, 'ArrowRight', 'subdl-phone-retry');
  await expectFocusLabel(page, 'Try again');
  await press(page, 'Enter', 'subdl-key');
  const first = await readPhoneQr(page);
  expect(relay.opened).toEqual(['subdl-key', 'subdl-key']);
  expect(first.code).toBe(relay.codes[0]);

  await expect(page.getByText('This code has run out.')).toBeVisible();
  await expect(page.getByTestId('subdl-phone-qr')).toHaveCount(0);
  // The TV stops asking about the code that ran out.
  const collects = relay.collects;
  await page.waitForTimeout(POLL_MS + 1000);
  expect(relay.collects).toBe(collects);
  await press(page, 'ArrowRight', 'subdl-phone-retry');
  await expectFocusLabel(page, 'New code');
  await press(page, 'Enter', 'subdl-key');
  const second = await nextPhoneQr(page, first);
  expect(relay.opened).toEqual(['subdl-key', 'subdl-key', 'subdl-key']);
  expect(second.code).toBe(relay.codes[1]);
  expect(second.k === first.k, 'the new code has a new K').toBe(false);

  const phone = await sendFromPhone(relay, page, second.address, FAKE_SUBDL_KEY);
  await expect(status(page)).toHaveText('Your key works. BannerTV will look on SubDL too.');
  await expect
    .poll(() => readKv(page, 'subdl/key'))
    .toEqual({ key: FAKE_SUBDL_KEY, state: 'works' });
  expect(subdl.meChecks).toBe(1);
  await phone.close();
});

test("a TV whose Web Crypto fails its self-test shows the code that opens SubDL's page, and asks the relay nothing", async ({
  page,
}) => {
  test.skip(!PAIR_SERVICE, 'The pairing relay is not deployed yet');
  await setUp(page, 'films', { key: false });
  // AES-GCM that opens to the wrong bytes: what the phone sealed would never open here.
  await page.addInitScript(() => {
    const subtle = window.crypto.subtle;
    const decrypt = subtle.decrypt.bind(subtle);
    subtle.decrypt = (...args: Parameters<SubtleCrypto['decrypt']>) =>
      decrypt(...args).then((plain) => {
        const bytes = new Uint8Array(plain);
        bytes[0] = bytes[0]! ^ 1;
        return bytes.buffer;
      });
  });
  const relay = keyRelay();
  await relay.serveTv(page);
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await openSubdlScreen(page);
  await expect(page.getByTestId('subdl-page-qr')).toBeVisible();
  expect(await readQrCode(page.getByTestId('subdl-page-qr'))).toBe(SUBDL_KEY_PAGE);
  await expect(page.getByTestId('subdl-phone-qr')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Send it from your phone' })).toHaveCount(0);
  await page.waitForTimeout(POLL_MS + 1000);
  expect(relay.opened).toEqual([]);
  await expect(page.getByTestId('subdl-page-qr')).toBeVisible();
});

test("the phone page opened without the TV's code and K shows only the scan message", async ({
  page,
}) => {
  test.skip(!PAIR_SERVICE, 'The pairing relay is not deployed yet');
  const errors = watchErrors(page);
  const relay = keyRelay();
  await relay.servePhone(page);
  const scan = page.getByText("Scan the QR code on your TV's SubDL screen.", { exact: true });
  const field = page.getByLabel('SubDL key');
  const send = page.getByRole('button', { name: 'Send to TV' });
  // A made-up K, 32 bytes as the TV makes, for the cases that have one.
  const k = Buffer.alloc(32, 7).toString('base64url');
  const fragments = [
    '',
    '#code=K7P2QZ',
    `#k=${k}`,
    `#code=K7P2QZ&k=${k.slice(0, 40)}`,
    `#code=K7P2QZ&k=${Buffer.alloc(16, 7).toString('base64url')}`,
    `#code=K7P2Q&k=${k}`,
  ];
  for (const fragment of fragments) {
    // From another document each time: a new fragment alone would not load the page again.
    await page.goto('about:blank');
    await page.goto(`${PAIR_SERVICE}/subdl${fragment}`);
    await expect(scan, fragment).toBeVisible();
    await expect(field, fragment).toBeHidden();
    await expect(send, fragment).toBeHidden();
    expect(new URL(page.url()).hash, fragment).toBe('');
  }
  // With both, the form shows, so the cases above are not passing for nothing.
  await page.goto('about:blank');
  await page.goto(`${PAIR_SERVICE}/subdl#code=K7P2QZ&k=${k}`);
  await expect(field).toBeVisible();
  await expect(send).toBeVisible();
  await expect(scan).toBeHidden();
  expect(relay.bodies).toEqual([]);
  expect(errors).toEqual([]);
});

test("a film's SubDL file named for the release is chosen, with one search and one download", async ({
  page,
}) => {
  const { subdl } = await setUp(page, 'films');
  await playFilm(page);
  await expect(page.getByText('SubDL film, line 1')).toBeVisible();
  await expect.poll(() => subdl.downloads).toEqual([SUBDL_FILM_FILE]);
  expect(subdl.searches).toHaveLength(1);
  expect(subdl.searches[0]).toContain('imdb_id=tt0807840');
  expect(subdl.searches[0]).toContain('languages=en');

  await openSheet(page, 'player-tracks-lang-en');
  await expect(subdlRows(page)).toHaveCount(1);
  await expect(subdlRows(page)).toContainText('SubDL');
  await expect(subdlRows(page)).toContainText('Same release');

  const section = await subtitlesDiagnostics(page);
  await expect(section).toContainText(/SubDL en 1 in \d+\.\d s/);
  expect(subdl.keyInUrl).toBe(false);
  expect(subdl.strays).toEqual([]);
});

/** "first line after 1.2 s" in Diagnostics, as seconds. */
async function firstLineAfter(page: Page): Promise<number> {
  const section = await subtitlesDiagnostics(page);
  await expect(section).toContainText(/first line after \d+\.\d s/);
  return Number(/first line after (\d+\.\d) s/.exec(await section.innerText())![1]);
}

test('a SubDL that never answers holds the first line back no longer than with no key', async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const plain = await browser.newPage();
  await setUp(plain, 'never', { key: false });
  await playFilm(plain);
  await expect(plain.getByText('Hello from the test subtitles')).toBeVisible();
  const without = await firstLineAfter(plain);
  await plain.close();

  const page = await browser.newPage();
  const { subdl } = await setUp(page, 'never');
  await playFilm(page);
  await expect(page.getByText('Hello from the test subtitles')).toBeVisible();
  expect(subdl.searches).toHaveLength(1);
  // SubDL's 8 s pass while playing.
  await page.waitForTimeout(8500);
  const withKey = await firstLineAfter(page);
  expect(Math.abs(withKey - without)).toBeLessThan(0.5);
  const section = page.locator('section', {
    has: page.getByRole('heading', { name: 'Subtitles', exact: true }),
  });
  await expect(section).toContainText('SubDL: no answer in 8 s');
  await page.close();
});

test('the subtitles sheet says SubDL, not an addon, is still being asked', async ({ page }) => {
  await setUp(page, 'never');
  await playFilm(page);
  await expect(page.getByText('Hello from the test subtitles')).toBeVisible();
  await openSheet(page, 'player-tracks-lang-en');
  await expect(page.getByText('Still looking on SubDL…')).toBeVisible();
  await expect(page.getByText(/Still asking \d+ addon/)).toHaveCount(0);
  // Once its 8 s are up, nothing is said to be asked.
  await expect(page.getByText('Still looking on SubDL…')).toHaveCount(0, { timeout: 10_000 });
});

test('SubDL asking to slow down rests it, and its screen says so', async ({ page }) => {
  const { subdl } = await setUp(page, 'busy');
  await playFilm(page);
  await expect(page.getByText('Hello from the test subtitles')).toBeVisible();
  await expect.poll(() => subdl.searches.length).toBe(1);
  const section = await subtitlesDiagnostics(page);
  await expect(section).toContainText('SubDL: too many requests, resting');
  await expect.poll(() => readKv(page, 'subdl/rest')).toMatchObject({ why: 'busy' });

  // Played again while resting: SubDL is not asked.
  await playFilm(page);
  await expect(page.getByText('Hello from the test subtitles')).toBeVisible();
  await page.waitForTimeout(500);
  expect(subdl.searches).toHaveLength(1);
  const again = await subtitlesDiagnostics(page);
  await expect(again).toContainText('SubDL: resting (too many requests)');

  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await openSubdlScreen(page);
  await expect(status(page)).toHaveText(
    "SubDL asked BannerTV to slow down. It'll look there again later.",
  );
});

test('a key SubDL refuses is marked so, and not sent again', async ({ page }) => {
  const { subdl } = await setUp(page, 'refused');
  await playFilm(page);
  await expect(page.getByText('Hello from the test subtitles')).toBeVisible();
  await expect
    .poll(() => readKv(page, 'subdl/key'))
    .toEqual({ key: FAKE_SUBDL_KEY, state: 'refused' });
  const section = await subtitlesDiagnostics(page);
  await expect(section).toContainText('SubDL: key not accepted');
  expect(subdl.searches).toHaveLength(1);

  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await openSection(page, 'settings');
  await expectFocus(page, 'settings-stream-choice');
  await press(page, 'ArrowRight', 'settings-profiles');
  await press(page, 'ArrowDown', 'settings-home-rows');
  await press(page, 'ArrowDown', 'settings-subdl');
  await expectFocusLabel(page, 'SubDL subtitles: Key not accepted');
  await press(page, 'Enter', 'subdl-key');
  await expect(status(page)).toHaveText("SubDL didn't accept this key. Check it and try again.");
  expect(subdl.searches).toHaveLength(1);
});

test('a kids profile has no SubDL row and never asks SubDL, even with a key stored', async ({
  page,
}) => {
  // Big Buck Bunny, a family film, as the kids row's first title (as in profiles.spec.ts).
  const bunny = {
    id: 'tt1254207',
    type: 'movie',
    name: 'Big Buck Bunny',
    genres: ['Animation', 'Family'],
  };
  await mockAddons(page, {
    catalogs: { 'movie/top/genre=Family': (route) => json(route, { metas: [bunny] }) },
  });
  await page.route('https://v3-cinemeta.strem.io/meta/movie/tt1254207.json', (route) =>
    json(route, { meta: { ...bunny, runtime: '10 min' } }),
  );
  await seedStreamAddon(page, {
    preferences: { subtitleLanguage: 'eng' },
    kv: {
      ...SAVED_KEY,
      [`p/${KIDS_ID}/subdl/key`]: { key: FAKE_SUBDL_KEY, state: 'works' },
    },
  });
  // The kids profile's own choice: English subtitles, so SubDL would be asked if it could be.
  await addStorageInitScript(
    page,
    (key) => localStorage.setItem(key, JSON.stringify({ subtitleLanguage: 'eng' })),
    `bannertv.preferences.${KIDS_ID}`,
  );
  await mockPlayback(page);
  const subdl = await standInSubdl(page, 'films');
  await seedProfiles(page, {
    profiles: [main(), { id: KIDS_ID, name: 'Robin', colour: 3, kids: 'PG' }],
    lastId: KIDS_ID,
    askAtLaunch: false,
  });
  await page.goto(APP_URL);
  const kidsRow = 'home-0-movie-top-genre-family';
  await expectFocus(page, `${kidsRow}-tile-0`);
  await press(page, 'Enter', 'details-watch');
  await press(page, 'Enter', 'player-surface');
  await expect.poll(async () => (await video(page)).playing).toBe(true);
  await expect(page.getByText('Hello from the test subtitles')).toBeVisible();
  await page.waitForTimeout(1000);

  for (
    let step = 0;
    step < 4 && (await page.locator('[data-focus-key="details-watch"]').count()) === 0;
    step++
  ) {
    await pressBack(page);
  }
  await expectFocus(page, 'details-watch');
  await pressBack(page);
  await press(page, 'ArrowLeft', 'rail-home');
  for (const item of ['search', 'discover', 'library', 'settings']) {
    await press(page, 'ArrowDown', `rail-${item}`);
  }
  await press(page, 'Enter', 'settings-subtitle-style');
  await expect(page.locator('[data-focus-key="settings-subdl"]')).toHaveCount(0);
  expect(subdl.searches).toEqual([]);
  expect(subdl.downloads).toEqual([]);
  expect(subdl.meChecks).toBe(0);
});

test("a season pack's file for the episode playing is downloaded, never another episode's", async ({
  page,
}) => {
  const episodeStream: TestStream = {
    ...DEFAULT_STREAMS[0]!,
    filename: `${SUBDL_EPISODE_RELEASE}.mkv`,
  };
  const { subdl } = await setUp(page, 'pack', {
    streams: { 'tt8000001:2:3': [episodeStream] },
  });
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await press(page, 'ArrowDown', `${SERIES_ROW}-tile-0`);
  await press(page, 'Enter', 'details-episodes-0');
  await press(page, 'ArrowUp', 'details-season-0');
  await press(page, 'ArrowRight', 'details-season-1');
  await press(page, 'ArrowDown', 'details-episodes-0');
  await press(page, 'ArrowDown', 'details-episodes-1');
  await press(page, 'ArrowDown', 'details-episodes-2');
  await press(page, 'Enter', 'player-surface');
  await expect.poll(async () => (await video(page)).playing).toBe(true);
  await expect(page.getByText('SubDL episode 3, line 1')).toBeVisible();
  expect(subdl.searches).toHaveLength(1);
  expect(subdl.searches[0]).toContain('season=2&episode=3');
  expect(subdl.downloads).toEqual(['/subtitle/9000002/9200013']);
  await page.waitForTimeout(1000);
  // Neither the file named E04 that SubDL says is E03, nor E04's own.
  expect(subdl.downloads).not.toContain('/subtitle/9000002/9200024');
  expect(subdl.downloads).not.toContain('/subtitle/9000002/9200014');
  expect(subdl.keyInUrl).toBe(false);
});

test("a film's subtitles in a ZIP are unpacked in the page", async ({ page }) => {
  const { subdl } = await setUp(page, 'zip-film');
  await playFilm(page);
  await expect(page.getByText('From the ZIP, line 1')).toBeVisible();
  expect(subdl.downloads).toEqual(['/subtitle/9000003-9100003.zip']);
  expect(subdl.keyInUrl).toBe(false);
});

test('the second play of a film uses the saved answer and asks SubDL nothing', async ({ page }) => {
  const { subdl } = await setUp(page, 'films');
  await playFilm(page);
  await expect(page.getByText('SubDL film, line 1')).toBeVisible();
  expect(subdl.searches).toHaveLength(1);
  await leavePlayer(page);
  await press(page, 'Enter', 'details-watch');
  await press(page, 'Enter', 'player-surface');
  await expect(page.getByText('SubDL film, line 1')).toBeVisible();
  expect(subdl.searches).toHaveLength(1);
  const section = await subtitlesDiagnostics(page);
  await expect(section).toContainText(/SubDL en 1 \(saved answer\)/);
});

test('a removed key is forgotten, and SubDL is not asked', async ({ page }) => {
  const { subdl } = await setUp(page, 'films');
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await openSubdlScreen(page);
  await expect(page.getByText('A key is saved. Type a new one to replace it.')).toBeVisible();
  await press(page, 'ArrowDown', 'subdl-save');
  await press(page, 'ArrowDown', 'subdl-remove');
  await page.keyboard.press('Enter');
  await expect(status(page)).toHaveText("Key removed. BannerTV won't look on SubDL.");
  await expectFocus(page, 'subdl-key');
  await expect.poll(() => readKv(page, 'subdl/key')).toBeNull();
  await pressBack(page);
  await expectFocusLabel(page, 'SubDL subtitles: Off');

  await playFilm(page);
  await expect(page.getByText('Hello from the test subtitles')).toBeVisible();
  await page.waitForTimeout(500);
  expect(subdl.searches).toEqual([]);
  const section = await subtitlesDiagnostics(page);
  await expect(section).toContainText('SubDL: no key');
});

test("a key removed while it is being checked stays removed, and the check's answer is not shown", async ({
  page,
}) => {
  await setUp(page, 'films', { key: false });
  // SubDL's key check waits until the key has been removed.
  const answerCheck = await holdKeyChecks(page);
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await openSubdlScreen(page);
  const input = page.locator('[data-focus-key="subdl-key"] input');
  await page.keyboard.press('Enter');
  await expect(input).toBeFocused();
  await input.fill(FAKE_SUBDL_KEY);
  await page.keyboard.press('Enter');
  await expect(status(page)).toHaveText('Checking your key…');
  await press(page, 'ArrowDown', 'subdl-save');
  await press(page, 'ArrowDown', 'subdl-remove');
  await page.keyboard.press('Enter');
  await expect(status(page)).toHaveText("Key removed. BannerTV won't look on SubDL.");
  answerCheck();
  await page.waitForTimeout(500);
  await expect(status(page)).toHaveText("Key removed. BannerTV won't look on SubDL.");
  expect(await readKv(page, 'subdl/key')).toBeNull();
  await pressBack(page);
  await expectFocusLabel(page, 'SubDL subtitles: Off');
});

/** Every value the page keeps: its key-value store, its cache, and the browser's storage. */
function everythingKept(page: Page) {
  return page.evaluate(
    () =>
      new Promise<{ kv: Array<[string, string]>; cache: string[]; local: string; session: string }>(
        (resolve, reject) => {
          const request = indexedDB.open('bannertv');
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const db = request.result;
            const tx = db.transaction(['kv', 'cache']);
            const kvKeys = tx.objectStore('kv').getAllKeys();
            const kvValues = tx.objectStore('kv').getAll();
            const cacheKeys = tx.objectStore('cache').getAllKeys();
            const cacheValues = tx.objectStore('cache').getAll();
            tx.oncomplete = () => {
              db.close();
              resolve({
                kv: (kvKeys.result as string[]).map((key, i) => [
                  String(key),
                  JSON.stringify(kvValues.result[i]),
                ]),
                cache: [
                  ...(cacheKeys.result as string[]).map(String),
                  ...cacheValues.result.map((value) => JSON.stringify(value)),
                ],
                local: JSON.stringify({ ...localStorage }),
                session: JSON.stringify({ ...sessionStorage }),
              });
            };
          };
        },
      ),
  );
}

test('the key is kept only in its own store, and never logged or put in an address', async ({
  page,
}) => {
  const lines: string[] = [];
  page.on('console', (message) => lines.push(message.text()));
  const urls: string[] = [];
  page.on('request', (request) => urls.push(request.url()));
  const { subdl } = await setUp(page, 'films');
  await playFilm(page);
  await expect(page.getByText('SubDL film, line 1')).toBeVisible();
  const section = await subtitlesDiagnostics(page);
  await expect(section).toContainText('SubDL');
  expect(await page.locator('body').innerText()).not.toContain(FAKE_SUBDL_KEY);

  await expectKeptOnlyInItsStore(page);
  for (const line of lines) expect(line).not.toContain(FAKE_SUBDL_KEY);
  for (const url of urls) expect(url).not.toContain(FAKE_SUBDL_KEY);
  expect(subdl.keyInUrl).toBe(false);
});

/** The key is in the profile's 'subdl/key' and in nothing else the page keeps. */
async function expectKeptOnlyInItsStore(page: Page) {
  const kept = await everythingKept(page);
  for (const [key, value] of kept.kv) {
    if (key === 'subdl/key' || /^p\/[^/]+\/subdl\/key$/.test(key)) continue;
    expect(value, key).not.toContain(FAKE_SUBDL_KEY);
    expect(key).not.toContain(FAKE_SUBDL_KEY);
  }
  expect(kept.kv.find(([key]) => key === 'subdl/key')?.[1]).toContain(FAKE_SUBDL_KEY);
  for (const value of kept.cache) expect(value).not.toContain(FAKE_SUBDL_KEY);
  expect(kept.local).not.toContain(FAKE_SUBDL_KEY);
  expect(kept.session).not.toContain(FAKE_SUBDL_KEY);
  return kept;
}

test('a key sent from the phone is kept only in its own store, and neither page logs it or puts it in an address', async ({
  page,
}) => {
  test.skip(!PAIR_SERVICE, 'The pairing relay is not deployed yet');
  // Both pages, the TV's and the phone's: they share the browser.
  const lines: string[] = [];
  page.context().on('console', (message) => lines.push(message.text()));
  const urls: string[] = [];
  page.context().on('request', (request) => urls.push(request.url()));
  const { subdl } = await setUp(page, 'films', { key: false });
  const relay = keyRelay();
  await relay.serveTv(page);
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await openSubdlScreen(page);
  const qr = await readPhoneQr(page);
  const phone = await sendFromPhone(relay, page, qr.address, FAKE_SUBDL_KEY);
  await expect(status(page)).toHaveText('Your key works. BannerTV will look on SubDL too.');
  expect(await page.locator('body').innerText()).not.toContain(FAKE_SUBDL_KEY);

  // What either page logs is heard here, so the checks below are not passing for nothing.
  await page.evaluate(() => console.info('heard from the TV'));
  await phone.evaluate(() => console.info('heard from the phone'));
  await expect
    .poll(() => lines)
    .toEqual(expect.arrayContaining(['heard from the TV', 'heard from the phone']));

  const kept = await expectKeptOnlyInItsStore(page);
  // Nor is K kept anywhere, on the TV or on the phone.
  expect(JSON.stringify(kept).includes(qr.k), 'K is kept on the TV').toBe(false);
  const phoneKept = await phone.evaluate(() =>
    JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }),
  );
  expect(phoneKept).not.toContain(FAKE_SUBDL_KEY);
  expect(phoneKept.includes(qr.k), 'K is kept on the phone').toBe(false);
  for (const line of lines) {
    expect(line).not.toContain(FAKE_SUBDL_KEY);
    expect(line.includes(qr.k), 'K in a console message').toBe(false);
  }
  for (const url of urls) {
    expect(url).not.toContain(FAKE_SUBDL_KEY);
    expect(url.includes(qr.k), 'K in an address').toBe(false);
  }
  expect(subdl.keyInUrl).toBe(false);
  await phone.close();
});

test("on Android, a film's SubDL file named for the release is chosen", async ({ page }) => {
  await mockAddons(page);
  await seedStreamAddon(page, { preferences: { subtitleLanguage: 'eng' }, kv: SAVED_KEY });
  await mockPlayback(page, { streams: { [MOVIE]: [FILM_STREAM] } });
  const subdl = await standInSubdl(page, 'films');
  await openAsAndroid(page);
  await page.goto(ANDROID_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await openFocusedTitle(page);
  await press(page, 'Enter', 'player-surface');
  await expect
    .poll(async () => (await playerOps(page)).filter((op) => op === 'load'))
    .toHaveLength(1);
  await androidOpens(page);
  await expect(page.getByText('SubDL film, line 1')).toBeVisible();
  expect(subdl.searches).toHaveLength(1);
  expect(subdl.downloads).toEqual([SUBDL_FILM_FILE]);
  await openSheet(page, 'player-tracks-lang-en');
  await expect(subdlRows(page)).toContainText('Same release');
  expect(subdl.keyInUrl).toBe(false);
});
