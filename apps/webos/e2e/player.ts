import { expect, type Page } from '@playwright/test';
import { FIRST_ROW, mockAddons } from './addons';
import { APART_SPEECH, DEFAULT_STREAMS, mockPlayback, seedStreamAddon } from './play';
import { APP_URL, expectFocus, focusedKey, openSection, press, pressBack } from './tv';

/*
 * What the player journeys share: the film they play, the video element, the subtitles sheet,
 * when each line showed, and Diagnostics' Subtitles part.
 */

/** Elephants Dream, the first title on Home. */
export const MOVIE = 'tt0807840';
/** The start of the focus key of an OpenSubtitles version row: its addon id, then the file's. */
export const OPENSUBTITLES = 'player-tracks-file-org.stremio.opensubtitlesv3';

/** What the player's video element is doing. */
export function video(page: Page) {
  // Not the link test's hidden player, which stays in the page.
  return page.locator('video:not([aria-hidden])').evaluate((element: HTMLVideoElement) => ({
    src: element.currentSrc.replace(/^https:\/\/media\.example\.com/, ''),
    playing: !element.paused && element.currentTime > 0,
    time: element.currentTime,
  }));
}

/** Opens the first film's page from Home: Elephants Dream. */
export async function openMovie(page: Page) {
  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await press(page, 'Enter', 'details-watch');
  await expect(page.locator('section[aria-label="Elephants Dream"]:visible')).toBeVisible();
}

/** Opens the audio and subtitle sheet from the controls, on the subtitles showing. */
export async function openSheet(page: Page, focusKey: string) {
  await press(page, 'ArrowUp', 'player-play');
  await press(page, 'ArrowDown', 'player-tracks-button');
  await press(page, 'Enter', focusKey);
}

/** Leaves the player for the title's page, then Home. */
export async function leavePlayer(page: Page) {
  for (let step = 0; step < 4 && (await focusedKey(page)) !== 'details-watch'; step++) {
    await pressBack(page);
  }
  await expectFocus(page, 'details-watch');
  await pressBack(page);
  await expect.poll(() => focusedKey(page)).not.toBe('details-watch');
}

/** Settings > Diagnostics, from Home. */
export async function openDiagnostics(page: Page) {
  await openSection(page, 'settings');
  await expectFocus(page, 'settings-stream-choice');
  for (const key of [
    'settings-probing',
    'settings-subtitle-style',
    'settings-still-watching',
    'settings-next-at-credits',
    'settings-diagnostics',
  ]) {
    await press(page, 'ArrowDown', key);
  }
  await press(page, 'Enter', 'diagnostics-refresh');
}

/**
 * Records when each piece of text the page draws first showed, by the video's clock, so a
 * journey can say a subtitle line came on time.
 */
export async function recordShownAt(page: Page) {
  await page.addInitScript(() => {
    const shown: Array<{ text: string; at: number }> = [];
    (window as unknown as { shownAt: typeof shown }).shownAt = shown;
    new MutationObserver((records) => {
      const playing = document.querySelector<HTMLVideoElement>('video:not([aria-hidden])');
      const at = playing ? playing.currentTime : -1;
      for (const record of records) {
        if (record.type === 'characterData') {
          shown.push({ text: record.target.textContent ?? '', at });
        }
        record.addedNodes.forEach((node) => shown.push({ text: node.textContent ?? '', at }));
      }
    }).observe(document, { childList: true, subtree: true, characterData: true });
  });
}

/** The video's time when this line first showed ("line 1", not "line 12"), or null before. */
export function shownAt(page: Page, line: string): Promise<number | null> {
  return page.evaluate((text) => {
    const shown = (window as unknown as { shownAt: Array<{ text: string; at: number }> }).shownAt;
    const found = shown.find((entry) => {
      const index = entry.text.indexOf(text);
      return index !== -1 && !/\d/.test(entry.text.charAt(index + text.length));
    });
    return found ? found.at : null;
  }, line);
}

/** Opens the Timing tab from the subtitles sheet's list of languages. */
export async function openTiming(page: Page) {
  await openSheet(page, 'player-tracks-lang-en');
  await pressBack(page);
  await press(page, 'ArrowRight', 'player-tracks-tab-audio');
  await press(page, 'ArrowRight', 'player-tracks-tab-timing');
}

/** The Subtitles part of Diagnostics, from the player. */
export async function subtitlesDiagnostics(page: Page) {
  await leavePlayer(page);
  await openDiagnostics(page);
  return page.locator('section', {
    has: page.getByRole('heading', { name: 'Subtitles', exact: true }),
  });
}

/** Elephants Dream as the 10-minute video, with only this subtitle file: nothing lines it up. */
export async function playForMatching(page: Page, file: string) {
  await mockAddons(page);
  await seedStreamAddon(page, { preferences: { subtitleLanguage: 'eng' } });
  await mockPlayback(page, {
    streams: { [MOVIE]: [{ ...DEFAULT_STREAMS[0]!, path: '/long-match.webm' }] },
    subtitleList: [{ id: file, lang: 'eng' }],
  });
  await openMovie(page);
  await press(page, 'Enter', 'player-surface');
  await expect.poll(async () => (await video(page)).playing).toBe(true);
}

/** Moves the video to `at` seconds, as a seek would. */
export async function seekVideo(page: Page, at: number) {
  await page
    .locator('video:not([aria-hidden])')
    .evaluate((element: HTMLVideoElement, time) => (element.currentTime = time), at);
}

/** When "Test line n" of APART_SPEECH is heard: its true time in the video. */
export const heardApart = (n: number) => APART_SPEECH[n - 1]![0];
