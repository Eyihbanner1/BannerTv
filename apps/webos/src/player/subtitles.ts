import {
  type AddonAnswer,
  createStore,
  type Cue,
  detectEncoding,
  parseSubtitleText,
  type QueryState,
} from '@bannertv/core';
import type { Stream, Subtitle } from '@bannertv/protocol';
import { addonClient } from '../data/addons';

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

async function gunzip(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  // DecompressionStream arrived in Chromium 80; webOS 5 (Chromium 68) cannot open gzipped files.
  const Decompression = (window as { DecompressionStream?: new (format: string) => unknown })
    .DecompressionStream;
  if (!Decompression) throw new SubtitleLoadError('The subtitle file is compressed');
  const stream = new Blob([bytes]).stream().pipeThrough(
    new Decompression('gzip') as ReadableWritablePair<Uint8Array, Uint8Array>,
  );
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function download(url: string, lang: string): Promise<Cue[]> {
  const controller = typeof AbortController === 'undefined' ? null : new AbortController();
  const timer = window.setTimeout(() => controller?.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller?.signal }).catch(() => {
      throw new SubtitleLoadError('The subtitle file could not be reached');
    });
    if (!response.ok) throw new SubtitleLoadError(`The subtitle server answered ${response.status}`);
    const declared = Number(response.headers.get('content-length'));
    if (declared > MAX_BYTES) throw new SubtitleLoadError('The subtitle file is too big');
    let bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > MAX_BYTES) throw new SubtitleLoadError('The subtitle file is too big');
    if (isGzip(bytes)) {
      bytes = await gunzip(bytes);
      if (bytes.length > MAX_BYTES) throw new SubtitleLoadError('The subtitle file is too big');
    }
    const text = new TextDecoder(detectEncoding(bytes, lang)).decode(bytes);
    const cues = parseSubtitleText(text);
    if (cues.length === 0) throw new SubtitleLoadError('The subtitle file has no lines');
    return cues;
  } finally {
    clearTimeout(timer);
  }
}

/** Downloads and reads a subtitle file once; a failed one can be tried again. */
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

function toOption(prefix: string, source: string, subtitle: Subtitle): SubtitleOption {
  return {
    key: `${prefix}#${subtitle.id}`,
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

  return {
    get: state.get,
    subscribe: state.subscribe,
    start() {
      if (answers.length > 0) return;
      const { videoHash, videoSize, filename } = stream.behaviorHints;
      answers = addonClient.subtitles(type, videoId, { videoHash, videoSize, filename });
      unsubscribe = answers.map((answer) => answer.query.subscribe(refresh));
      answers.forEach((answer) => answer.query.load());
      refresh();
    },
    stop() {
      unsubscribe.forEach((undo) => undo());
      unsubscribe = [];
      // Starting again asks the query cache, which still holds the answers.
      answers = [];
    },
  };
}
