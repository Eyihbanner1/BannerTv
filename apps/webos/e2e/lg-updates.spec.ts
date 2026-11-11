import {
  createHash,
  createSign,
  generateKeyPairSync,
  type KeyObject,
  randomUUID,
} from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, type Page, test } from '@playwright/test';
import type { ShellConfig, ShellStatus } from '../src/shell/contract';
import { FIRST_ROW, mockAddons } from './addons';
import { mockHomebrewRepo, openAsLgTv, repoWith } from './homebrew';
import { expectFocus, openSection, watchErrors } from './tv';

/**
 * The app updating itself on an LG TV (src/shell): the production build, with
 * a test key and the updates Worker at an address of its own, answering with
 * an update signed by that key. The update is the build's own app script with
 * a line added at its end that marks the page, so a journey can tell which
 * code runs.
 */

const DIST = resolve(import.meta.dirname, '../dist');
const UPDATES_URL = 'https://updates.example/webos/';
const CONFIG = /(<script id="bannertv-shell" type="application\/json">)([^<]*)(<\/script>)/;
const VERSION = '0.1.9';
const MARK = `;document.documentElement.setAttribute('data-test-update', '${VERSION}');`;
const LAUNCH = 'assets/index-update.js';

const sha256Hex = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');

interface TestBuild {
  url: string;
  config: ShellConfig;
  key: KeyObject;
  keyId: string;
  appScript: string;
}

let build: TestBuild;
let dir: string;

/** The build, copied, with updates on: this test's key, asking this test's Worker. */
test.beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'bannertv-lg-updates-'));
  cpSync(DIST, dir, { recursive: true });
  const html = readFileSync(join(dir, 'index.html'), 'utf8');
  const match = CONFIG.exec(html);
  if (!match) throw new Error('dist/index.html carries no shell config: run pnpm build first.');
  const config = JSON.parse(match[2]!) as ShellConfig;
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const der = publicKey.export({ type: 'spki', format: 'der' });
  const keyId = `lg-${sha256Hex(der).slice(0, 16)}`;
  config.updates = { channel: 'main', url: UPDATES_URL, key: der.toString('base64'), keyId };
  const json = JSON.stringify(config).replace(/</g, '\\u003c');
  writeFileSync(
    join(dir, 'index.html'),
    html.replace(CONFIG, (_all, open, _old, close) => open + json + close),
  );
  build = {
    url: pathToFileURL(join(dir, 'index.html')).href,
    config,
    key: privateKey,
    keyId,
    appScript: readFileSync(join(dir, config.launch), 'utf8'),
  };
});

test.afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** The Worker's answer for an update whose app script is `script`, signed with the test key. */
function signedUpdate(script: string) {
  const bytes = Buffer.from(script);
  const files = { ...build.config.files };
  delete files[build.config.launch];
  files[LAUNCH] = { sha256: sha256Hex(bytes), size: bytes.length };
  const text = JSON.stringify({
    type: 'bannertv-lg-update',
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    channel: 'main',
    platform: 'webos',
    runtime: build.config.runtime,
    version: VERSION,
    commit: '1234567',
    launch: LAUNCH,
    files,
  });
  const sig = createSign('RSA-SHA256').update(text, 'utf8').sign(build.key, 'base64');
  return {
    body: JSON.stringify({ manifest: text, sig, keyid: build.keyId }),
    files: new Map([[sha256Hex(bytes), bytes]]),
  };
}

/** The updates Worker at UPDATES_URL, answering with `update`; what the TV asked, in order. */
async function mockWorker(page: Page, update: ReturnType<typeof signedUpdate>) {
  const asked: string[] = [];
  await page.route(
    (url) => url.href.startsWith(UPDATES_URL),
    (route) => {
      const url = new URL(route.request().url());
      asked.push(`${url.pathname}${url.search}`);
      const headers = { 'access-control-allow-origin': '*', 'cache-control': 'no-store' };
      if (url.pathname === '/webos/update') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers,
          body: update.body,
        });
      }
      const bytes = update.files.get(url.pathname.slice('/webos/file/'.length));
      return bytes
        ? route.fulfill({
            status: 200,
            contentType: 'application/octet-stream',
            headers,
            body: bytes,
          })
        : route.fulfill({ status: 404, headers, body: '' });
    },
  );
  return asked;
}

/** Settings' Updates line. */
const updatesLine = (page: Page) =>
  page.getByRole('region', { name: 'Updates' }).getByRole('status');

const shellStatus = (page: Page) =>
  page.evaluate(() =>
    (
      window as unknown as { __BANNERTV_SHELL__: { status(): ShellStatus } }
    ).__BANNERTV_SHELL__.status(),
  );

const storedState = (page: Page) =>
  page.evaluate(
    () =>
      JSON.parse(localStorage.getItem('bannertv-ota:state') ?? 'null') as Record<
        string,
        unknown
      > | null,
  );

const marked = (page: Page) => page.locator(`html[data-test-update="${VERSION}"]`);

/** Starts the test build on a fake LG TV, with `update` waiting at the Worker; what the TV asked it. */
async function start(page: Page, update: ReturnType<typeof signedUpdate>): Promise<string[]> {
  await mockAddons(page);
  await mockHomebrewRepo(page, { json: repoWith('0.1.0') });
  // Last, as the newest route answers first, before the addons' catch-all.
  const asked = await mockWorker(page, update);
  await openAsLgTv(page);
  await page.goto(build.url);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  return asked;
}

test('downloads a signed update on Settings, starts it there, and keeps it', async ({ page }) => {
  const errors = watchErrors(page);
  const asked = await start(page, signedUpdate(`${build.appScript}\n${MARK}\n`));
  // The .ipk's own code, and nothing asked yet: the first check waits a minute after the start.
  await expect(page.locator('#root')).not.toBeEmpty();
  await expect(marked(page)).toHaveCount(0);
  expect(asked).toEqual([]);

  // Opening Settings asks; the update comes down, and the app starts it there a moment later.
  await openSection(page, 'settings');
  await expect(updatesLine(page)).toHaveText(`BannerTV ${VERSION} is ready. Starting it now…`);
  await expect(marked(page)).toHaveCount(1, { timeout: 15_000 });
  expect(asked[0]).toBe(`/webos/update?channel=main&runtime=${build.config.runtime}`);
  // Only the script that differs from the .ipk's came down.
  expect(asked.filter((path) => path.startsWith('/webos/file/'))).toHaveLength(1);
  expect((await shellStatus(page)).running).toMatchObject({ version: VERSION });

  // Once it has drawn and settled, the start went well, and the update stays.
  await expect.poll(async () => (await storedState(page))?.tries, { timeout: 20_000 }).toBe(0);
  expect(await storedState(page)).toMatchObject({
    current: { version: VERSION },
    next: null,
    bad: [],
  });
  await page.reload();
  await expect(marked(page)).toHaveCount(1);
  await expect(page.locator('#root')).not.toBeEmpty();
  expect(errors).toEqual([]);
});

test('an update that throws as it starts is put aside, and the .ipk’s code runs again', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await start(page, signedUpdate(`throw new Error('update crash at start');\n${build.appScript}`));
  await openSection(page, 'settings');
  await expect(updatesLine(page)).toHaveText(`BannerTV ${VERSION} is ready. Starting it now…`);

  // It throws, the loader puts it aside and starts the page again, from the .ipk.
  await expect
    .poll(async () => (await storedState(page))?.failed, { timeout: 15_000 })
    .toMatchObject({
      version: VERSION,
    });
  await expect(page.locator('#root')).not.toBeEmpty();
  await expect(marked(page)).toHaveCount(0);
  expect(await shellStatus(page)).toMatchObject({ running: null, next: null });
  expect(errors.filter((error) => !error.includes('update crash at start'))).toEqual([]);

  // Settings says so, and does not take it again.
  await openSection(page, 'settings');
  await expect(updatesLine(page)).toHaveText(
    `BannerTV ${VERSION} didn't start on this TV, so it runs the build installed here.`,
  );
  await expect.poll(async () => (await shellStatus(page)).check.kind).toBe('latest');
  expect((await storedState(page))?.next).toBeNull();
});

test('an update signed by another key is never stored or run', async ({ page }) => {
  const update = signedUpdate(`${build.appScript}\n${MARK}\n`);
  const body = JSON.parse(update.body) as { manifest: string; sig: string; keyid: string };
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  body.sig = createSign('RSA-SHA256').update(body.manifest, 'utf8').sign(privateKey, 'base64');
  const asked = await start(page, { ...update, body: JSON.stringify(body) });
  await openSection(page, 'settings');
  await expect
    .poll(async () => (await shellStatus(page)).check)
    .toEqual({ kind: 'failed', reason: 'signature' });
  expect(asked.filter((path) => path.startsWith('/webos/file/'))).toEqual([]);
  expect((await storedState(page))?.next).toBeNull();
  await expect(marked(page)).toHaveCount(0);
});
