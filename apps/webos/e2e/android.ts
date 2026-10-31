import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import type { Page } from '@playwright/test';

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

/** What the page asked of the Android app. */
export interface AndroidCalls {
  player: Record<string, unknown>[];
  opened: string[];
  exits: number;
}

/**
 * Serves the build where the Android app serves it, and puts a stand-in for
 * Android's bridge in the page, which notes every call. Call after mockAddons.
 */
export async function openAsAndroid(page: Page): Promise<void> {
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
  await page.addInitScript(() => {
    const calls = { player: [] as unknown[], opened: [] as string[], exits: 0 };
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
      },
    });
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
