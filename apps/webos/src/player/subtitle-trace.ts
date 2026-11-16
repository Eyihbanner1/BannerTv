import {
  type AlignConfidence,
  languageKey,
  type SubdlFailure,
  type SubdlOff,
} from '@bannertv/core';
import { mark } from '../platform/marks';
import type { FileTextCost, FileTextReport, FileTextSkip } from './file-subtitles';
import type { HashFailure, HashSkip, HashStep } from './stream-hash';
import type { ReferenceKind } from './subtitle-align';

/*
 * What happened to the subtitles of the last few plays, so a round on the
 * TV can say why each title got the file it did: whether the exact file's
 * hash was read, what the video file's own subtitles held and what reading
 * them cost, how many files came in each language, why the version
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
   * `late` when it came after the files were asked for without it; `by` 'app' when the Android
   * TV app read it.
   */
  | { state: 'read'; ms: number; fellBack?: 'size' | 'end'; late?: HashLate; by?: 'app' }
  /** The stream's addon sent it with the stream. */
  | { state: 'sent' }
  /** Still being read when the addons were asked without it. */
  | { state: 'reading'; askedAtMs: number }
  /** Why it failed, and at which read: the start, the size or the end; `by` as for 'read'. */
  | {
      state: 'failed';
      why: HashFailure;
      step: HashStep;
      ms: number;
      askedAtMs?: number;
      by?: 'app';
    }
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
  | { kind: 'unread'; files: number }
  | { kind: 'unmatched'; best: number; second: number }
  | { kind: 'gave up'; after: 'time' | 'files' | 'aligned' };

/**
 * Files read and lined up, and files that could not be downloaded (when any);
 * `ms` the work of lining them up, pauses and downloads left out.
 */
interface AgreementCounts {
  read: number;
  aligned: number;
  failed?: number;
}

/**
 * What the files that agree with each other found, for Diagnostics: counts,
 * scores and times only. `reading` as they go; `waiting` once decided, until
 * every addon has answered and no hash may still link a file, when what was
 * decided is used and said; `not needed` when something better came first, or
 * the viewer chose. `file` is the place of the file shown instead among its
 * language's files, in the list's order; `kept` says a drift fix the player
 * made is on, so the move was not made.
 */
export type AgreementTrace =
  | ({ state: 'reading' | 'not needed' } & AgreementCounts)
  | ({ state: 'waiting'; ms: number } & AgreementCounts)
  | ({
      state: 'kept' | 'moved' | 'shifted' | 'switched';
      best: number;
      second: number;
      service?: string;
      ms: number;
      offset?: number;
      file?: number;
      kept?: 'drift';
    } & AgreementCounts)
  | ({ state: 'none'; why: AgreementAbstain; ms: number } & AgreementCounts)
  | { state: 'not tried'; why: 'recording' | 'no source' };

/**
 * How reading the video file's own subtitles went (`withFileSubtitles`): the
 * engine's report, whose cost is its tally kept up to date as lines are read;
 * and the language of its track the files were lined up against, if one was.
 */
export interface FileTrace {
  report: FileTextReport;
  reference?: string;
}

/**
 * How SubDL's search went for the play: not asked and why, asking, answered
 * (files by language, how long, whether from a saved answer), or failed and
 * why. `saved`: the files of an older saved answer used meanwhile. Counts by
 * language only: never a key, a link or a file's name.
 */
export type SubdlTrace =
  | { state: 'off'; why: SubdlOff; saved?: Record<string, number> }
  | { state: 'asking' }
  | { state: 'answered'; files: Record<string, number>; ms: number; saved: boolean }
  | { state: 'failed'; why: SubdlFailure; ms: number; saved?: Record<string, number> };

/** SubDL asked again for a language the viewer turned on: its files, or why there are none. */
export interface SubdlMoreTrace {
  language: string;
  files?: number;
  failed?: SubdlFailure;
  off?: SubdlOff;
}

/** One play's subtitles, as Diagnostics shows them. */
export interface SubtitleTrace {
  /** The video's id ("tt3581920:1:1"): never a link. */
  videoId: string;
  hash?: HashOutcome;
  /** The video file's own subtitles, where they were looked for. */
  file?: FileTrace;
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
  /**
   * The timing the viewer set by matching a line, last: one press, or two that fixed a drift,
   * found none ('none') or kept no steady pace; `undone` once Undo put it back.
   */
  matched?: {
    presses: 1 | 2;
    offset: number;
    drift?: 'ahead' | 'behind' | 'none';
    unsteady?: true;
    undone?: true;
  };
  /** Last episode's timing, offered here: shown, used or declined. */
  offered?: 'shown' | 'used' | 'declined';
  /** SubDL's search, where SubDL could be asked. */
  subdl?: SubdlTrace;
  /** SubDL asked again, for a language the viewer turned on. */
  subdlMore?: SubdlMoreTrace;
}

interface Running extends SubtitleTrace {
  startedAt: number;
  /** The file's own track the files are lined up against, kept apart as it can come first. */
  fileReference?: string;
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

/** How reading the video file's own subtitles goes now; null where they are not looked for. */
export function traceFileText(videoId: string, report: FileTextReport | null): void {
  const trace = current(videoId);
  if (!trace) return;
  if (report) trace.file = { report };
  else delete trace.file;
}

/**
 * The language of the video file's own track the files are lined up against
 * now (a track its index timed), or null for none.
 */
export function traceFileReference(videoId: string, language: string | null): void {
  const trace = current(videoId);
  if (!trace) return;
  if (language) trace.fileReference = languageKey(language) || language;
  else delete trace.fileReference;
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

/** Counts by language key, for SubDL's traces. */
function keyed(counts: Record<string, number> | undefined): Record<string, number> | undefined {
  if (!counts) return undefined;
  const out: Record<string, number> = {};
  for (const lang of Object.keys(counts)) {
    const key = languageKey(lang) || lang;
    out[key] = (out[key] ?? 0) + counts[lang]!;
  }
  return out;
}

/** How SubDL's search for the play goes now. */
export function traceSubdl(videoId: string, outcome: SubdlTrace): void {
  const trace = current(videoId);
  if (!trace) return;
  const before = trace.subdl;
  if (outcome.state === 'answered') {
    trace.subdl = { ...outcome, files: keyed(outcome.files)! };
  } else if (outcome.state === 'off' || outcome.state === 'failed') {
    const saved = keyed(outcome.saved);
    const copy = { ...outcome };
    delete copy.saved;
    trace.subdl = saved ? { ...copy, saved } : copy;
  } else {
    trace.subdl = { state: 'asking' };
  }
  if (before?.state !== trace.subdl.state) mark(`sub:subdl:${trace.subdl.state}`);
}

/** How SubDL's second search goes now, for a language the viewer turned on. */
export function traceSubdlMore(videoId: string, more: SubdlMoreTrace): void {
  const trace = current(videoId);
  if (!trace) return;
  trace.subdlMore = { ...more, language: languageKey(more.language) || more.language };
}

/** The viewer set the timing by matching a line, or undid that. */
export function traceMatch(videoId: string, matched: NonNullable<SubtitleTrace['matched']>): void {
  const trace = current(videoId);
  if (!trace) return;
  trace.matched = { ...matched };
}

/** What became of last episode's timing, offered on this one. */
export function traceOffer(videoId: string, state: 'shown' | 'used' | 'declined'): void {
  const trace = current(videoId);
  if (!trace) return;
  trace.offered = state;
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
    // The report's cost stays the engine's own tally, so it shows reads up to now.
    if (trace.file) {
      copy.file = { report: trace.file.report };
      if (trace.fileReference) copy.file.reference = trace.fileReference;
    }
    delete (copy as Partial<Running>).fileReference;
    if (trace.aligned) copy.aligned = { ...trace.aligned };
    if (trace.agreement) copy.agreement = { ...trace.agreement };
    if (trace.matched) copy.matched = { ...trace.matched };
    if (trace.subdl) copy.subdl = { ...trace.subdl };
    if (trace.subdlMore) copy.subdlMore = { ...trace.subdlMore };
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
const askedWithout = (ms: number) => `asked without it at ${seconds(ms)}`;

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
      const read = hash.by === 'app' ? 'hash read by the app in' : 'hash read in';
      return `${read} ${seconds(hash.ms)}${back}${hash.late ? lateText(hash.late) : ''}`;
    }
    case 'sent':
      return 'hash sent by the addon';
    case 'reading':
      return `hash still being read, ${askedWithout(hash.askedAtMs)}`;
    case 'failed': {
      const late = hash.askedAtMs === undefined ? '' : `, ${askedWithout(hash.askedAtMs)}`;
      const by = hash.by === 'app' ? ', read by the app' : '';
      return `hash failed after ${seconds(hash.ms)} (${hash.why}, ${STEP_WORDS[hash.step]}${by})${late}`;
    }
    case 'skipped':
      return `hash not tried (${hash.why})`;
  }
}

const FILE_WORDS: Readonly<Record<FileTextSkip, string>> = {
  named: 'its name says it’s another kind of video file',
  'not-matroska': 'not a kind of video file BannerTV reads them from',
  'no-index': 'the file’s subtitles have no index',
  live: 'a recording with no index',
  'no-subtitles': 'no subtitles in the file',
  corrupt: 'the file couldn’t be read',
  'too-large': 'its index is too large',
  'no-range': 'the server sends only the whole file',
  blocked: 'couldn’t read the file here',
  refused: 'the server refused the reads',
  'one-use': 'the link allows one read',
  busy: 'the server stayed too busy',
  unanswered: 'the server didn’t answer',
  'timed-out': 'gave up after 20 s',
};

/** "1 request", "4 requests". */
const counted = (count: number, one: string) => `${count} ${count === 1 ? one : `${one}s`}`;

const kilobytes = (bytes: number) => `${Math.round(bytes / 1024)} KB`;

/** Language codes, each once: four at most, then how many more. */
function languagesText(languages: readonly string[]): string {
  const keys: string[] = [];
  for (const lang of languages) {
    const key = languageKey(lang) || lang;
    if (keys.indexOf(key) < 0) keys.push(key);
  }
  if (keys.length === 0) return '';
  const more = keys.length > 4 ? `, +${keys.length - 4}` : '';
  return ` (${keys.slice(0, 4).join(', ')}${more})`;
}

/** Walks through the stream's link past the first: ", through the stream’s link 2 times". */
const walksText = (cost: FileTextCost) =>
  cost.walks > 1 ? `, through the stream’s link ${cost.walks} times` : '';

/**
 * What the video file's own subtitles held and what reading them cost: its text tracks and
 * their languages, those this TV can't read, its picture tracks; the head and the index's
 * reads; the lines read for a track shown; what the files were lined up against, or why the
 * tracks were dropped while the video played.
 */
function fileText(file: FileTrace | undefined): string | undefined {
  if (!file) return undefined;
  const said = 'the video file’s own subtitles';
  const { report } = file;
  switch (report.state) {
    case 'waiting':
      return `${said}: not read yet`;
    case 'reading':
      return `${said}: still being read`;
    case 'none': {
      const { cost } = report;
      const reads = cost.requests > 0 ? `, ${counted(cost.requests, 'request')}` : '';
      return `${said}: none (${FILE_WORDS[report.why]}${reads}${walksText(cost)})`;
    }
    case 'read': {
      const { cost } = report;
      const held = [`${counted(report.text.length, 'text track')}${languagesText(report.text)}`];
      if (report.unreadable > 0) {
        held.push(`${counted(report.unreadable, 'text track')} this TV can’t read`);
      }
      if (report.picture > 0) held.push(counted(report.picture, 'picture track'));
      const parts = [
        held.join(', '),
        `read in ${seconds(report.ms)}, ${counted(cost.requests, 'request')}, ${kilobytes(
          cost.bytes,
        )}${walksText(cost)}`,
      ];
      if (cost.lines > 0 || cost.lineRequests > 0 || cost.failedReads > 0) {
        const failed =
          cost.failedReads > 0
            ? `, ${cost.failedReads} ${cost.failedReads === 1 ? 'read' : 'reads'} failed`
            : '';
        parts.push(
          `${counted(cost.lines, 'line')} in ${counted(cost.lineRequests, 'request')}, ${kilobytes(
            cost.lineBytes,
          )}${failed}`,
        );
      }
      if (report.dropped) parts.push(`dropped while playing (${FILE_WORDS[report.dropped]})`);
      // Its timing, from the index, still lines files up once the tracks are dropped.
      if (file.reference) parts.push(`files lined up against ${file.reference}`);
      return `${said}: ${parts.join('; ')}`;
    }
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

/** Counts by language, the one showing first, then the most: three at most, then how many more. */
function countsByLanguage(counts: Record<string, number>, showing: string | undefined): string {
  const entries = Object.keys(counts).map((lang) => [lang, counts[lang]!] as const);
  const shown = entries
    .slice()
    .sort(
      (a, b) =>
        Number(b[0] === showing) - Number(a[0] === showing) ||
        b[1] - a[1] ||
        (a[0] < b[0] ? -1 : 1),
    )
    .slice(0, 3)
    .map(([lang, count]) => `${lang} ${count}`);
  const more = entries.length - shown.length;
  const others = more > 0 ? `, +${more} ${more === 1 ? 'language' : 'languages'}` : '';
  return `${shown.join(', ')}${others}`;
}

const SUBDL_OFF_WORDS: Readonly<Record<SubdlOff, string>> = {
  'no key': 'no key',
  kids: 'not on kids profiles',
  'key refused': 'key not accepted',
  'not imdb': 'not asked (not an IMDb title)',
  special: 'not asked (special episode)',
  'subtitles off': 'not asked (subtitles off)',
  resting: 'resting (too many requests)',
  'daily limit': 'daily limit reached',
};

const SUBDL_FAILED_WORDS: Readonly<Record<SubdlFailure, string>> = {
  timeout: 'no answer in 8 s',
  network: 'couldn’t be reached',
  busy: 'too many requests, resting',
  limit: 'daily limit reached',
  refused: 'key not accepted',
  challenge: 'blocked for now, try later',
  server: 'server error',
  invalid: 'unreadable answer',
};

const hasCounts = (counts: Record<string, number> | undefined): counts is Record<string, number> =>
  !!counts && Object.keys(counts).length > 0;

/** SubDL's search for the play, as words. */
function subdlText(trace: SubtitleTrace): string | undefined {
  const subdl = trace.subdl;
  if (!subdl) return undefined;
  const saved = (counts: Record<string, number> | undefined) =>
    hasCounts(counts) ? `, saved answer ${countsByLanguage(counts, trace.language)}` : '';
  switch (subdl.state) {
    case 'asking':
      return 'SubDL: asking';
    case 'off':
      return `SubDL: ${SUBDL_OFF_WORDS[subdl.why]}${saved(subdl.saved)}`;
    case 'failed':
      return `SubDL: ${SUBDL_FAILED_WORDS[subdl.why]}${saved(subdl.saved)}`;
    case 'answered': {
      const when = subdl.saved ? ' (saved answer)' : ` in ${seconds(subdl.ms)}`;
      return hasCounts(subdl.files)
        ? `SubDL ${countsByLanguage(subdl.files, trace.language)}${when}`
        : `SubDL: no files${when}`;
    }
  }
}

/** SubDL asked again for a language the viewer turned on. */
function subdlMoreText(more: SubdlMoreTrace | undefined): string | undefined {
  if (!more) return undefined;
  const said = `SubDL asked again for ${more.language}`;
  if (more.failed) return `${said}: ${SUBDL_FAILED_WORDS[more.failed]}`;
  if (more.off) return `${said}: ${SUBDL_OFF_WORDS[more.off]}`;
  if (more.files === undefined) return `${said}: asking`;
  return `${said}: ${more.files === 0 ? 'no files' : counted(more.files, 'file')}`;
}

const REFERENCE_WORDS: Readonly<Record<ReferenceKind, string>> = {
  track: 'the stream’s track',
  linked: 'a file linked by hash',
  release: 'a file named for the release',
  agreed: 'files that agree',
};

/** "+2.3 s", "−0.4 s": a true minus sign. */
const signed = (seconds: number) => `${seconds < 0 ? '−' : '+'}${Math.abs(seconds).toFixed(1)} s`;

/**
 * What the files were lined up against, and each file's last run, in the order lined up: the
 * work it took for a file lined up alone (the TV's cost of one), not for each of several.
 */
function alignText(trace: SubtitleTrace): string | undefined {
  const files = Object.keys(trace.aligned ?? {})
    .map(Number)
    .sort((a, b) => a - b);
  const runs = files.map((file) => {
    const run = trace.aligned![file]!;
    const rate = run.rate === 1 ? '' : ` ×${run.rate.toFixed(4)}`;
    const move = run.confidence === 'sure' ? ` ${signed(run.offset)}${rate}` : '';
    const work = files.length === 1 ? ` (${Math.round(run.ms)} ms)` : '';
    return `${run.language || '?'} ${run.confidence}${move}${work}`;
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
    case 'unread':
      return 'not all could be downloaded';
    case 'unmatched':
      return `this file lines up with none of them (${why.best} vs ${why.second})`;
    case 'gave up':
      return `gave up after ${
        why.after === 'time' ? '120 s' : why.after === 'files' ? '100 files' : '1000 lined up'
      }`;
  }
}

/** Files read, those that could not be downloaded, and those lined up: "12 read, 1 failed, 43 lined up". */
function countsText(counts: AgreementCounts): string {
  const failed = counts.failed ? `, ${counts.failed} failed` : '';
  return `${counts.read} read${failed}, ${counts.aligned} lined up`;
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
      return `${said}: reading, ${countsText(agreement)}`;
    case 'not needed':
      return `${said}: not needed, ${countsText(agreement)}`;
    case 'waiting':
      return `${said}: waiting for more files, ${countsText(agreement)} in ${seconds(agreement.ms)}`;
    case 'none':
      return `${said}: none, ${abstainText(agreement.why)}, ${countsText(agreement)} in ${seconds(
        agreement.ms,
      )}`;
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
      return `${said}: ${agreement.best} vs ${agreement.second}${service}, ${countsText(
        agreement,
      )} in ${seconds(agreement.ms)}; ${done}`;
    }
  }
}

/** How the viewer matched a line: one press, two, or two with no steady pace. */
function matchText(matched: SubtitleTrace['matched']): string | undefined {
  if (!matched) return undefined;
  const amount = signed(matched.offset);
  const said = matched.unsteady
    ? `two lines matched kept no steady pace: the newer one set ${amount}`
    : matched.presses === 1
      ? `timing set by matching a line: ${amount}`
      : `timing set by matching two lines: ${amount}${
          matched.drift === 'none' ? ', no drift' : matched.drift ? ', drift fixed' : ''
        }`;
  return matched.undone ? `${said} (undone)` : said;
}

const OFFER_WORDS: Readonly<Record<NonNullable<SubtitleTrace['offered']>, string>> = {
  shown: 'last episode’s timing offered',
  used: 'last episode’s timing offered: used',
  declined: 'last episode’s timing offered: declined',
};

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
      fileText(trace.file),
      filesText(trace),
      subdlText(trace),
      subdlMoreText(trace.subdlMore),
      reasonText(trace),
      agreementText(trace.agreement),
      alignText(trace),
      matchText(trace.matched),
      trace.offered ? OFFER_WORDS[trace.offered] : undefined,
      trace.firstLineMs === undefined
        ? 'no line yet'
        : `first line after ${seconds(trace.firstLineMs)}`,
    ]
      .filter((part): part is string => part !== undefined)
      .join(' · '),
  ]);
}
