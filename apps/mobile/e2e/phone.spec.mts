import { expect, test, type Page } from '@playwright/test';
import { mockAddons } from '../../webos/e2e/addons.ts';
import { mockPlayback, STREAM_ADDON_URL } from '../../webos/e2e/play.ts';

/*
 * The phone app's web build, held like a phone, against the TV journeys' fake addons. On the
 * phone itself the player is Media3 through expo-video; here it is the browser's <video>, so
 * these journeys check the screens, the shared data layer and the player's controls, not
 * which streams a phone can decode.
 */

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

/** Opens the app. The fake addons refuse every other address, so the app's own is let through. */
async function openApp(page: Page): Promise<void> {
  await page.route(/^http:\/\/localhost:8765\//, (route) => route.continue());
  await page.goto('/');
}

async function addStreamAddon(page: Page): Promise<void> {
  await page.getByRole('tab', { name: 'Settings' }).click();
  await page.getByText('Addons', { exact: true }).click();
  await page.getByRole('button', { name: 'Add an addon' }).last().click();
  await page.getByLabel('Addon address').fill(STREAM_ADDON_URL);
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByText('Added Test Streams.', { exact: false })).toBeVisible();
  await page.getByLabel('Back').first().click();
  await page.getByRole('tab', { name: 'Home' }).click();
}

test('first run: welcome, Home, an addon, a title, All streams and the player', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await mockAddons(page, { firstRun: true });
  const playback = await mockPlayback(page);
  await openApp(page);

  await expect(page.getByText('Welcome to BannerTV')).toBeVisible();
  await page.getByText('Start browsing').click();
  await expect(page.getByText('Blender open movies')).toBeVisible();

  await addStreamAddon(page);

  // Cinemeta's copy of the film, which the test stream addon answers for.
  await page
    .getByLabel(/Tears of Steel/)
    .last()
    .click();
  await expect(page.getByRole('button', { name: /^Watch/ })).toBeVisible();
  await page.getByRole('button', { name: /All streams/ }).click();
  await page
    .getByText(/Open Movie 1080p/)
    .first()
    .click();

  const pause = page.getByLabel('Pause', { exact: true }).first();
  await expect(pause).toBeVisible();
  // The browser waits for a tap before it plays; the phone does not.
  await pause.click();
  await page.getByLabel('Play', { exact: true }).first().click();
  await expect
    .poll(() => page.evaluate(() => document.querySelector('video')?.currentTime ?? 0))
    .toBeGreaterThan(1);

  // Quality, under More options, switches to the 720p stream. The controls hide while the film
  // plays: a tap brings them.
  const more = page.getByRole('button', { name: 'More options' });
  if (!(await more.isVisible())) await page.mouse.click(206, 160);
  await more.click();
  await page.getByRole('button', { name: /^Quality, 1080p/ }).click();
  await page.getByText('720p', { exact: true }).click();
  await expect.poll(() => playback.media).toContain('/movie-720p.webm');

  const leave = page.getByLabel('Leave the player').first();
  if (!(await leave.isVisible())) await page.mouse.click(206, 160);
  await leave.click();
  await expect(page.getByRole('button', { name: /All streams/ })).toBeVisible();
  expect(errors).toEqual([]);
});

test('a later launch opens on Home, and Settings shows playback and the build', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await mockAddons(page);
  await openApp(page);
  await page.getByRole('tab', { name: 'Settings' }).click();
  await expect(page.getByText('Auto-play picks')).toBeVisible();
  await expect(page.getByText(/BannerTV for phones/)).toBeVisible();
  expect(errors).toEqual([]);
});

test("a stream that needs the addon's headers plays, and they go to the phone's player", async ({
  page,
}) => {
  const errors = watchErrors(page);
  // Records what the page asks the phone's player to open, on its way to the host.
  await page.addInitScript(() => {
    const seen = window as unknown as { __loads: unknown[] };
    seen.__loads = [];
    let bridge: { player(command: string): void } | undefined;
    Object.defineProperty(window, 'BannerAndroid', {
      configurable: true,
      get: () => bridge,
      set: (value: { player(command: string): void }) => {
        bridge = {
          ...value,
          player: (command: string) => {
            const parsed = JSON.parse(command) as { op: string };
            if (parsed.op === 'load') seen.__loads.push(parsed);
            value.player(command);
          },
        };
      },
    });
  });
  await mockAddons(page);
  const playback = await mockPlayback(page, {
    streams: {
      tt2285752: [
        {
          name: 'Test Streams\n1080p',
          description: 'Match feed 1080p WEB-DL',
          path: '/movie-headers.webm',
          requestHeaders: {
            Referer: 'https://site.example/',
            'user-agent': 'Agent/1.0',
            Range: 'bytes=0-',
          },
        },
      ],
    },
  });
  await openApp(page);
  await addStreamAddon(page);

  await page
    .getByLabel(/Tears of Steel/)
    .last()
    .click();
  await page.getByRole('button', { name: /All streams/ }).click();
  await page
    .getByText(/Match feed 1080p/)
    .first()
    .click();

  await expect(page.getByLabel('Pause', { exact: true }).first()).toBeVisible();
  const loads = () =>
    page.evaluate(() => (window as unknown as { __loads: Array<Record<string, unknown>> }).__loads);
  await expect.poll(async () => (await loads()).length).toBeGreaterThan(0);
  const load = (await loads()).pop()!;
  // The page sends what the addon asked, less Range, which the player sets itself.
  expect(load.headers).toEqual({ Referer: 'https://site.example/', 'user-agent': 'Agent/1.0' });
  await expect.poll(() => playback.media).toContain('/movie-headers.webm');
  expect(errors).toEqual([]);
});

test('chips above the stream list filter it, and Clear shows every stream again', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await mockAddons(page);
  await mockPlayback(page, {
    streams: {
      tt2285752: [
        {
          name: 'Test Streams\n2160p',
          description: 'Film 2160p WEB-DL\n⚡ Cached',
          path: '/a.webm',
        },
        {
          name: 'Test Streams\n1080p',
          description: 'Film 1080p WEB-DL\n⚡ Cached',
          path: '/b.webm',
        },
        {
          name: 'Test Streams\n1080p',
          description: 'Film 1080p BluRay 🇪🇸\n⚡ Cached',
          path: '/c.webm',
        },
        { name: 'Test Streams\n1080p', description: 'Film 1080p WEBRip', path: '/d.webm' },
        { name: 'Test Streams\n720p', description: 'Film 720p WEBRip\n⚡ Cached', path: '/e.webm' },
      ],
    },
  });
  await openApp(page);
  await addStreamAddon(page);
  await page
    .getByLabel(/Tears of Steel/)
    .last()
    .click();
  await page.getByRole('button', { name: /All streams/ }).click();
  await expect(page.getByText('5 streams', { exact: true })).toBeVisible();

  // A tap on Cached keeps the cached ones.
  await page.getByRole('button', { name: 'Cached', exact: true }).click();
  await expect(page.getByText('4 of 5 streams', { exact: true })).toBeVisible();
  await expect(page.getByText('Film 1080p WEBRip')).toHaveCount(0);

  // Quality opens a picker of the sizes found, with how many have each.
  await page.getByRole('button', { name: 'Quality', exact: true }).click();
  await page.getByRole('button', { name: /^1080p/ }).click();
  await expect(page.getByText('2 of 5 streams', { exact: true })).toBeVisible();
  await expect(page.getByText('Film 720p WEBRip')).toHaveCount(0);
  await expect(page.getByText('Film 1080p BluRay 🇪🇸')).toBeVisible();

  await page.getByRole('button', { name: 'Clear filter', exact: true }).click();
  await expect(page.getByText('5 streams', { exact: true })).toBeVisible();
  await expect(page.getByText('Film 720p WEBRip')).toBeVisible();
  expect(errors).toEqual([]);
});
