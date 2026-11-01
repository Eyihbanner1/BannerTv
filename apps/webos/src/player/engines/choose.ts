import { isAndroid } from '../../platform/android';
import { guessMimeType } from '../media';
import { requestHeadersFor } from '../request-headers';
import { createAndroidEngine } from './android';
import { throughStreamHelper } from './helper';
import { createHlsEngine } from './hls';
import { createNativeEngine } from './native';
import { createShakaEngine } from './shaka';
import type { Engine, EngineListener } from './types';

export type EngineName = Engine['name'];

/** How long the player waits for an HLS playlist before letting the TV open it as is. */
const PLAYLIST_TIMEOUT_MS = 5000;

/** RFC 8216 attribute lists: NAME=value pairs, where quoted values may hold commas. */
function readAttributes(list: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const pattern = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(list))) {
    const value = match[2]!;
    attributes[match[1]!] = value.charAt(0) === '"' ? value.slice(1, -1) : value;
  }
  return attributes;
}

/**
 * Whether an HLS playlist offers a choice the TV's own player hides: any
 * subtitle rendition, more than one audio rendition in a group, or more
 * than one audio language. webOS plays these but lists none of them (ADR
 * 0001), so they go through hls.js. Apple-style ladders with one audio per
 * group (AAC, AC-3, E-AC-3, all one language) stay with the TV.
 */
export function needsHlsJs(playlist: string): boolean {
  const groups: Record<string, number> = {};
  const languages: Record<string, true> = {};
  let languageCount = 0;
  for (const line of playlist.split(/\r?\n/)) {
    if (line.indexOf('#EXT-X-MEDIA:') !== 0) continue;
    const media = readAttributes(line.slice('#EXT-X-MEDIA:'.length));
    if (media.TYPE === 'SUBTITLES') return true;
    if (media.TYPE !== 'AUDIO') continue;
    const group = media['GROUP-ID'] ?? '';
    groups[group] = (groups[group] ?? 0) + 1;
    if (groups[group]! > 1) return true;
    const language = (media.LANGUAGE || media.NAME || '').toLowerCase();
    if (!languages[language]) {
      languages[language] = true;
      languageCount++;
    }
  }
  return languageCount > 1;
}

/**
 * For a media playlist, whether it is a broadcast: segments and no end. For
 * a multivariant playlist, null, with the address of its first variant to
 * read instead.
 */
export function readLive(playlist: string, url: string): boolean | { variant: string } | null {
  const lines = playlist.split(/\r?\n/).map((line) => line.trim());
  if (lines.some((line) => line.indexOf('#EXTINF') === 0)) {
    return lines.indexOf('#EXT-X-ENDLIST') === -1;
  }
  const at = lines.findIndex((line) => line.indexOf('#EXT-X-STREAM-INF') === 0);
  const variant =
    at === -1 ? undefined : lines.slice(at + 1).find((line) => line && line[0] !== '#');
  if (!variant) return null;
  try {
    return { variant: new URL(variant, url).href };
  } catch {
    return null;
  }
}

async function isBroadcast(url: string, playlist: string): Promise<boolean> {
  const read = readLive(playlist, url);
  if (read === null || typeof read === 'boolean') return read === true;
  const variant = await fetchPlaylist(read.variant);
  return variant !== null && readLive(variant, read.variant) === true;
}

function canUseMse(): boolean {
  return typeof MediaSource !== 'undefined' && typeof MediaSource.isTypeSupported === 'function';
}

async function fetchPlaylist(url: string): Promise<string | null> {
  const controller = typeof AbortController === 'undefined' ? null : new AbortController();
  const timer = window.setTimeout(() => controller?.abort(), PLAYLIST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller?.signal });
    return response.ok ? await response.text() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Picks the engine for a link. The TV's own player comes first: it is the only
 * one with full hardware decoding, HDR and Dolby audio. DASH goes to Shaka,
 * and HLS with alternate audio or subtitles, or live, to hls.js. hls.js and
 * Shaka fetch every segment themselves, so the stream's host must allow it
 * (CORS); when even the playlist cannot be read that way, the TV's player
 * gets the link.
 */
export async function chooseEngine(url: string): Promise<EngineName> {
  // Android's player opens files, HLS and DASH alike, and lists their tracks itself.
  if (isAndroid()) return 'android';
  // Through the stream helper: the playlist can't be read here without the addon's
  // headers, so the TV's player takes it rather than waiting on a read that fails.
  if (requestHeadersFor(url)) return 'native';
  const mime = guessMimeType(url);
  if (mime === 'application/dash+xml') return canUseMse() ? 'shaka' : 'native';
  if (mime !== 'application/vnd.apple.mpegurl' || !canUseMse()) return 'native';
  const playlist = await fetchPlaylist(url);
  if (playlist === null) return 'native';
  if (needsHlsJs(playlist)) return 'hls.js';
  // A broadcast too: hls.js plays it nearer live and wins back a wait, which
  // the TV's player can't be told to do. If hls.js can't, the TV's takes over.
  return (await isBroadcast(url, playlist)) ? 'hls.js' : 'native';
}

/**
 * The engine to try after `failed` could not open `url`, skipping engines
 * already tried for it. The TV's player and hls.js stand in for each other
 * on HLS; DASH has only Shaka, and other files only the TV.
 */
export function fallbackEngine(
  failed: EngineName,
  url: string,
  tried: ReadonlySet<EngineName>,
): EngineName | undefined {
  // The WebView's player would only fail on what Android's could not open: the next stream is the better try.
  if (failed === 'android') return undefined;
  if (guessMimeType(url) !== 'application/vnd.apple.mpegurl') return undefined;
  const other: EngineName = failed === 'native' ? 'hls.js' : 'native';
  if (tried.has(other) || (other === 'hls.js' && !canUseMse())) return undefined;
  return other;
}

function create(name: EngineName, video: HTMLVideoElement, listener: EngineListener): Engine {
  switch (name) {
    case 'hls.js':
      return createHlsEngine(video, listener);
    case 'shaka':
      return createShakaEngine(video, listener);
    case 'android':
      return createAndroidEngine(video, listener);
    default:
      return createNativeEngine(video, listener);
  }
}

/**
 * Creates an engine. The hls.js and Shaka engines are small; their libraries
 * load as separate scripts when they first open a stream. Off Android, streams
 * that need request headers go through the stream helper.
 */
export function createEngine(
  name: EngineName,
  video: HTMLVideoElement,
  listener: EngineListener,
): Engine {
  const engine = create(name, video, listener);
  return name === 'android' ? engine : throughStreamHelper(engine);
}
