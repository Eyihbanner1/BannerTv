import { type AlignConfidence, languageKey } from '@bannertv/core';
import { mark } from '../platform/marks';
import type { HashFailure, HashSkip, HashStep } from './stream-hash';
import type { ReferenceKind } from './subtitle-align';

/*
 * What happened to the subtitles of the last few plays, so a round on the
 * TV can say why each title got the file it did: whether the exact file's
 * hash was read, how many files came in each language, why the version
 * showing was chosen, what the files were lined up against and what that
 * found (files that agree with each other among them), and how long the
 * first line took. Settings >
 * Diagnostics shows it, and its console line carries it. In memory only,
 * never stored, and never a link, an address or a file's name: states,
 * counts, language codes and times.
 */

/**
 * Whether the hash of the exact file playing was read for the subtitles addons. `askedAtMs`:
 * the addons were asked without it after so many milliseconds, as it was still being read.
 */
export type HashOutcome =
  /**
   * Read from the file, in so many milliseconds; `fellBack`, the first later read the link it
   * led to refused, which went through the stream's link again, as every read after it did;
   * `late` when it came after the files were asked for without it.
   */
  | { state: 'read'; ms: number; fellBack?: 'size' | 'end'; late?: HashLate }
  /** The stream's addon sent it with the stream. */
  | { state: 'sent' }
  /** Still being read when the addons were asked without it. */
  | { state: 'reading'; askedAtMs: number }
  /** Why it failed, and at which read: the start, the size or the end. */
  | { state: 'failed'; why: HashFailure; step: HashStep; ms: number; askedAtMs?: number }
  /** Not tried: a playlist, a link needing request headers, or no file link at all (a torrent). */
  | { state: 'skipped'; why: HashSkip };

/**
 * A hash read after the files were asked for without it: when they were, how many addons that
 * match files by the hash were asked again with it, and how many files their answers linked to
 * the video, once they answered; `failed` when none of them answered.
 */
export interface HashLate {
  askedAtMs: number;
  askedAgain: number;
  linked?: number;
  failed?: true;
}

/**
 * Why the version showing was chosen: picked by hand (from the list, or kept
 * for the release); the stream's own track; found by the video's hash
 * (linked to it); its name the same release as the video's, with the group
 * confirming it or loosely; lined up against a reference for sure (synced);
 * the best fit of the files read; the list's order, nothing telling the
 * files apart; shown instead of the file chosen first, as files that agree
 * with each other put it ahead; or none showing.
 */
export type PickReason =
  | 'by hand'
  | 'own track'
  | 'linked to your video'
  | 'same release name'
  | 'synced to your video'
  | 'same release name, no group'
  | 'best fit'
  | 'list order'
  | 'agrees with other files'
  | 'off';

/** What lining one file up against the reference found, for Diagnostics. */
export interface AlignTrace {
  /** The file's language, as a key ("en", "pt-br"). */
  language: string;
  reference: ReferenceKind;
  confidence: AlignConfidence;
  /** Seconds the move puts its lines later, and the file's seconds for one of the video's. */
  offset: number;
  rate: number;
  /** Milliseconds of work it took. */
  ms: number;
}

/** Why files that agree changed nothing (`AgreementWhy` in core, by kind). */
export type AgreementAbstain =
  | { kind: 'under'; best: number }
  | { kind: 'close'; best: number; second: number }
  | { kind: 'unlinked'; score: number }
  | { kind: 'apart'; score: number; offset: number; rate: number }
  | { kind: 'rate' }
  | { kind: 'edition'; edition: string }
  | { kind: 'wider'; best: number; second: number }
  | { kind: 'unmatched'; best: number; second: number }
  | { kind: 'gave up'; after: 'time' | 'files' | 'aligned' };

/**
 * What the files that agree with each other found, for Diagnostics: counts,
 * scores and times only. `file` is the place of the file shown instead among
 * its language's files, in the list's order; `kept` says a drift fix the
 * player made is on, so the move was not made.
 */
export type AgreementTrace =
  | { state: 'reading'; read: number; aligned: number }
  | {
      state: 'kept' | 'moved' | 'shifted' | 'switched';
      best: number;
      second: number;
      service?: string;
      read: number;
      aligned: number;
      ms: number;
      offset?: number;
      file?: number;
      kept?: 'drift';
    }
  | { state: 'none'; why: AgreementAbstain; read: number; aligned: number; ms: number }
  | { state: 'not tried'; why: 'recording' | 'no source' };

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
  /** What the files were lined up against, last; null once there was nothing to. */
  reference?: ReferenceKind | null;
  /** Each file lined up, by its place in the order lined up, its last run. Never its link. */
  aligned?: Record<number, AlignTrace>;
  /** What the files that agree found, where they were needed. */
  agreement?: AgreementTrace;
}

interface Running extends SubtitleTrace {
  startedAt: number;
}

/**
 * Plays kept, newest first: Diagnostics' console line carries them all, its screen the newest.
 * Enough that a detour (another title, a sports stream) leaves the play under study on it.
 */
const KEPT = 5;
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

/**
 * How many files the addons asked again with a hash read late linked to the video; null when
 * none of them answered.
 */
export function traceHashLinked(videoId: string, linked: number | null): void {
  const trace = current(videoId);
  if (!trace || trace.hash?.state !== 'read' || !trace.hash.late) return;
  const { askedAtMs, askedAgain } = trace.hash.late;
  trace.hash = {
    ...trace.hash,
    late: { askedAtMs, askedAgain, ...(linked === null ? { failed: true } : { linked }) },
  };
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

/** What the play's files are lined up against now: the stream's track, a file, or nothing. */
export function traceReference(videoId: string, reference: ReferenceKind | null): void {
  const trace = current(videoId);
  if (!trace) return;
  trace.reference = reference;
}

/** What lining a file up found, by the file's place in the order lined up. */
export function traceAlignment(videoId: string, file: number, outcome: AlignTrace): void {
  const trace = current(videoId);
  if (!trace) return;
  const language = languageKey(outcome.language) || outcome.language;
  trace.aligned = { ...trace.aligned, [file]: { ...outcome, language } };
  mark(`sub:aligned:${outcome.confidence}`);
}

/** What the files that agree found so far, or decided. */
export function traceAgreement(videoId: string, outcome: AgreementTrace): void {
  const trace = current(videoId);
  if (!trace) return;
  trace.agreement = outcome;
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
    if (trace.hash) copy.hash = { ...trace.hash };
    if (trace.aligned) copy.aligned = { ...trace.aligned };
    if (trace.agreement) copy.agreement = { ...trace.agreement };
    delete (copy as Partial<Running>).startedAt;
    return copy;
  });
}

/** For tests: forgets every play. */
export function forgetSubtitleTraces(): void {
  traces.length = 0;
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

const STEP_WORDS: Readonly<Record<HashStep, string>> = {
  start: 'start read',
  size: 'size read',
  end: 'end read',
};

/** The addons were asked without the hash after so long. */
const askedWithout = (ms: number) => `files asked for without it after ${seconds(ms)}`;

/** What a hash read late brought: the addons asked again with it, and the files they linked. */
function lateText(late: HashLate): string {
  if (late.askedAgain === 0) return ', after the files were asked for';
  if (late.failed) return ', asked again: no answer';
  if (late.linked === undefined) return ', asked again';
  const linked =
    late.linked === 0 ? 'none' : `${late.linked} ${late.linked === 1 ? 'file' : 'files'}`;
  return `, asked again: ${linked} linked`;
}

function hashText(hash: HashOutcome | undefined): string {
  if (!hash) return 'hash: not asked yet';
  switch (hash.state) {
    case 'read': {
      const back = hash.fellBack
        ? `, ${hash.fellBack === 'size' ? 'the size and end' : 'the end'} through the stream’s link again`
        : '';
      return `hash read in ${seconds(hash.ms)}${back}${hash.late ? lateText(hash.late) : ''}`;
    }
    case 'sent':
      return 'hash sent by the addon';
    case 'reading':
      return `hash still being read; ${askedWithout(hash.askedAtMs)}`;
    case 'failed': {
      const late = hash.askedAtMs === undefined ? '' : `; ${askedWithout(hash.askedAtMs)}`;
      return `hash failed after ${seconds(hash.ms)} (${hash.why}, ${STEP_WORDS[hash.step]})${late}`;
    }
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

const REFERENCE_WORDS: Readonly<Record<ReferenceKind, string>> = {
  track: 'the stream’s track',
  linked: 'a file linked by hash',
  release: 'a file named for the release',
  agreed: 'files that agree',
};

/** "+2.3 s", "−0.4 s": a true minus sign. */
const signed = (seconds: number) => `${seconds < 0 ? '−' : '+'}${Math.abs(seconds).toFixed(1)} s`;

/** What the files were lined up against, and each file's last run, in the order lined up. */
function alignText(trace: SubtitleTrace): string | undefined {
  const runs = Object.keys(trace.aligned ?? {})
    .map(Number)
    .sort((a, b) => a - b)
    .map((file) => {
      const run = trace.aligned![file]!;
      const rate = run.rate === 1 ? '' : ` ×${run.rate.toFixed(4)}`;
      const move = run.confidence === 'sure' ? ` ${signed(run.offset)}${rate}` : '';
      return `${run.language || '?'} ${run.confidence}${move} (${Math.round(run.ms)} ms)`;
    });
  if (trace.reference === undefined && runs.length === 0) return undefined;
  const against = trace.reference ? REFERENCE_WORDS[trace.reference] : 'nothing';
  return runs.length > 0
    ? `lined up against ${against}: ${runs.join(', ')}`
    : `lined up against ${against}`;
}

function abstainText(why: AgreementAbstain): string {
  switch (why.kind) {
    case 'under':
      return `best ${why.best} is under 3`;
    case 'close':
      return `${why.best} vs ${why.second} is too close`;
    case 'unlinked':
      return `files scoring ${why.score} aren’t lined up with the rest`;
    case 'apart':
      return why.rate !== 1
        ? `files scoring ${why.score} are at another rate`
        : `files scoring ${why.score} are ${Math.abs(why.offset).toFixed(1)} s apart`;
    case 'rate':
      return 'this file is at another rate';
    case 'edition':
      return `the video’s edition (${why.edition}) isn’t named by them`;
    case 'wider':
      return `a wider read disagrees (${why.best} vs ${why.second})`;
    case 'unmatched':
      return `this file lines up with none of them (${why.best} vs ${why.second})`;
    case 'gave up':
      return `gave up after ${
        why.after === 'time' ? '120 s' : why.after === 'files' ? '100 files' : '1000 lined up'
      }`;
  }
}

/** What the files that agree found: how sure, how much they read and lined up, and what it did. */
function agreementText(agreement: AgreementTrace | undefined): string | undefined {
  if (!agreement) return undefined;
  const said = 'files that agree';
  switch (agreement.state) {
    case 'not tried':
      return `${said}: not tried (${
        agreement.why === 'recording' ? 'a cinema recording' : 'the video names no source'
      })`;
    case 'reading':
      return `${said}: reading, ${agreement.read} read, ${agreement.aligned} lined up`;
    case 'none':
      return `${said}: none, ${abstainText(agreement.why)}, ${agreement.read} read, ${
        agreement.aligned
      } lined up in ${seconds(agreement.ms)}`;
    default: {
      const service = agreement.service ? ` (${agreement.service})` : '';
      const done =
        agreement.kept === 'drift'
          ? 'kept: a drift fix is on'
          : agreement.state === 'kept'
            ? 'already in step'
            : agreement.state === 'switched'
              ? `switched to file ${agreement.file ?? '?'}`
              : `moved ${signed(agreement.offset ?? 0)}${
                  agreement.state === 'shifted' ? ' by the group’s timing' : ''
                }`;
      return `${said}: ${agreement.best} vs ${agreement.second}${service}, ${agreement.read} read, ${
        agreement.aligned
      } lined up in ${seconds(agreement.ms)}; ${done}`;
    }
  }
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
      agreementText(trace.agreement),
      alignText(trace),
      trace.firstLineMs === undefined
        ? 'no line yet'
        : `first line after ${seconds(trace.firstLineMs)}`,
    ]
      .filter((part): part is string => part !== undefined)
      .join(' · '),
  ]);
}
