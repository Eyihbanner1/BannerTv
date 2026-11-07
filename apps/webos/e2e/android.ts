import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { expect, type Page } from '@playwright/test';

/**
 * The app as the Android app (apps/androidtv) shows it: the same build, served
 * from inside the APK at this address, with Android's bridge in the page.
 */
export const ANDROID_ORIGIN = 'https://appassets.androidplatform.net';
export const ANDROID_URL = `${ANDROID_ORIGIN}/assets/web/index.html`;

const DIST = resolve(import.meta.dirname, '../dist');
const TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

/** A card on the system's Watch Next row, as the page sends it. */
export interface WatchNextCard {
  type: string;
  meta: string;
  video: string;
  title: string;
  episodeTitle?: string;
  season?: number;
  episode?: number;
  description?: string;
  landscape?: string;
  poster?: string;
  position: number;
  duration: number;
  next: boolean;
  watchedAt: number;
}

/** A title a Watch Next card opens, as Android hands it to the page. */
export interface AndroidLink {
  type: string;
  meta: string;
  video?: string;
}

/** What the page asked of the Android app. */
export interface AndroidCalls {
  player: Record<string, unknown>[];
  opened: string[];
  exits: number;
  /** Each list of cards sent for the Watch Next row, oldest first. */
  watchNext: WatchNextCard[][];
}

/**
 * Where the stand-in keeps the link Android holds for the page. Android keeps it across the
 * page's reloads until the page takes it, and so does sessionStorage.
 */
const LINK_KEY = 'test.androidLink';

/**
 * Serves the build where the Android app serves it, and puts a stand-in for
 * Android's bridge in the page, which notes every call. Call after mockAddons.
 * `link` is the card the app was started from, if any.
 */
export async function openAsAndroid(
  page: Page,
  options: { link?: AndroidLink } = {},
): Promise<void> {
  await page.route(`${ANDROID_ORIGIN}/assets/web/**`, async (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/assets\/web\//, '');
    try {
      const body = await readFile(resolve(DIST, path));
      return await route.fulfill({
        contentType: TYPES[extname(path)] ?? 'application/octet-stream',
        body,
      });
    } catch {
      return route.fulfill({ status: 404 });
    }
  });
  await page.addInitScript(
    ({ key, link }) => {
      // Started from the card once: a reload is the same run of the app.
      if (link && !sessionStorage.getItem(`${key}.started`)) {
        sessionStorage.setItem(`${key}.started`, '1');
        sessionStorage.setItem(key, link);
      }
    },
    { key: LINK_KEY, link: options.link ? JSON.stringify(options.link) : null },
  );
  await page.addInitScript((linkKey) => {
    const calls = {
      player: [] as unknown[],
      opened: [] as string[],
      exits: 0,
      watchNext: [] as unknown[],
    };
    Object.assign(window, {
      androidCalls: calls,
      BannerAndroid: {
        protocol: () => '1',
        hostInfo: () =>
          JSON.stringify({
            appVersion: '0.1.0',
            versionCode: 1000,
            sdk: 34,
            release: '14',
            manufacturer: 'Google',
            model: 'Chromecast HD',
            webView: '138.0.7204.244',
            tv: true,
            fireTv: false,
            lowRam: false,
          }),
        capabilities: () =>
          JSON.stringify({
            uhd: true,
            hdr10: true,
            dolbyVision: false,
            hevc: true,
            av1: false,
            dts: false,
            truehd: false,
          }),
        exit: () => calls.exits++,
        openExternal: (url: string) => calls.opened.push(url),
        player: (command: string) => calls.player.push(JSON.parse(command)),
        watchNext: (cards: string) =>
          calls.watchNext.push((JSON.parse(cards) as { cards: unknown }).cards),
        takeLink: () => {
          const link = sessionStorage.getItem(linkKey) ?? '';
          sessionStorage.removeItem(linkKey);
          return link;
        },
      },
    });
  }, LINK_KEY);
}

/** The cards the page sent for the Watch Next row last, or undefined before it sent any. */
export async function watchNextRow(page: Page): Promise<WatchNextCard[] | undefined> {
  const sent = (await androidCalls(page)).watchNext;
  return sent[sent.length - 1];
}

/** Whether a link still waits in Android for the page to take it. */
export function linkWaiting(page: Page): Promise<boolean> {
  return page.evaluate((key) => sessionStorage.getItem(key) !== null, LINK_KEY);
}

/** A Watch Next card is pressed while the app runs: Android holds its link and tells the page. */
export async function cardPressed(page: Page, link: AndroidLink): Promise<void> {
  await page.evaluate(
    ({ key, value }) => {
      sessionStorage.setItem(key, value);
      (
        window as unknown as { __bannerAndroid: { event(event: unknown): void } }
      ).__bannerAndroid.event({ type: 'open' });
    },
    { key: LINK_KEY, value: JSON.stringify(link) },
  );
}

/** The app leaves the screen, as when Home is pressed on the remote: Android hides the page. */
export async function leaveApp(page: Page): Promise<void> {
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

export function androidCalls(page: Page): Promise<AndroidCalls> {
  return page.evaluate(() => (window as unknown as { androidCalls: AndroidCalls }).androidCalls);
}

/** The player commands the page has sent so far, by op. */
export async function playerOps(page: Page): Promise<string[]> {
  return (await androidCalls(page)).player.map((command) => String(command.op));
}

/**
 * An event from the Android app, as it sends one: player news names the latest load command,
 * as Android's player does.
 */
export async function androidSays(page: Page, event: Record<string, unknown>): Promise<void> {
  await page.evaluate((sent) => {
    const w = window as unknown as {
      androidCalls: AndroidCalls;
      __bannerAndroid: { event(event: unknown): void };
    };
    const loads = w.androidCalls.player.filter((command) => command.op === 'load');
    const latest = loads[loads.length - 1];
    const news = sent.type === 'player' && latest ? { load: latest.id, ...sent } : sent;
    w.__bannerAndroid.event(news);
  }, event);
}

/** Android's player reports where it is and what it is doing. */
export function playerState(
  page: Page,
  state: {
    playing: boolean;
    playWhenReady?: boolean;
    buffering?: boolean;
    position?: number;
    duration?: number | null;
    ended?: boolean;
    ready?: boolean;
    live?: boolean;
  },
): Promise<void> {
  return androidSays(page, {
    type: 'player',
    event: 'state',
    playWhenReady: state.playWhenReady ?? true,
    playing: state.playing,
    buffering: state.buffering ?? false,
    ready: state.ready ?? !state.buffering,
    ended: state.ended ?? false,
    position: state.position ?? 0,
    duration: state.duration === undefined ? 900 : state.duration,
    live: state.live ?? false,
  });
}

/**
 * OK on the title Home has focused, until Details opens. An OK in Home's first quarter second
 * is sometimes left unanswered (other journeys that press it at once show it too), so it is
 * pressed again only once Details has plainly not opened.
 */
export async function openFocusedTitle(page: Page): Promise<void> {
  await expect(async () => {
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-focused="true"]')).toHaveAttribute(
      'data-focus-key',
      'details-watch',
      { timeout: 2000 },
    );
  }).toPass({ timeout: 10_000 });
}

/** Android's player names its subtitle tracks inside the file, as onTracksChanged does. */
export function androidTextTracks(
  page: Page,
  text: Array<{ id: string; lang: string; label?: string; mime?: string }>,
): Promise<void> {
  return androidSays(page, {
    type: 'player',
    event: 'tracks',
    audio: [],
    text: text.map((track) => ({
      label: '',
      mime: 'application/x-subrip',
      ...track,
      active: false,
      supported: true,
      forced: false,
    })),
  });
}

/**
 * Android's player hands over the lines of subtitle track `track` that show from `at`, as
 * onCues does once the page asked for them: none ends the line before.
 */
export function androidCues(
  page: Page,
  at: number,
  cues: Array<{ text: string; top?: boolean }>,
  track = '2:0',
): Promise<void> {
  return androidSays(page, { type: 'player', event: 'cues', track, at, cues });
}

/**
 * What Android's player sends as it opens a stream at `startAt`, in its order: the jump to the
 * start, then buffering on a placeholder with no length (before and after it is told to play),
 * then the picture moving once it has read the file.
 */
export async function androidOpens(page: Page, startAt = 0, duration = 900): Promise<void> {
  if (startAt > 0) await androidSays(page, { type: 'player', event: 'seeked', position: startAt });
  const opening = {
    playing: false,
    buffering: true,
    ready: false,
    position: startAt,
    duration: null,
  };
  await playerState(page, { ...opening, playWhenReady: false });
  await playerState(page, opening);
  await playerState(page, { playing: true, position: startAt, duration });
}
