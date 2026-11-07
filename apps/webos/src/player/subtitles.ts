import {
  type AddonAnswer,
  createStore,
  type Cue,
  detectEncoding,
  parseSubtitleText,
  type QueryState,
  stripAdCues,
  subtitleFileKey,
} from '@bannertv/core';
import type { Stream, Subtitle } from '@bannertv/protocol';
import { addonClient } from '../data/addons';
import { hashStream } from './stream-hash';

/** A subtitle file the viewer can pick. Never shows its link, which can carry account keys. */
export interface SubtitleOption {
  /** Stable within one video: where it came from, then the addon's id for it. */
  key: string;
  lang: string;
  label?: string;
  /** The addon that offered it, or the stream's addon for subtitles that came with the stream. */
  source: string;
  url: string;
}

export interface SubtitleListState {
  options: SubtitleOption[];
  /** Addons that have not answered yet. */
  pending: number;
}

const FETCH_TIMEOUT_MS = 15000;
const MAX_BYTES = 5 * 1024 * 1024;
/** Parsed files kept for switching back and forth; the oldest is dropped. */
const CACHE_SIZE = 6;

export class SubtitleLoadError extends Error {}

const cache = new Map<string, Promise<Cue[]>>();

function isGzip(bytes: Uint8Array): boolean {
  return bytes[0] === 0x1f && bytes[1] === 0x8b;
}

/**
 * Reads a body up to MAX_BYTES and stops there, so a file with no declared
 * size, or a small gzip that unpacks to gigabytes, never fills the TV's memory.
 */
async function readCapped(body: ReadableStream<Uint8Array>): Promise<Uint8Array<ArrayBuffer>> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_BYTES) {
      reader.cancel().catch(() => undefined);
      throw new SubtitleLoadError('The subtitle file is too big');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.length;
  }
  return bytes;
}

async function gunzip(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  // DecompressionStream arrived in Chromium 80; webOS 5 (Chromium 68) cannot open gzipped files.
  const Decompression = (window as { DecompressionStream?: new (format: string) => unknown })
    .DecompressionStream;
  if (!Decompression) throw new SubtitleLoadError('The subtitle file is compressed');
  const stream = new Blob([bytes])
    .stream()
    .pipeThrough(new Decompression('gzip') as ReadableWritablePair<Uint8Array, Uint8Array>);
  return readCapped(stream);
}

async function download(url: string, lang: string): Promise<Cue[]> {
  const controller = typeof AbortController === 'undefined' ? null : new AbortController();
  const timer = window.setTimeout(() => controller?.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller?.signal }).catch(() => {
      throw new SubtitleLoadError('The subtitle file could not be reached');
    });
    if (!response.ok)
      throw new SubtitleLoadError(`The subtitle server answered ${response.status}`);
    const declared = Number(response.headers.get('content-length'));
    if (declared > MAX_BYTES) throw new SubtitleLoadError('The subtitle file is too big');
    let bytes = response.body
      ? await readCapped(response.body)
      : new Uint8Array(await response.arrayBuffer());
    if (bytes.length > MAX_BYTES) throw new SubtitleLoadError('The subtitle file is too big');
    if (isGzip(bytes)) bytes = await gunzip(bytes);
    const text = new TextDecoder(detectEncoding(bytes, lang)).decode(bytes);
    // The lines subtitle sites add (adverts, the site's address, credits for the file) never show.
    const cues = stripAdCues(parseSubtitleText(text));
    if (cues.length === 0) throw new SubtitleLoadError('The subtitle file has no lines');
    return cues;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Downloads and reads a subtitle file once, without the adverts and credits
 * subtitle sites add; a failed one can be tried again.
 */
export function loadSubtitles(option: Pick<SubtitleOption, 'url' | 'lang'>): Promise<Cue[]> {
  const existing = cache.get(option.url);
  if (existing) {
    // Most recently used last, so the oldest is dropped first.
    cache.delete(option.url);
    cache.set(option.url, existing);
    return existing;
  }
  const promise = download(option.url, option.lang);
  cache.set(option.url, promise);
  promise.catch(() => cache.delete(option.url));
  while (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!);
  return promise;
}

/**
 * An addon's id for a file, fit for a key: a file sent with no id has its
 * link as its id, which never goes into a key (they reach focus keys), so
 * anything but a short plain id is hashed.
 */
export function plainId(id: string): string {
  return /^[\w.-]{1,64}$/.test(id) ? id : `h${subtitleFileKey('', id)}`;
}

function toOption(prefix: string, source: string, subtitle: Subtitle): SubtitleOption {
  return {
    key: `${prefix}#${plainId(subtitle.id)}`,
    lang: subtitle.lang,
    label: subtitle.label,
    source,
    url: subtitle.url,
  };
}

/**
 * Every subtitle on offer for one stream: the stream's own first, then each
 * subtitles addon's in the collection's order. Addons are asked with the
 * stream's hash, size and file name, so they can match the exact release.
 * A stream whose addon sent no hash has it read from the file first, for a
 * few seconds at most; addons are asked without it if it can't be read.
 */
export function subtitleList(
  type: string,
  videoId: string,
  stream: Stream,
  streamAddon: string,
): {
  get(): SubtitleListState;
  subscribe(listener: () => void): () => void;
  start(): void;
  stop(): void;
} {
  const own = stream.subtitles.map((subtitle) => toOption('stream', streamAddon, subtitle));
  const state = createStore<SubtitleListState>({ options: own, pending: 0 });
  let answers: ReadonlyArray<AddonAnswer<Subtitle[]>> = [];
  let unsubscribe: Array<() => void> = [];
  // Bumped by stop(), so a hash read that ends after it asks no addon.
  let run = 0;
  let hashing = false;

  function refresh() {
    const states: Array<QueryState<Subtitle[]>> = answers.map((answer) => answer.query.get());
    const options = own.slice();
    const seen = new Set(own.map((option) => option.url));
    answers.forEach(({ addon }, i) => {
      for (const subtitle of states[i]!.data ?? []) {
        if (seen.has(subtitle.url)) continue;
        seen.add(subtitle.url);
        options.push(toOption(addon.manifest.id, addon.manifest.name, subtitle));
      }
    });
    const pending = states.filter((s) => s.status === 'idle' || s.status === 'loading').length;
    state.set({ options, pending });
  }

  function ask(videoHash: string | undefined, videoSize: number | undefined) {
    const { filename } = stream.behaviorHints;
    answers = addonClient.subtitles(type, videoId, { videoHash, videoSize, filename });
    unsubscribe = answers.map((answer) => answer.query.subscribe(refresh));
    answers.forEach((answer) => answer.query.load());
    refresh();
  }

  return {
    get: state.get,
    subscribe: state.subscribe,
    start() {
      if (answers.length > 0 || hashing) return;
      const { videoHash, videoSize } = stream.behaviorHints;
      const source = stream.source;
      if (videoHash || source.kind !== 'url') {
        ask(videoHash, videoSize);
        return;
      }
      const current = ++run;
      hashing = true;
      // Still looking: the addons have not been asked yet.
      state.set({ ...state.get(), pending: Math.max(1, state.get().pending) });
      void hashStream(source.url, videoSize).then((found) => {
        if (current !== run) return;
        hashing = false;
        ask(found?.videoHash, found?.videoSize ?? videoSize);
      });
    },
    stop() {
      run++;
      hashing = false;
      unsubscribe.forEach((undo) => undo());
      unsubscribe = [];
      // Starting again asks the query cache, which still holds the answers.
      answers = [];
    },
  };
}
