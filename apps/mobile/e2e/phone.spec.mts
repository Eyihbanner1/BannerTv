import { expect, test, type Page } from '@playwright/test';
import { EXTRA_ADDON_URL, mockAddons } from '../../webos/e2e/addons.ts';
import { mockPlayback, readKv, seedStreamAddon, STREAM_ADDON_URL } from '../../webos/e2e/play.ts';

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

  // Zoom to fill, under More options, makes the picture cover the screen, and the phone keeps
  // it for the next film. The controls hide while the film plays: a tap brings them.
  const more = page.getByRole('button', { name: 'More options' });
  const video = () =>
    page.evaluate(() => {
      const element = document.querySelector('video');
      return element ? getComputedStyle(element).objectFit : null;
    });
  expect(await video()).toBe('contain');
  if (!(await more.isVisible())) await page.mouse.click(206, 160);
  await more.click();
  await page.getByRole('button', { name: 'Zoom to fill, Off' }).click();
  await expect.poll(video).toBe('cover');
  expect(await page.evaluate(() => localStorage.getItem('bannertv.phone.pictureFit'))).toBe('fill');

  // Quality, under More options, switches to the 720p stream.
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

test.describe('with touch', () => {
  test.use({ hasTouch: true });

  test('two fingers zoom the picture to fill and back, and never seek or tap', async ({ page }) => {
    const errors = watchErrors(page);
    await mockAddons(page, { firstRun: true });
    await mockPlayback(page);
    await openApp(page);
    await page.getByText('Start browsing').click();
    await addStreamAddon(page);
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
    await pause.click();
    await page.getByLabel('Play', { exact: true }).first().click();
    const time = () => page.evaluate(() => document.querySelector('video')?.currentTime ?? 0);
    await expect.poll(time).toBeGreaterThan(1);
    const more = page.getByRole('button', { name: 'More options' });
    await expect(more).toBeHidden({ timeout: 15_000 });

    const fit = () =>
      page.evaluate(() => {
        const element = document.querySelector('video');
        return element ? getComputedStyle(element).objectFit : null;
      });
    // Touches as a phone's: each finger down, moved and lifted, by id.
    const cdp = await page.context().newCDPSession(page);
    const touch = (type: string, touchPoints: { x: number; y: number; id: number }[]) =>
      cdp.send('Input.dispatchTouchEvent', { type, touchPoints } as never);
    /** Two fingers from `from` to `to`, then on to each of `then`, before they lift. */
    const pinch = async (from: [number, number], ...to: [number, number][]) => {
      await touch('touchStart', [{ x: from[0], y: 450, id: 0 }]);
      await touch('touchStart', [
        { x: from[0], y: 450, id: 0 },
        { x: from[1], y: 450, id: 1 },
      ]);
      let at = from;
      for (const next of to) {
        for (let step = 1; step <= 6; step++) {
          const x = (index: 0 | 1) => at[index] + ((next[index] - at[index]) * step) / 6;
          await touch('touchMove', [
            { x: x(0), y: 450, id: 0 },
            { x: x(1), y: 450, id: 1 },
          ]);
        }
        at = next;
      }
      await touch('touchEnd', []);
    };

    // Spreading fills the screen, says so, and the phone keeps it. No tap shows the controls,
    // and the film goes on from where it was.
    // The fingers easing back in before they lift change nothing: one change a pinch.
    expect(await fit()).toBe('contain');
    const before = await time();
    await pinch([160, 260], [90, 330], [140, 280]);
    await expect.poll(fit).toBe('cover');
    await expect(page.getByText('Zoomed to fill')).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('bannertv.phone.pictureFit'))).toBe(
      'fill',
    );
    await page.waitForTimeout(600);
    await expect(more).toBeHidden();
    expect(Math.abs((await time()) - before)).toBeLessThan(3);

    // Two fingers resting, one lifting and coming down again near the other, are no pinch.
    // DevTools lifts only every finger at once, so these touches are the page's own.
    const fingers = (
      type: string,
      touches: [number, number][],
      changed: [number, number][] = touches,
    ) =>
      page.evaluate(
        ({ type, touches, changed }) => {
          const target = document.elementFromPoint(200, 450) ?? document.body;
          const make = ([identifier, x]: [number, number]) =>
            new Touch({ identifier, target, clientX: x, clientY: 450, pageX: x, pageY: 450 });
          target.dispatchEvent(
            new TouchEvent(type, {
              bubbles: true,
              cancelable: true,
              touches: touches.map(make),
              targetTouches: touches.map(make),
              changedTouches: changed.map(make),
            }),
          );
        },
        { type, touches, changed },
      );
    await fingers('touchstart', [[0, 100]]);
    await fingers(
      'touchstart',
      [
        [0, 100],
        [1, 300],
      ],
      [[1, 300]],
    );
    await fingers('touchend', [[0, 100]], [[1, 300]]);
    await fingers(
      'touchstart',
      [
        [0, 100],
        [2, 140],
      ],
      [[2, 140]],
    );
    await fingers(
      'touchmove',
      [
        [0, 100],
        [2, 135],
      ],
      [[2, 135]],
    );
    await fingers(
      'touchend',
      [],
      [
        [0, 100],
        [2, 135],
      ],
    );
    await page.waitForTimeout(300);
    expect(await fit()).toBe('cover');

    // Closing the fingers fits the whole picture again.
    await pinch([100, 320], [190, 230]);
    await expect.poll(fit).toBe('contain');
    await expect(page.getByText('Fit to screen')).toBeVisible();

    // A swipe that gets a second finger part way seeks nowhere: it is a pinch now.
    const swipeFrom = await time();
    await touch('touchStart', [{ x: 120, y: 450, id: 0 }]);
    for (let step = 1; step <= 5; step++) {
      await touch('touchMove', [{ x: 120 + step * 20, y: 450, id: 0 }]);
    }
    await touch('touchStart', [
      { x: 220, y: 450, id: 0 },
      { x: 300, y: 450, id: 1 },
    ]);
    for (let step = 1; step <= 6; step++) {
      await touch('touchMove', [
        { x: 220 - step * 12, y: 450, id: 0 },
        { x: 300 + step * 12, y: 450, id: 1 },
      ]);
    }
    await touch('touchEnd', []);
    await expect.poll(fit).toBe('cover');
    await page.waitForTimeout(600);
    expect(Math.abs((await time()) - swipeFrom)).toBeLessThan(4);

    // One finger still taps the controls up.
    await touch('touchStart', [{ x: 200, y: 300, id: 0 }]);
    await touch('touchEnd', []);
    await expect(more).toBeVisible();
    expect(errors).toEqual([]);
  });
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
  // The web build takes no over-the-air updates: it runs its built-in code and has no check.
  await expect(page.getByText('App version', { exact: true })).toBeVisible();
  await expect(page.getByText('Built in', { exact: true })).toBeVisible();
  await expect(page.getByText(/This build doesn’t take updates/)).toBeVisible();
  await expect(page.getByText('Check for updates', { exact: true })).toHaveCount(0);
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

test('subtitles by language with numbered versions, the match note, and Timing kept for each file', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await mockAddons(page, { firstRun: true });
  await mockPlayback(page, {
    subtitleList: [
      { id: 'en1', lang: 'eng', label: 'Open.Movie.1080p.WEB-DL' },
      { id: 'en2', lang: 'eng' },
      { id: 'fr1', lang: 'fre' },
    ],
  });
  await openApp(page);
  await page.getByText('Start browsing').click();
  await addStreamAddon(page);

  const playFilm = async () => {
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
    await expect
      .poll(() => page.evaluate(() => document.querySelector('video')?.currentTime ?? 0))
      .toBeGreaterThan(1);
  };
  const panelButton = page.getByRole('button', { name: 'Audio and subtitles' });
  const openPanel = async () => {
    // The controls hide while the film plays: a tap brings them.
    if (!(await panelButton.isVisible())) await page.mouse.click(120, 160);
    await panelButton.click();
  };
  const timingTab = page.getByRole('button', { name: /^Timing/ });

  await playFilm();
  await openPanel();

  // The languages, each with how many versions it has. Tapping one starts its first and stays
  // open on its versions, numbered by source, the note before the release name.
  const english = page.getByRole('button', { name: 'English, 2 versions' });
  await expect(english).toBeVisible();
  await expect(page.getByRole('button', { name: 'French, 1 version' })).toBeVisible();
  await english.click();
  const first = page.getByRole('button', { name: /^OpenSubtitles v3 1, / });
  await expect(first).toHaveAccessibleName(
    'OpenSubtitles v3 1, Matches your video · Open.Movie.1080p.WEB-DL',
  );
  await expect(first).toContainText('Matches your video · Open.Movie.1080p.WEB-DL');
  await expect(page.getByRole('button', { name: 'OpenSubtitles v3 2', exact: true })).toBeVisible();
  await expect(page.getByText('Hello from the test subtitles')).toBeVisible();

  // Timing: half a second later, then 5 s more, said in words and on the tab.
  await timingTab.click();
  await expect(page.getByText('Subtitles as the file has them')).toBeVisible();
  await page.getByRole('button', { name: '0.5 s later', exact: true }).click();
  await expect(page.getByText('Subtitles 0.5 s later')).toBeVisible();
  await expect(timingTab).toHaveText('Timing +0.5 s');
  await page.getByRole('button', { name: '5 s later', exact: true }).click();
  await expect(page.getByText('Subtitles 5.5 s later')).toBeVisible();
  await page.getByRole('button', { name: 'Getting ahead' }).click();
  await expect(timingTab).toHaveText('Timing +5.5 s · drift fixed');

  // Another file starts as it is; picking a version closes the panel.
  await page.getByRole('button', { name: 'Subtitles', exact: true }).click();
  await page.getByRole('button', { name: 'OpenSubtitles v3 2', exact: true }).click();
  await expect(english).toBeHidden();
  await expect(page.getByText('The second English file')).toBeVisible();
  await openPanel();
  await expect(timingTab).toHaveText('Timing');

  // Back on the first file, its timing is there again, and still after the app starts again.
  await page.getByRole('button', { name: /^OpenSubtitles v3 1, / }).click();
  await expect(page.getByText('The second English file')).toBeHidden();
  await openPanel();
  await expect(timingTab).toHaveText('Timing +5.5 s · drift fixed');
  // The web build's server knows only the app's first address.
  await page.goto('/');
  await playFilm();
  await openPanel();
  // English is the language chosen now, and the file made for this release comes first.
  await expect(page.getByRole('button', { name: /^OpenSubtitles v3 1, / })).toHaveAccessibleName(
    /Matches your video/,
  );
  await expect(timingTab).toHaveText('Timing +5.5 s · drift fixed');
  expect(errors).toEqual([]);
});

test('on a dub picked by hand, Audio offers the language wanted from another stream', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await mockAddons(page);
  const playback = await mockPlayback(page, {
    streams: {
      tt2285752: [
        {
          name: 'Test Streams\n1080p',
          description: 'Open Movie 1080p BluRay REMUX 🇪🇸\n💾 9 GB ⚡ Cached',
          path: '/movie-1080p-castellano.webm',
        },
        {
          name: 'Test Streams\n720p',
          description: 'Open Movie 720p WEB-DL\n💾 2 GB ⚡ Cached',
          path: '/movie-720p.webm',
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
    .getByText(/Open Movie 1080p BluRay/)
    .first()
    .click();
  const pause = page.getByLabel('Pause', { exact: true }).first();
  await expect(pause).toBeVisible();
  await expect.poll(() => playback.media).toContain('/movie-1080p-castellano.webm');

  const panelButton = page.getByRole('button', { name: 'Audio and subtitles' });
  // The controls hide while the film plays: a tap brings them.
  if (!(await panelButton.isVisible())) await page.mouse.click(120, 160);
  await panelButton.click();
  await page.getByRole('button', { name: 'Audio', exact: true }).click();
  const offer = page.getByRole('button', { name: /^English audio: switch stream/ });
  await expect(offer).toBeVisible();
  await expect(offer).toContainText('720p');
  await offer.click();
  await expect.poll(() => playback.media).toContain('/movie-720p.webm');
  // The language is kept for the title, which the next stream starts in.
  await expect
    .poll(async () => JSON.stringify(await readKv(page, 'trackChoices')))
    .toContain('"audio":"en"');
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

test('an addon switched off in Addons leaves Home, and comes back when switched on', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await mockAddons(page);
  await openApp(page);
  await page.getByRole('tab', { name: 'Settings' }).click();
  await page.getByText('Addons', { exact: true }).click();
  await page.getByRole('button', { name: 'Add an addon' }).last().click();
  await page.getByLabel('Addon address').fill(EXTRA_ADDON_URL);
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByText('Added Open Shorts.', { exact: false })).toBeVisible();

  const use = page.getByRole('switch', { name: 'Use Open Shorts' });
  await expect(use).toBeChecked();
  await use.click();
  await expect(use).not.toBeChecked();
  await expect(page.getByText('Off: its settings are kept')).toBeVisible();
  await page.getByLabel('Back').first().click();
  // Still installed: Settings counts it.
  await expect(page.getByText('3 installed')).toBeVisible();
  await page.getByRole('tab', { name: 'Home' }).click();
  // Cinemeta's rows are there, by their titles as the phone shows them.
  await expect(page.getByText('Popular', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Trending shorts')).toHaveCount(0);

  await page.getByRole('tab', { name: 'Settings' }).click();
  await page.getByText('Addons', { exact: true }).click();
  await use.click();
  await expect(use).toBeChecked();
  await expect(page.getByText('Off: its settings are kept')).toHaveCount(0);
  await page.getByLabel('Back').first().click();
  await page.getByRole('tab', { name: 'Home' }).click();
  await expect(page.getByText('Trending shorts')).toBeVisible();
  expect(errors).toEqual([]);
});
