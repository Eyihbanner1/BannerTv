import {
  type AddonAnswer,
  createStore,
  type Cue,
  detectEncoding,
  fileReleaseMatch,
  HASH_MATCHING_ADDON_IDS,
  isZip,
  languageKey,
  parseSubtitleText,
  type QueryState,
  type ReleaseMatch,
  stripAdCues,
  subdlCodeFor,
  type SubdlFile,
  subdlFileLanguage,
  type SubdlSearch,
  type SubdlSearchState,
  subtitleFileKey,
  subtitleFromZip,
  type VideoRelease,
  ZipError,
} from '@bannertv/core';
import type { Stream, Subtitle } from '@bannertv/protocol';
import { addonClient } from '../data/addons';
import { isSubdlDownload, subdl, subdlResting, subdlUsage } from '../data/subdl';
import { mark } from '../platform/marks';
import { readStreamHash } from './stream-hash';
import {
  type SubdlTrace,
  traceFiles,
  traceHash,
  traceHashLinked,
  traceSubdl,
  traceSubdlMore,
} from './subtitle-trace';

/** A subtitle file the viewer can pick. Never shows its link, which can carry account keys. */
export interface SubtitleOption {
  /** Stable within one video: where it came from, then the addon's id for it. */
  key: string;
  lang: string;
  /** Its name: the release it matches, or the file's own name (OpenSubtitles). */
  label?: string;
  /** A second release name, for matching the video only, never shown. */
  releaseName?: string;
  /** OpenSubtitles found it by the video's hash: someone linked it to this very video. */
  hashMatch?: boolean;
  /**
   * Linked to the video by a hash read after the files were first listed
   * without it: it came late, and takes over only as a late file may.
   */
  linkedLate?: boolean;
  /** Frames a second it was timed for, as the addon says: often wrong. */
  fps?: number;
  /** The season and episode the addon says it is for. */
  season?: number;
  episode?: number;
  /** The addon that offered it, or the stream's addon for subtitles that came with the stream. */
  source: string;
  url: string;
}

export interface SubtitleListState {
  options: SubtitleOption[];
  /**
   * Addons that have not answered yet, the hash counted as one while it may
   * still bring files: an Off settled meanwhile would never be planned again.
   */
  pending: number;
  /**
   * The hash may still link files to the video: still being read after the
   * addons were asked without it, or asked again with it and not answered.
   */
  hashComing?: boolean;
  /** Of those in `pending`, the hash still being read after the addons were asked without it. */
  hashReading?: boolean;
  /**
   * Of those in `pending`, SubDL's searches still asking: not addons, and a
   * track of forced lines only is not held back for them.
   */
  subdlAsking?: number;
}

/**
 * The longest the addons wait for the video's hash before they are asked
 * without it: a hash read later asks again those that match by it.
 */
export const HASH_WAIT_MS = 2000;

const FETCH_TIMEOUT_MS = 15000;
const MAX_BYTES = 5 * 1024 * 1024;
/** Parsed files kept for switching back and forth; the oldest is dropped. */
const CACHE_SIZE = 6;

export class SubtitleLoadError extends Error {}

const cache = new Map<string, Promise<Cue[]>>();
/** Files being read and not to be kept, so a second ask while one is read shares its download. */
const passing = new Map<string, Promise<Cue[]>>();

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

/** The episode wanted from a ZIP that may hold others, as SubDL's list marks it on the link: "#s2e3". */
const PACK_EPISODE = /#s(\d+)e(\d+)$/;

async function download(url: string, lang: string): Promise<Cue[]> {
  // The fragment says which file of a pack is wanted; it is never sent.
  const cut = url.indexOf('#');
  const fetchUrl = cut === -1 ? url : url.slice(0, cut);
  const packed = PACK_EPISODE.exec(url);
  const pick = packed ? { season: Number(packed[1]), episode: Number(packed[2]) } : {};
  // A SubDL file counts against the day's downloads; never with the key.
  if (isSubdlDownload(fetchUrl) && !subdlUsage.takeDownload()) {
    throw new SubtitleLoadError('SubDL files are used up for today');
  }
  const controller = typeof AbortController === 'undefined' ? null : new AbortController();
  const timer = window.setTimeout(() => controller?.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(fetchUrl, { signal: controller?.signal }).catch(() => {
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
    if (isZip(bytes)) {
      try {
        bytes = subtitleFromZip(bytes, pick) as Uint8Array<ArrayBuffer>;
      } catch (error) {
        if (error instanceof ZipError) {
          throw new SubtitleLoadError('The subtitle archive could not be read');
        }
        throw error;
      }
    } else if (isGzip(bytes)) bytes = await gunzip(bytes);
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
 * subtitle sites add; a failed one can be tried again. `keep: false` reads
 * one without keeping it among the parsed files (the files that agree read
 * dozens, which would push out those the viewer switches between): one kept
 * already, or being read, is still shared.
 */
export function loadSubtitles(
  option: Pick<SubtitleOption, 'url' | 'lang'>,
  { keep = true }: { keep?: boolean } = {},
): Promise<Cue[]> {
  const existing = cache.get(option.url);
  if (existing) {
    // Most recently used last, so the oldest is dropped first.
    cache.delete(option.url);
    cache.set(option.url, existing);
    return existing;
  }
  const reading = passing.get(option.url);
  const promise = reading ?? download(option.url, option.lang);
  if (!keep) {
    if (!reading) {
      passing.set(option.url, promise);
      const done = () => {
        if (passing.get(option.url) === promise) passing.delete(option.url);
      };
      promise.then(done, done);
    }
    return promise;
  }
  passing.delete(option.url);
  cache.set(option.url, promise);
  promise.catch(() => cache.delete(option.url));
  while (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!);
  return promise;
}

/**
 * Forgets the files read so far, as the player screen closes: those read
 * only for their checks would otherwise stay in memory after it.
 */
export function clearSubtitleCache(): void {
  cache.clear();
  passing.clear();
}

/**
 * An addon's id for a file, fit for a key: a file sent with no id has its
 * link as its id, which never goes into a key (they reach focus keys), so
 * anything but a short plain id is hashed.
 */
export function plainId(id: string): string {
  return /^[\w.-]{1,64}$/.test(id) ? id : `h${subtitleFileKey('', id)}`;
}

/** A file an addon listed, and whether its link to the video came with a hash read late. */
export type ListedSubtitle = Subtitle & { linkedLate?: boolean };

export function toOption(prefix: string, source: string, subtitle: ListedSubtitle): SubtitleOption {
  const { label, releaseName, hashMatch, linkedLate, fps, season, episode } = subtitle;
  return {
    key: `${prefix}#${plainId(subtitle.id)}`,
    lang: subtitle.lang,
    ...(label !== undefined && { label }),
    ...(releaseName !== undefined && { releaseName }),
    ...(hashMatch && { hashMatch }),
    ...(linkedLate && { linkedLate }),
    ...(fps !== undefined && { fps }),
    ...(season !== undefined && { season }),
    ...(episode !== undefined && { episode }),
    source,
    url: subtitle.url,
  };
}

/**
 * One addon's answer asked without the hash, and its answer asked again
 * with it. The first answer's files keep their places, so rows and the
 * files read stay as they were; a file the second found by the hash is
 * marked so, and as linked late; files only the second has come after,
 * in its order. Files only the first has stay: OpenSubtitles caps each
 * list, so the second can leave some out.
 */
export function mergeHashAnswer<T extends ListedSubtitle>(
  first: readonly T[],
  again: readonly T[],
): T[] {
  const linked = new Set(again.filter((file) => file.hashMatch).map((file) => file.url));
  const seen = new Set<string>();
  const merged: T[] = [];
  for (const file of first) {
    if (seen.has(file.url)) continue;
    seen.add(file.url);
    merged.push(
      linked.has(file.url) && !file.hashMatch
        ? { ...file, hashMatch: true, linkedLate: true }
        : file,
    );
  }
  for (const file of again) {
    if (seen.has(file.url)) continue;
    seen.add(file.url);
    merged.push(file.hashMatch ? { ...file, linkedLate: true } : file);
  }
  return merged;
}

/** At most this many of SubDL's files in a language are listed. */
const SUBDL_PER_LANGUAGE = 20;
/** At most this many of SubDL's files are read by the files that agree. */
export const SUBDL_AGREEMENT_FILES = 6;

const MATCH_RANK: Readonly<Record<ReleaseMatch, number>> = { exact: 3, group: 2, loose: 1 };
const matchRank = (match: ReleaseMatch | undefined) => (match ? MATCH_RANK[match] : 0);

/**
 * The release SubDL says a file was made for that matches the video best, as
 * its second release name: an exact match over one by group over a loose
 * one, the first of equals; the first release when none matches.
 */
export function bestSubdlRelease(
  file: Pick<SubdlFile, 'label' | 'releases'>,
  video: VideoRelease,
): string | undefined {
  let best: string | undefined;
  let bestRank = 0;
  for (const name of file.releases) {
    if (name === file.label) continue;
    const rank = matchRank(fileReleaseMatch({ label: name }, video));
    if (rank > bestRank) {
      best = name;
      bestRank = rank;
    }
  }
  return best ?? file.releases[0];
}

/**
 * Every file not SubDL's, and `max` of SubDL's, in their order: those in
 * `language` (the one showing) first, then the first of the others.
 */
export function capSubdlFiles<T extends { key: string; lang: string }>(
  files: readonly T[],
  max: number,
  language?: string,
): T[] {
  const ours = files.filter((file) => file.key.startsWith('subdl#'));
  const wanted = language === undefined ? undefined : languageKey(language);
  const kept = new Set<T>();
  for (const file of ours) {
    if (kept.size < max && languageKey(file.lang) === wanted) kept.add(file);
  }
  for (const file of ours) if (kept.size < max) kept.add(file);
  return files.filter((file) => !file.key.startsWith('subdl#') || kept.has(file));
}

/** What SubDL's search says for Diagnostics: counts by language, never a link. */
function subdlTraceOf(state: SubdlSearchState): SubdlTrace {
  const counts = (files: readonly SubdlFile[] | undefined) => {
    if (!files || files.length === 0) return undefined;
    const out: Record<string, number> = {};
    for (const file of files) out[file.lang] = (out[file.lang] ?? 0) + 1;
    return out;
  };
  switch (state.status) {
    case 'asking':
      return { state: 'asking' };
    case 'answered':
      return {
        state: 'answered',
        files: counts(state.files) ?? {},
        ms: state.ms,
        saved: state.saved,
      };
    case 'off': {
      const saved = counts(state.files);
      return { state: 'off', why: state.why, ...(saved && { saved }) };
    }
    case 'failed': {
      const saved = counts(state.files);
      return { state: 'failed', why: state.why, ms: state.ms, ...(saved && { saved }) };
    }
  }
}

/** What SubDL is asked as a play starts: the languages, and the video its files are matched to. */
export interface SubdlAskInput {
  languages: readonly string[];
  release: VideoRelease;
}

const settled = (state: QueryState<unknown>) =>
  state.status !== 'idle' && state.status !== 'loading';

/**
 * Every subtitle on offer for one stream: the stream's own first, then each
 * subtitles addon's in the collection's order. Addons are asked with the
 * stream's hash, size and file name, so they can match the exact release
 * (OpenSubtitles v3 is not sent the file name, which it ignores: see the
 * addon client). A stream whose addon sent no hash has it read from the
 * file, and the addons wait HASH_WAIT_MS for it at most: a hash read after
 * they were asked without it asks again those that match files by it
 * (`HASH_MATCHING_ADDON_IDS`), and their answers are merged into the first
 * (`mergeHashAnswer`). How that went, and the files each language has, go to
 * the play's record for Diagnostics (`subtitle-trace`).
 */
export function subtitleList(
  type: string,
  videoId: string,
  stream: Stream,
  streamAddon: string,
  subdlAsk?: SubdlAskInput,
): {
  get(): SubtitleListState;
  subscribe(listener: () => void): () => void;
  start(): void;
  stop(): void;
  /** Asks SubDL once more, for a language the viewer turned on that it was not asked for. */
  askSubdl(language: string): void;
} {
  const own = stream.subtitles.map((subtitle) => toOption('stream', streamAddon, subtitle));
  const state = createStore<SubtitleListState>({ options: own, pending: 0 });
  let answers: ReadonlyArray<AddonAnswer<Subtitle[]>> = [];
  // Each answer asked again with a hash read late, by the answer asked without it.
  let again = new Map<AddonAnswer<Subtitle[]>, AddonAnswer<Subtitle[]>>();
  let unsubscribe: Array<() => void> = [];
  // Bumped by stop(), so a hash read that ends after it asks no addon.
  let run = 0;
  let hashing = false;
  // When the addons were asked without the hash, as it was still being read (ms from start).
  let askedAt: number | undefined;
  let waitTimer: number | undefined;
  // SubDL's search as the play started, then at most one more for a language turned on.
  let subdlSearches: SubdlSearch[] = [];
  let subdlUnsubscribe: Array<() => void> = [];
  let subdlMoreLanguage: string | undefined;

  function askSubdlFor(languages: readonly string[]) {
    const search = subdl.search(type, videoId, languages);
    subdlSearches.push(search);
    subdlUnsubscribe.push(search.subscribe(refresh));
    search.load();
  }

  /** SubDL's files, after the stream's and the addons': by match to the release, then its order. */
  function addSubdlFiles(options: SubtitleOption[], seen: Set<string>): number {
    let asking = 0;
    const perLanguage = new Map<string, number>();
    const release = subdlAsk?.release ?? {};
    subdlSearches.forEach((search, nth) => {
      const now = search.get();
      if (now.status === 'asking') asking++;
      const files = 'files' in now && now.files ? now.files : [];
      // The languages this search was asked for, to list its files in the one wanted.
      const wanted =
        nth === 0 ? (subdlAsk?.languages ?? []) : subdlMoreLanguage ? [subdlMoreLanguage] : [];
      const ranked = files
        .map((file, index) => {
          const releaseName = bestSubdlRelease(file, release);
          const lang = subdlFileLanguage(file.lang, wanted);
          const listed: ListedSubtitle =
            releaseName === undefined && lang === file.lang
              ? file
              : {
                  ...file,
                  lang,
                  ...(releaseName !== undefined && { releaseName }),
                };
          return {
            listed,
            index,
            rank: matchRank(fileReleaseMatch(listed, release)),
          };
        })
        .sort((a, b) => b.rank - a.rank || a.index - b.index);
      for (const { listed } of ranked) {
        if (seen.has(listed.url)) continue;
        const count = perLanguage.get(listed.lang) ?? 0;
        if (count >= SUBDL_PER_LANGUAGE) continue;
        perLanguage.set(listed.lang, count + 1);
        seen.add(listed.url);
        options.push(toOption('subdl', 'SubDL', listed));
      }
    });
    const [first, more] = subdlSearches;
    if (first) traceSubdl(videoId, subdlTraceOf(first.get()));
    if (more && subdlMoreLanguage !== undefined) {
      const state = more.get();
      traceSubdlMore(videoId, {
        language: subdlMoreLanguage,
        ...(state.status === 'answered' && { files: state.files.length }),
        ...(state.status === 'failed' && { failed: state.why }),
        ...(state.status === 'off' && { off: state.why }),
      });
    }
    return asking;
  }

  function refresh() {
    const options = own.slice();
    const seen = new Set(own.map((option) => option.url));
    let pending = 0;
    let askingAgain = 0;
    // Addons asked again that answered with files, whether they linked any or not.
    let answeredAgain = 0;
    answers.forEach((answer) => {
      const first = answer.query.get();
      if (!settled(first)) pending++;
      const second = again.get(answer)?.query.get();
      if (second && !settled(second)) askingAgain++;
      if (second?.data) answeredAgain++;
      const files: readonly ListedSubtitle[] = second?.data
        ? mergeHashAnswer(first.data ?? [], second.data)
        : (first.data ?? []);
      for (const subtitle of files) {
        if (seen.has(subtitle.url)) continue;
        seen.add(subtitle.url);
        options.push(toOption(answer.addon.manifest.id, answer.addon.manifest.name, subtitle));
      }
    });
    const subdlAsking = addSubdlFiles(options, seen);
    pending += subdlAsking;
    // Asked without the hash while it is still being read: it may yet link files, but only
    // through an addon that matches by it.
    const hashLate =
      hashing &&
      askedAt !== undefined &&
      answers.some((answer) => HASH_MATCHING_ADDON_IDS.has(answer.addon.manifest.id));
    const hashComing = hashLate || askingAgain > 0;
    // Still reading the hash before the addons are asked (SubDL answered meanwhile): they count.
    const notAsked = hashing && askedAt === undefined && answers.length === 0 ? 1 : 0;
    state.set({
      options,
      pending: pending + askingAgain + (hashLate ? 1 : 0) + notAsked,
      ...(hashComing && { hashComing: true }),
      ...(hashLate && { hashReading: true }),
      ...(subdlAsking > 0 && { subdlAsking }),
    });
    traceFiles(
      videoId,
      options.map((option) => option.lang),
    );
    // Once every addon asked again has answered, or failed to: no answer is not "none linked".
    if (again.size > 0 && askingAgain === 0) {
      traceHashLinked(
        videoId,
        answeredAgain > 0 ? options.filter((option) => option.linkedLate).length : null,
      );
    }
  }

  function ask(videoHash: string | undefined, videoSize: number | undefined) {
    const { filename } = stream.behaviorHints;
    mark('sub:asked');
    answers = addonClient.subtitles(type, videoId, { videoHash, videoSize, filename });
    unsubscribe = answers.map((answer) => answer.query.subscribe(refresh));
    answers.forEach((answer) => answer.query.load());
    refresh();
  }

  /** Asks again with a hash read late the addons that match by it and were asked: how many. */
  function askAgain(found: { videoHash: string; videoSize: number }): number {
    const { filename } = stream.behaviorHints;
    const firstOf = new Map<string, AddonAnswer<Subtitle[]>>();
    for (const answer of answers) {
      const id = answer.addon.manifest.id;
      if (HASH_MATCHING_ADDON_IDS.has(id) && !firstOf.has(id)) firstOf.set(id, answer);
    }
    if (firstOf.size === 0) return 0;
    const asked = addonClient
      .subtitles(type, videoId, { ...found, filename })
      .filter((answer) => firstOf.has(answer.addon.manifest.id));
    if (asked.length === 0) return 0;
    mark('sub:asked:again');
    for (const answer of asked) {
      again.set(firstOf.get(answer.addon.manifest.id)!, answer);
      unsubscribe.push(answer.query.subscribe(refresh));
    }
    asked.forEach((answer) => answer.query.load());
    return asked.length;
  }

  return {
    get: state.get,
    subscribe: state.subscribe,
    start() {
      if (answers.length > 0 || hashing) return;
      // SubDL is asked at once, beside the hash and the addons: it never waits for either.
      if (subdlAsk && subdlSearches.length === 0) askSubdlFor(subdlAsk.languages);
      const { videoHash, videoSize } = stream.behaviorHints;
      const source = stream.source;
      if (videoHash || source.kind !== 'url') {
        traceHash(
          videoId,
          videoHash ? { state: 'sent' } : { state: 'skipped', why: 'not a file link' },
        );
        ask(videoHash, videoSize);
        return;
      }
      const current = ++run;
      hashing = true;
      askedAt = undefined;
      // Still looking: the addons have not been asked yet.
      state.set({ ...state.get(), pending: Math.max(1, state.get().pending) });
      // A hash known already for the link, or a link that is not read, answers before this.
      waitTimer = window.setTimeout(() => {
        waitTimer = undefined;
        if (current !== run || answers.length > 0) return;
        askedAt = HASH_WAIT_MS;
        traceHash(videoId, { state: 'reading', askedAtMs: HASH_WAIT_MS });
        ask(undefined, videoSize);
      }, HASH_WAIT_MS);
      void readStreamHash(source.url, videoSize).then((reading) => {
        if (current !== run) return;
        clearTimeout(waitTimer);
        waitTimer = undefined;
        hashing = false;
        const found = reading.found;
        if (askedAt === undefined) {
          traceHash(
            videoId,
            found
              ? {
                  state: 'read',
                  ms: reading.ms,
                  ...(reading.fellBack && { fellBack: reading.fellBack }),
                  ...(reading.by && { by: reading.by }),
                }
              : 'skipped' in reading
                ? { state: 'skipped', why: reading.skipped }
                : {
                    state: 'failed',
                    why: reading.failed,
                    step: reading.step,
                    ms: reading.ms,
                    ...(reading.by && { by: reading.by }),
                  },
          );
          ask(found?.videoHash, found?.videoSize ?? videoSize);
          return;
        }
        // Read after the addons were asked without it.
        if (found) {
          const askedAgain = askAgain(found);
          traceHash(videoId, {
            state: 'read',
            ms: reading.ms,
            ...(reading.fellBack && { fellBack: reading.fellBack }),
            ...(reading.by && { by: reading.by }),
            late: { askedAtMs: askedAt, askedAgain },
          });
          mark('sub:hash:late');
        } else if (!('skipped' in reading)) {
          traceHash(videoId, {
            state: 'failed',
            why: reading.failed,
            step: reading.step,
            ms: reading.ms,
            ...(reading.by && { by: reading.by }),
            askedAtMs: askedAt,
          });
        }
        // The hash no longer counts among those still to answer.
        refresh();
      });
    },
    stop() {
      run++;
      hashing = false;
      askedAt = undefined;
      if (waitTimer !== undefined) clearTimeout(waitTimer);
      waitTimer = undefined;
      unsubscribe.forEach((undo) => undo());
      unsubscribe = [];
      // Starting again asks the query cache, which still holds the answers.
      answers = [];
      again = new Map();
      subdlUnsubscribe.forEach((undo) => undo());
      subdlUnsubscribe = [];
      subdlSearches.forEach((search) => search.stop());
      subdlSearches = [];
      subdlMoreLanguage = undefined;
    },
    askSubdl(language) {
      const [first] = subdlSearches;
      if (!subdlAsk || !first || subdlSearches.length > 1) return;
      const now = first.get();
      // Not asked for a reason another language would not change (no key, a kids profile).
      if (now.status === 'off' && now.why !== 'subtitles off') return;
      const code = subdlCodeFor(language);
      if (code === undefined || first.languages.indexOf(code) !== -1) return;
      if (subdlResting()) return;
      subdlMoreLanguage = languageKey(language);
      askSubdlFor([language]);
      refresh();
    },
  };
}
