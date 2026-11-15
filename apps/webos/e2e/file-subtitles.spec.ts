import { expect, type Page, test } from '@playwright/test';
import { mockAddons } from './addons';
import {
  DEFAULT_STREAMS,
  MKV_LINES,
  mockPlayback,
  type RedirectOptions,
  seedStreamAddon,
  serveRedirects,
  type TestSubtitle,
} from './play';
import {
  MOVIE,
  openMovie,
  openSheet,
  openTiming,
  OPENSUBTITLES,
  recordShownAt,
  shownAt,
  subtitlesDiagnostics,
  video,
} from './player';
import { openAsLgTv } from './homebrew';
import { press, pressBack } from './tv';

/*
 * The video file's own subtitles on the TV's own player (ADR 0003, decision 9): MKV files
 * made by fixtures/mkv/make-mkv.sh from the blank 10-minute video and made-up lines, served
 * through an addon's link that leads to a debrid service and on to its media server, as real
 * servers on this machine with the browser's own cross-origin checks.
 */

interface Play {
  file: string;
  language?: string;
  subtitleList?: readonly TestSubtitle[];
  server?: RedirectOptions;
  /** Before the player opens: CPU throttling, the marks switch. */
  before?: (page: Page) => Promise<void>;
}

/** Plays an MKV file of fixtures/mkv through the redirects, to its first picture. */
async function playFile(page: Page, play: Play) {
  await page.addInitScript(() =>
    localStorage.setItem('bannertv.tuning', JSON.stringify({ marks: true })),
  );
  await recordShownAt(page);
  await mockAddons(page);
  await seedStreamAddon(page, { preferences: { subtitleLanguage: play.language ?? 'eng' } });
  const chain = await serveRedirects(page, play.server);
  const mock = await mockPlayback(page, {
    streams: { [MOVIE]: [{ ...DEFAULT_STREAMS[0]!, path: chain.link(`/mkv-${play.file}`) }] },
    subtitleList: play.subtitleList ?? [],
  });
  await openMovie(page);
  await play.before?.(page);
  await press(page, 'Enter', 'player-surface');
  await expect.poll(async () => (await video(page)).playing).toBe(true);
  return { chain, mock };
}

/** The page's marks, by name, at their times in milliseconds. */
function marks(page: Page): Promise<Record<string, number>> {
  return page.evaluate(() => {
    const byName: Record<string, number> = {};
    for (const entry of performance.getEntriesByType('mark')) {
      if (byName[entry.name] === undefined) byName[entry.name] = entry.startTime;
    }
    return byName;
  });
}

/** The made-up film's line `n` (from 1) of the file's English track, as its test line says. */
const line = (n: number) => ({ text: `Test line ${n}`, start: MKV_LINES[n - 1]![0] });

/** The first line starting at or after `seconds`. */
function lineFrom(seconds: number) {
  const index = MKV_LINES.findIndex(([start]) => start >= seconds);
  return { n: index + 1, ...line(index + 1) };
}

/** The reads the page made of the file past the hash's: its own subtitles'. */
function readerReads(chain: Awaited<ReturnType<typeof serveRedirects>>, size: number) {
  return chain.fetched.filter(
    ({ server, range }) =>
      server === 'media' &&
      range !== undefined &&
      range !== 'bytes=0-65535' &&
      range !== `bytes=${size - 65536}-${size - 1}`,
  );
}

const OWN_SIZE = 287072;

test('a direct-play MKV’s own English track shows by itself, on time and after a seek, read past the hash’s bytes with no walk of its own', async ({
  page,
}) => {
  test.setTimeout(90000);
  const { chain } = await playFile(page, { file: 'own.mkv' });

  // Chosen by itself: the file's own English track, its first line on time.
  await expect.poll(() => shownAt(page, line(1).text), { timeout: 15000 }).not.toBeNull();
  expect(Math.abs((await shownAt(page, line(1).text))! - line(1).start)).toBeLessThan(0.5);
  for (const n of [2, 3]) {
    await expect.poll(() => shownAt(page, line(n).text), { timeout: 15000 }).not.toBeNull();
    expect(Math.abs((await shownAt(page, line(n).text))! - line(n).start)).toBeLessThan(0.5);
  }

  // After a seek to 5:00, the line due at about 5:02 shows on time.
  const due = lineFrom(301);
  await page
    .locator('video:not([aria-hidden])')
    .evaluate((element: HTMLVideoElement) => (element.currentTime = 300));
  await expect.poll(() => shownAt(page, due.text), { timeout: 20000 }).not.toBeNull();
  expect(Math.abs((await shownAt(page, due.text))! - due.start)).toBeLessThan(0.5);

  // The link walked once, by the hash; every read of the reader straight to where it led, and
  // the file's first 64 KB read once.
  expect(chain.fetched.filter(({ server }) => server === 'resolve')).toHaveLength(1);
  expect(chain.fetched.filter(({ range }) => range === 'bytes=0-65535')).toHaveLength(3);
  expect(readerReads(chain, OWN_SIZE).length).toBeGreaterThan(0);

  // The reader started after the first picture.
  const at = await marks(page);
  expect(at['play:first-frame']).toBeDefined();
  expect(at['sub:file:start']).toBeGreaterThan(at['play:first-frame']!);
  expect(at['sub:file:read']).toBeGreaterThan(at['sub:file:start']!);

  const section = await subtitlesDiagnostics(page);
  await expect(section).toContainText(
    /the video file’s own subtitles: 3 text tracks \(en, es\); read in \d+\.\d s, \d+ requests?, \d+ KB/,
  );
  const shown = await section.innerText();
  for (const name of ['http', '127.0.0.1', 'token', 'resolve', '.mkv']) {
    expect(shown).not.toContain(name);
  }
});

/** Watches for the player's spinner from now on: whether it ever showed (status buffering). */
async function watchBuffering(page: Page) {
  await page.evaluate(() => {
    const seen = { buffering: false };
    (window as unknown as { buffered: typeof seen }).buffered = seen;
    const look = () => {
      if (document.querySelector('[role="status"][aria-label="Loading"]')) seen.buffering = true;
    };
    new MutationObserver(look).observe(document, { childList: true, subtree: true });
    look();
  });
  return () =>
    page.evaluate(() => (window as unknown as { buffered: { buffering: boolean } }).buffered);
}

/** An English file of the made-up film's lines on time, as OpenSubtitles finds by the video's id. */
const ENGLISH_FILE: TestSubtitle = { id: 'mkvEnglish', lang: 'eng' };
/** The same lines 3 s late, as from another release. */
const LATE_FILE: TestSubtitle = { id: 'mkvEnglishLate', lang: 'eng' };

test('a file whose subtitles have no index shows the addon’s file as before, and lists nothing in the stream', async ({
  page,
}) => {
  await playFile(page, { file: 'no-index.mkv', subtitleList: [ENGLISH_FILE] });
  await expect(page.getByText('English file, line 1', { exact: true })).toBeVisible({
    timeout: 15000,
  });
  await openSheet(page, 'player-tracks-lang-en');
  await expect(page.getByText('In the stream')).toHaveCount(0);
  await pressBack(page);
  const section = await subtitlesDiagnostics(page);
  await expect(section).toContainText(
    'the video file’s own subtitles: none (the file’s subtitles have no index, 1 request)',
  );
});

test('a file of picture subtitles only lists nothing, and reads nothing past the hash’s bytes', async ({
  page,
}) => {
  const { chain } = await playFile(page, { file: 'pictures.mkv', subtitleList: [ENGLISH_FILE] });
  await expect(page.getByText('English file, line 1', { exact: true })).toBeVisible({
    timeout: 15000,
  });
  await openSheet(page, 'player-tracks-lang-en');
  await expect(page.getByText('In the stream')).toHaveCount(0);
  await pressBack(page);
  // What the hash read held was enough: no index read for nothing to show.
  expect(readerReads(chain, 272338)).toEqual([]);
  const section = await subtitlesDiagnostics(page);
  await expect(section).toContainText(
    'the video file’s own subtitles: 0 text tracks, 1 picture track; read in',
  );
});

test('the file’s full English track is chosen over its forced one, and lines up a late file picked by hand', async ({
  page,
}) => {
  test.setTimeout(90000);
  await playFile(page, { file: 'own.mkv', subtitleList: [LATE_FILE] });
  await expect.poll(() => shownAt(page, line(1).text), { timeout: 15000 }).not.toBeNull();

  await openSheet(page, 'player-tracks-lang-en');
  await press(page, 'ArrowRight', 'player-tracks-track-mkv:2');
  await expect(page.locator('[data-focus-key="player-tracks-track-mkv:2"]')).toHaveText(
    'In the stream 1',
  );
  // The forced one is listed, by its name, after the full one; never the reference.
  await expect(page.locator('[data-focus-key="player-tracks-track-mkv:3"]')).toHaveText(
    'In the stream 2Signs',
  );
  await press(page, 'ArrowDown', 'player-tracks-track-mkv:3');
  await press(page, 'ArrowDown', `${OPENSUBTITLES}#mkvEnglishLate`);
  await page.keyboard.press('Enter');
  // Lined up against the file's English track, whose every line's timing its index gave.
  const due = lineFrom((await video(page)).time + 6);
  const late = `Late file, line ${due.n}`;
  await expect.poll(() => shownAt(page, late), { timeout: 20000 }).not.toBeNull();
  expect(Math.abs((await shownAt(page, late))! - due.start)).toBeLessThan(0.6);
  // The sheet is still open, on the versions: its Timing tab says so.
  await pressBack(page);
  await press(page, 'ArrowRight', 'player-tracks-tab-audio');
  await press(page, 'ArrowRight', 'player-tracks-tab-timing');
  await expect(page.getByText('Lined up by BannerTV: −3.0 s')).toBeVisible();
});

test('a file with only a Spanish track lines an English file 3 s late up against it, from its first line', async ({
  page,
}) => {
  test.setTimeout(90000);
  await playFile(page, { file: 'spanish.mkv', subtitleList: [LATE_FILE] });
  const first = 'Late file, line 1';
  await expect.poll(() => shownAt(page, first), { timeout: 15000 }).not.toBeNull();
  expect(Math.abs((await shownAt(page, first))! - line(1).start)).toBeLessThan(0.6);
  // The Spanish track never showed.
  expect(await shownAt(page, 'Línea de prueba 1')).toBeNull();
  await openTiming(page);
  await expect(page.getByText('Lined up by BannerTV: −3.0 s')).toBeVisible();
  await pressBack(page);
  const section = await subtitlesDiagnostics(page);
  await expect(section).toContainText('lined up against the stream’s track: en sure −3.0 s');
  await expect(section).toContainText('files lined up against es');
  await expect(section).not.toContainText('files that agree');
});

test('a server that answers a range with the whole file is read no further, and the addon’s file shows', async ({
  page,
}) => {
  const { chain } = await playFile(page, {
    file: 'own.mkv',
    subtitleList: [ENGLISH_FILE],
    server: { ignoreRange: true },
  });
  await expect(page.getByText('English file, line 1', { exact: true })).toBeVisible({
    timeout: 15000,
  });
  // The hash's first read only, through the redirects.
  expect(chain.fetched.filter(({ server }) => server === 'media')).toHaveLength(1);
  const section = await subtitlesDiagnostics(page);
  await expect(section).toContainText(
    'the video file’s own subtitles: none (the server refused byte ranges)',
  );
});

test('a server too slow for the file’s index lets the addon’s file show within 6 s, never stops the video, and gives up at 20 s', async ({
  page,
}) => {
  test.setTimeout(90000);
  await playFile(page, {
    file: 'own.mkv',
    subtitleList: [ENGLISH_FILE],
    server: { slowReads: 25000 },
  });
  const buffered = await watchBuffering(page);
  await expect(page.getByText(/^English file, line \d+$/).first()).toBeVisible({
    timeout: 15000,
  });
  const at = await marks(page);
  expect(at['sub:chosen:file']! - at['sub:file:start']!).toBeLessThan(6500);
  expect(await page.getByText('In the stream').count()).toBe(0);
  await expect
    .poll(async () => (await marks(page))['sub:file:none:timed-out'], {
      timeout: 30000,
    })
    .toBeDefined();
  expect((await buffered()).buffering).toBe(false);
  const section = await subtitlesDiagnostics(page);
  await expect(section).toContainText('the video file’s own subtitles: none (gave up after 20 s');
});

test('a link good for one read leaves the file’s subtitles, with no walk of the reader’s own', async ({
  page,
}) => {
  const { chain } = await playFile(page, {
    file: 'own.mkv',
    subtitleList: [ENGLISH_FILE],
    server: { oneUse: true },
  });
  await expect(page.getByText('English file, line 1', { exact: true })).toBeVisible({
    timeout: 15000,
  });
  // The hash's walks only: its first read, and each read after the link it led to refused.
  const walks = chain.fetched.filter(({ server }) => server === 'resolve').length;
  expect(walks).toBeLessThanOrEqual(3);
  expect(readerReads(chain, OWN_SIZE)).toEqual([]);
  await openSheet(page, 'player-tracks-lang-en');
  await expect(page.getByText('In the stream')).toHaveCount(0);
  await pressBack(page);
  const section = await subtitlesDiagnostics(page);
  await expect(section).toContainText(
    'the video file’s own subtitles: none (the link allows one read)',
  );
});

test('with the TV’s CPU four times slower, the file’s own track still shows its first line on time, read after the first picture', async ({
  page,
}) => {
  test.setTimeout(120000);
  await playFile(page, {
    file: 'own.mkv',
    before: async (throttled) => {
      const cdp = await throttled.context().newCDPSession(throttled);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    },
  });
  await expect.poll(() => shownAt(page, line(1).text), { timeout: 30000 }).not.toBeNull();
  expect(Math.abs((await shownAt(page, line(1).text))! - line(1).start)).toBeLessThan(0.5);
  const at = await marks(page);
  expect(at['sub:file:start']).toBeGreaterThan(at['play:first-frame']!);
  expect(at['sub:file:read']).toBeGreaterThan(at['sub:file:start']!);
  expect(at['sub:chosen:track']).toBeGreaterThanOrEqual(at['sub:file:read']!);
  const toList = at['sub:file:read']! - at['play:first-frame']!;
  test.info().annotations.push({
    type: 'time to the track list',
    description: `${Math.round(toList)} ms after the first picture (${Math.round(
      at['sub:file:read']! - at['sub:file:start']!,
    )} ms reading)`,
  });
});

test('on an LG TV, the subtitles row of a play with the file’s own subtitles stays inside the screen', async ({
  page,
}) => {
  test.setTimeout(90000);
  await openAsLgTv(page);
  await playFile(page, { file: 'spanish.mkv', subtitleList: [LATE_FILE] });
  await expect.poll(() => shownAt(page, 'Late file, line 1'), { timeout: 15000 }).not.toBeNull();
  const section = await subtitlesDiagnostics(page);
  await expect(section).toContainText('the video file’s own subtitles: 1 text track (es)');
  const box = await section.boundingBox();
  expect(box!.y + box!.height).toBeLessThanOrEqual(1080 - 54);
});
