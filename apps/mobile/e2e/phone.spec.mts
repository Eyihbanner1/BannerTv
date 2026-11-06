import { expect, test, type Page } from '@playwright/test';
import { mockAddons } from '../../webos/e2e/addons.ts';
import { mockPlayback, seedStreamAddon, STREAM_ADDON_URL } from '../../webos/e2e/play.ts';

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
  // The stream helper runs in the phone build's native module, which the web build has not.
  await expect(page.getByText('Stream helper', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Your TV', { exact: true })).toHaveCount(0);
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

test("Languages and picture: the profile's subtitles and highest picture, kept", async ({
  page,
}) => {
  const errors = watchErrors(page);
  await mockAddons(page);
  await openApp(page);
  await page.getByRole('tab', { name: 'Settings' }).click();
  await expect(page.getByText('Languages and picture')).toBeVisible();

  await page.getByText('Subtitles', { exact: true }).click();
  await page.getByText('English', { exact: true }).last().click();
  await page.getByText('Show subtitles', { exact: true }).click();
  await page.getByText("Only when the audio isn't English").last().click();
  await page.getByText('Highest picture', { exact: true }).click();
  await page.getByText('1080p', { exact: true }).last().click();
  await expect(page.getByText("Only when the audio isn't English")).toBeVisible();

  const stored = await page.evaluate(() => localStorage.getItem('bannertv.preferences'));
  expect(JSON.parse(stored ?? '{}')).toMatchObject({
    subtitleLanguage: 'en',
    subtitleWhen: 'foreign',
    maxResolution: '1080p',
    learnLanguages: false,
  });
  expect(errors).toEqual([]);
});

test("subtitles are drawn in the profile's subtitle style", async ({ page }) => {
  const errors = watchErrors(page);
  await mockAddons(page);
  await seedStreamAddon(page, {
    preferences: {
      subtitleLanguage: 'eng',
      subtitleStyle: { size: 'large', colour: 'yellow', background: 'box', position: 'top' },
    },
  });
  await mockPlayback(page);
  await openApp(page);

  await page
    .getByLabel(/Tears of Steel/)
    .last()
    .click();
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

  // The TV's large size (64 of 1080 lines) on the 412-wide screen, in yellow, on a box, at the top.
  const words = page.getByText('Hello from the', { exact: false });
  await expect(words).toBeVisible();
  const look = await words.evaluate((span) => {
    const text = getComputedStyle(span);
    return {
      size: text.fontSize,
      colour: text.color,
      box: span.parentElement ? getComputedStyle(span.parentElement).backgroundColor : '',
      top: span.getBoundingClientRect().top,
    };
  });
  expect(look).toMatchObject({
    size: '24.4px',
    colour: 'rgb(255, 228, 92)',
    box: 'rgba(0, 0, 0, 0.6)',
  });
  expect(look.top).toBeLessThan(915 / 3);
  expect(errors).toEqual([]);
});
