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
