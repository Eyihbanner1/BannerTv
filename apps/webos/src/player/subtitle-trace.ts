import { languageKey } from '@bannertv/core';
import { mark } from '../platform/marks';
import type { HashFailure, HashSkip } from './stream-hash';

/*
 * What happened to the subtitles of the last few plays, so a round on the
 * TV can say why each title got the file it did: whether the exact file's
 * hash was read, how many files came in each language, why the version
 * showing was chosen, and how long the first line took. Settings >
 * Diagnostics shows it, and its console line carries it. In memory only,
 * never stored, and never a link, an address or a file's name: states,
 * counts, language codes and times.
 */

/** Whether the hash of the exact file playing was read for the subtitles addons. */
export type HashOutcome =
  /** Read from the file, in so many milliseconds. */
  | { state: 'read'; ms: number }
  /** The stream's addon sent it with the stream. */
  | { state: 'sent' }
  | { state: 'failed'; why: HashFailure; ms: number }
  /** Not tried: a playlist, a link needing request headers, or no file link at all (a torrent). */
  | { state: 'skipped'; why: HashSkip };

/**
 * Why the version showing was chosen: picked by hand (from the list, or kept
 * for the release); the stream's own track; found by the video's hash
 * (linked to it); its name the same release as the video's, with the group
 * confirming it or loosely; the best fit of the files read; the list's
 * order, nothing telling the files apart; or none showing.
 */
export type PickReason =
  | 'by hand'
  | 'own track'
  | 'linked to your video'
  | 'same release name'
  | 'same release name, no group'
  | 'best fit'
  | 'list order'
  | 'off';

/** One play's subtitles, as Diagnostics shows them. */
export interface SubtitleTrace {
  /** The video's id ("tt3581920:1:1"): never a link. */
  videoId: string;
  hash?: HashOutcome;
  /** Files offered in each language, by language code, as the addons answered. */
  files: Record<string, number>;
  /** Why the version showing was chosen, and whether the viewer turned its language on. */
  reason?: PickReason;
  languagePicked?: boolean;
  /** The language of the version showing. */
  language?: string;
  /** Milliseconds from the player opening to the first subtitle line on screen. */
  firstLineMs?: number;
}

interface Running extends SubtitleTrace {
  startedAt: number;
}

/** Plays kept, newest first: as many as Diagnostics' column shows, the longest rows and all. */
const KEPT = 3;
const traces: Running[] = [];

/** An addon's own id that is a link is never kept: only that it was one. */
const LINK = /:\/\/|^www\./i;

/** The id kept for a video: its own, unless that is a link. */
function idOf(videoId: string): string {
  return LINK.test(videoId) ? 'a link (not shown)' : videoId;
}

/** Starts the record of a play, as the player opens on a video. */
export function startSubtitleTrace(videoId: string, now = Date.now()): void {
  // One that saw nothing (a player closed at once, or opened twice by a check) is not kept.
  const last = traces[0];
  if (last && !last.hash && Object.keys(last.files).length === 0 && last.reason === undefined) {
    traces.shift();
  }
  traces.unshift({ videoId: idOf(videoId), startedAt: now, files: {} });
  if (traces.length > KEPT) traces.length = KEPT;
}

/** The play now, if it is for this video. */
function current(videoId: string): Running | undefined {
  const trace = traces[0];
  return trace && trace.videoId === idOf(videoId) ? trace : undefined;
}

/** How reading the hash went, for the stream asked for last. */
export function traceHash(videoId: string, outcome: HashOutcome): void {
  const trace = current(videoId);
  if (!trace) return;
  trace.hash = outcome;
  mark(`sub:hash:${outcome.state}`);
}

/** The files on offer now, counted by language. */
export function traceFiles(videoId: string, languages: readonly string[]): void {
  const trace = current(videoId);
  if (!trace) return;
  const files: Record<string, number> = {};
  for (const lang of languages) {
    const key = languageKey(lang) || lang;
    files[key] = (files[key] ?? 0) + 1;
  }
  trace.files = files;
}

/** Why the version showing now was chosen, and its language. */
export function traceReason(
  videoId: string,
  reason: PickReason,
  language: string | null,
  languagePicked = false,
): void {
  const trace = current(videoId);
  if (!trace) return;
  trace.reason = reason;
  trace.languagePicked = languagePicked;
  if (language) trace.language = languageKey(language) || language;
  else delete trace.language;
}

/** The first subtitle line of the play now went on screen. */
export function traceFirstLine(now = Date.now()): void {
  const trace = traces[0];
  if (!trace || trace.firstLineMs !== undefined) return;
  trace.firstLineMs = Math.max(0, now - trace.startedAt);
  mark('sub:firstLine');
}

/** The last few plays, newest first. */
export function recentSubtitleTraces(): SubtitleTrace[] {
  return traces.map((trace) => {
    const copy: SubtitleTrace = { ...trace, files: { ...trace.files } };
    delete (copy as Partial<Running>).startedAt;
    return copy;
  });
}

/** For tests: forgets every play. */
export function forgetSubtitleTraces(): void {
  traces.length = 0;
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

function hashText(hash: HashOutcome | undefined): string {
  if (!hash) return 'hash: not asked yet';
  switch (hash.state) {
    case 'read':
      return `hash read in ${seconds(hash.ms)}`;
    case 'sent':
      return 'hash sent by the addon';
    case 'failed':
      return `hash failed after ${seconds(hash.ms)} (${hash.why})`;
    case 'skipped':
      return `hash not tried (${hash.why})`;
  }
}

/** The files: the language showing first, then the most, then how many in all. */
function filesText(trace: SubtitleTrace): string {
  const entries = Object.keys(trace.files).map((lang) => [lang, trace.files[lang]!] as const);
  if (entries.length === 0) return 'no files';
  const total = entries.reduce((sum, [, count]) => sum + count, 0);
  const shown = entries
    .slice()
    .sort(
      (a, b) =>
        Number(b[0] === trace.language) - Number(a[0] === trace.language) ||
        b[1] - a[1] ||
        (a[0] < b[0] ? -1 : 1),
    )
    .slice(0, 3)
    .map(([lang, count]) => `${lang} ${count}`);
  const more = entries.length - shown.length;
  const others = more > 0 ? `, +${more} ${more === 1 ? 'language' : 'languages'}` : '';
  return `files ${shown.join(', ')}${others} (${total} in all)`;
}

function reasonText(trace: SubtitleTrace): string {
  if (!trace.reason) return 'none chosen yet';
  const said = trace.reason === 'off' ? 'off' : `${trace.language ?? '?'}, ${trace.reason}`;
  return trace.languagePicked ? `${said}, language picked` : said;
}

/** One row per play for Diagnostics, newest first: the video's id, then what happened. */
export function subtitleTraceRows(
  list: readonly SubtitleTrace[] = recentSubtitleTraces(),
): Array<readonly [string, string]> {
  if (list.length === 0) return [['Plays', 'none yet: play a video first']];
  return list.map((trace) => [
    trace.videoId,
    [
      hashText(trace.hash),
      filesText(trace),
      reasonText(trace),
      trace.firstLineMs === undefined
        ? 'no line yet'
        : `first line after ${seconds(trace.firstLineMs)}`,
    ].join(' · '),
  ]);
}
