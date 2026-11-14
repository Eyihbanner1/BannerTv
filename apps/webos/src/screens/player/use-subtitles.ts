import {
  BANNERTV_DEMO_ID,
  createStore,
  type Cue,
  type DriftChoice,
  fileReleaseMatch,
  judgeSubtitleFit,
  languageKey,
  type LineTiming,
  linkedToVideo,
  otherEpisode,
  type StreamEntry,
  type SubtitleFit,
  subtitleFileKey,
  subtitleRelease,
  type VideoLength,
} from '@bannertv/core';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { addonCollection } from '../../data/addons';
import { subtitleDrifts, subtitleOffsets } from '../../data/library';
import { subtitlePicks } from '../../data/playback';
import { chooseSubtitleLanguage, heardLanguages, wantedSubtitle } from '../../data/tracks';
import { mark } from '../../platform/marks';
import { streamTitle } from '../../player/describe';
import {
  DRIFT_RATES,
  driftInUse,
  driftKeptWithTiming,
  type LineMove,
  stretchCues,
  type SubtitleDrift,
  timingInUse,
  viewersDrift,
} from '../../player/drift';
import type { EngineTrack } from '../../player/engines/types';
import type { PlaybackSession, SessionState } from '../../player/session';
import {
  createSubtitleAligner,
  decideMove,
  findReference,
  MIN_REFERENCE_LINES,
  moveCues,
  type MoveDecision,
  moveOf,
  PAGE_SLICING,
  readableTrack,
  type Reference,
  referenceTrack,
  referenceStage,
  type SubtitleAligner,
  syncedOf,
  timingOf,
  withSync,
} from '../../player/subtitle-align';
import { createSubtitleChecks, type SubtitleChecks } from '../../player/subtitle-checks';
import {
  filesIn,
  fitsIn,
  MAX_EXTRA_CHECKS,
  type PickContext,
  pickReason,
  pickSubtitleFile,
  type PlanInput,
  planSubtitlePick,
  type PlayingRelease,
  type SubtitlePlan,
} from '../../player/subtitle-pick';
import {
  type PickReason,
  startSubtitleTrace,
  traceAlignment,
  traceReason,
  traceReference,
} from '../../player/subtitle-trace';
import { playingRelease, sameChoice } from '../../player/subtitle-versions';
import {
  clearSubtitleCache,
  loadSubtitles,
  subtitleList,
  type SubtitleListState,
  type SubtitleOption,
} from '../../player/subtitles';
import { sameAsLast } from './same-as-last';

/** A subtitle file from an addon, or one of the stream's own tracks (HLS through hls.js). */
export type SubtitleChoice = { kind: 'file'; key: string } | { kind: 'track'; id: string } | null;

/** A version's state for its row: its first line still to come, or a file that could not be read. */
export type SubtitleStatus = 'loading' | 'failed';

/**
 * What reading a file found, for its row: only for files read so far, and
 * for a file its name or its addon says is for another episode, read or not.
 */
export interface SubtitleCheck {
  /** For the hard of hearing: sounds and speakers' names among the lines. False until read. */
  hearing: boolean;
  /**
   * Why it fits the video badly: its text is in another script, it holds
   * signs only, it is for another episode or season, it covers only part of
   * the video, or it runs well past its end.
   */
  problem?: 'script' | 'signs' | 'episode' | 'short' | 'long';
  /** A drift its length gives away: the player fixes it by itself on the version showing. */
  drift?: SubtitleDrift;
  /** The version showing, whose drift the player fixed by itself. */
  autoDrift?: boolean;
  /**
   * In step with the video: lined up against a reference for sure, its lines
   * as that put them (not a drift fix the viewer chose instead). Never the
   * file the others are lined up against: nothing checked it.
   */
  synced?: boolean;
}

/**
 * What lining the file showing up against the video did, for the Timing tab:
 * its lines moved by the player (`offset` seconds, and stretched by `rate`
 * where that is not 1); checked and found in step already; the reference the
 * others are checked against; still being checked; checked, but its timing
 * matched the video's too little to move it; left as the viewer set it (their
 * drift fix, or timing set before the check ended); found out of step only
 * once the player had moved lines as often as it does in a stream (late); or
 * nothing to check it against.
 */
export type SubtitleSync =
  | { state: 'moved'; offset: number; rate: number }
  | {
      state: 'inStep' | 'reference' | 'checking' | 'unmatched' | 'yours' | 'late' | 'unchecked';
    };

/**
 * How the viewer chose: a version from a language's list, which stays as
 * picked; or a language, whose version is then chosen as at the start of a
 * stream (the sheet starts it on its best placed version).
 */
export type ChoiceWay = 'version' | 'language';

export interface Subtitles {
  options: SubtitleOption[];
  tracks: EngineTrack[];
  /** Addons still looking for subtitles. */
  pending: number;
  choice: SubtitleChoice;
  /** What to draw, or null when off or still loading: on the video's clock, drift fix applied. */
  cues: Cue[] | null;
  loading: boolean;
  /** The chosen file could not be read, nor any other in its language. */
  failed: boolean;
  /** Seconds; positive shows subtitles later. Kept for each file. */
  offset: number;
  /** The drift fix for a file timed for another frame rate, or null. Kept for each file. */
  drift: SubtitleDrift | null;
  /** The drift fix in use was made by the player, from the file's length: the viewer chose none. */
  autoDrift: boolean;
  /**
   * Whether a drift fix applies. Not to a track Android hands over line by line as the video
   * plays: it is in step with the video, and its last line has no end to stretch yet.
   */
  canFixDrift: boolean;
  /**
   * The player lined the file showing up and stretched its lines to a rate that is neither drift
   * fix (24 against 23.976, 25 against 24, 30 against 29.97): none of the drift fixes is in use,
   * and No fix undoes the stretch.
   */
  stretched: boolean;
  /**
   * What lining the file showing up against the video did; null for a track, off, or a file
   * the others would be lined up against when there are none.
   */
  sync: SubtitleSync | null;
  /**
   * The viewer chose; their choice becomes the language picked next time. A version picked
   * from a language's list is also kept for the release playing, and tried first next time.
   */
  choose(choice: SubtitleChoice, way?: ChoiceWay): void;
  /** Moves the subtitles showing later or earlier, remembered for that file. */
  setOffset(offset: number): void;
  /** Stretches the subtitles showing onto the video's frame rate, remembered for that file. */
  setDrift(drift: SubtitleDrift | null): void;
  statusOf(choice: NonNullable<SubtitleChoice>): SubtitleStatus | undefined;
  /**
   * What reading the file found, once it has been read, or that it is for
   * another episode, as its name or its addon says; undefined for the
   * stream's tracks.
   */
  checkOf(choice: NonNullable<SubtitleChoice>): SubtitleCheck | undefined;
  /** Whether it is the version picked by hand for the release playing: its language starts on it. */
  isRemembered(choice: NonNullable<SubtitleChoice>): boolean;
  /** Lines for the hard of hearing are wanted: the viewer picked such a version for this title. */
  wantsHearing(): boolean;
}

const EMPTY: SubtitleListState = { options: [], pending: 0 };
const noop = () => () => undefined;

/**
 * How long the first subtitle line waits, at most, after the first file
 * has been read, for the next few to be read and the best of them chosen.
 */
const HOLD_MS = 2000;
/** Once lines show, a file read later may take over only this soon after, and only so often. */
const EARLY_MS = 90_000;
const MAX_SWITCHES = 2;
/** A line due this soon (seconds) counts as showing already, for a move. */
const FIRST_LINE_MARGIN_S = 0.5;

/**
 * BannerTV Demo's subtitle tracks only check how subtitles look. They wait for
 * the viewer to pick one, and picking one leaves the language other titles
 * start with as it was.
 */
function isSubtitleCheck(entry: StreamEntry | null): boolean {
  return entry?.addonId === BANNERTV_DEMO_ID;
}

/**
 * Who a subtitle file is, for its timing: an addon's file by its addon and id;
 * a file or track the stream sent, only with that stream.
 */
function fileIdentity(choice: NonNullable<SubtitleChoice>, entry: StreamEntry): string {
  if (choice.kind === 'file' && !choice.key.startsWith('stream#')) return choice.key;
  const stream = entry.stream.behaviorHints.filename ?? streamTitle(entry);
  return `${stream}\n${choice.kind === 'file' ? choice.key : `track:${choice.id}`}`;
}

function languageOf(
  choice: SubtitleChoice,
  options: readonly SubtitleOption[],
  tracks: readonly EngineTrack[],
): string | null {
  if (!choice) return null;
  if (choice.kind === 'file') return options.find((o) => o.key === choice.key)?.lang ?? null;
  return tracks.find((t) => t.id === choice.id)?.lang ?? null;
}

/**
 * The video's length for the subtitle checks: the player's own once it
 * knows it, else the title's running time; none for a live broadcast.
 */
function videoLength(duration: number, live: boolean, runtime: number | undefined): VideoLength {
  if (live) return { exact: true };
  if (duration > 0 && isFinite(duration)) return { seconds: duration, exact: true };
  return runtime !== undefined && runtime > 0
    ? { seconds: runtime, exact: false }
    : { exact: false };
}

/** What reading each file found, each judged in its own language, by link. */
function fitsByUrl(
  offered: readonly SubtitleOption[],
  profile: (url: string) => ReturnType<SubtitleChecks['profile']>,
  length: VideoLength,
): Map<string, SubtitleFit> {
  const byUrl = new Map<string, SubtitleFit>();
  const judged = new Set<string>();
  for (const option of offered) {
    const key = languageKey(option.lang);
    if (judged.has(key)) continue;
    judged.add(key);
    fitsIn(offered, option.lang, profile, length).forEach((fit, url) => byUrl.set(url, fit));
  }
  return byUrl;
}

type StreamTracks = Pick<SessionState, 'text' | 'engine' | 'streamTimings'>;

/** The stream's track to line files up against (`referenceTrack`). */
const referenceTrackOf = (playing: StreamTracks): EngineTrack | null =>
  referenceTrack(playing.text, playing.engine, playing.streamTimings);

/** What finding the reference needs to know of the files, besides the stream. */
interface FilesKnown {
  offered: readonly SubtitleOption[];
  fits: ReadonlyMap<string, SubtitleFit>;
  checks: SubtitleChecks;
  broken: (url: string) => boolean;
  video: PlayingRelease;
}

/** The reference to line files up against, now (`findReference`). */
function referenceIn(
  playing: StreamTracks & Pick<SessionState, 'duration'>,
  files: FilesKnown,
  previous: Reference | null,
): Reference | null {
  const track = referenceTrackOf(playing);
  const lines = track ? playing.streamTimings[track.id] : undefined;
  return findReference(
    {
      track: track && lines ? { id: track.id, lines } : null,
      duration: playing.duration > 0 && isFinite(playing.duration) ? playing.duration : 0,
      offered: files.offered,
      fit: (option) => files.fits.get(option.url),
      lines: files.checks.lines,
      broken: files.broken,
      video: files.video,
    },
    previous,
  );
}

/**
 * Whether a reference may yet come: the stream has a track the engine can
 * read, or a file in the language linked to the video or named for its
 * release is still to be read.
 */
function referenceComing(
  playing: StreamTracks,
  language: string | null,
  files: FilesKnown,
): boolean {
  if (playing.text.some((track) => readableTrack(track, playing.engine))) return true;
  if (language === null) return false;
  return filesIn(files.offered, language).some((option) => {
    if (files.broken(option.url) || files.fits.has(option.url)) return false;
    if (otherEpisode(option, files.video)) return false;
    const match = fileReleaseMatch(option, files.video);
    return linkedToVideo(option, files.video) || match === 'exact' || match === 'group';
  });
}

/**
 * Whether the stream's track, through hls.js or Shaka, is still to hand over
 * enough lines to line files up against: its lines come within moments, so
 * the hold waits for them. Android hands them over only as the video plays.
 */
function trackComing(playing: StreamTracks): boolean {
  if (playing.engine !== 'hls.js' && playing.engine !== 'shaka') return false;
  const track = referenceTrackOf(playing);
  return !!track && (playing.streamTimings[track.id]?.length ?? 0) < MIN_REFERENCE_LINES;
}

/** The files read so far, with their lines' timing, for lining them up. */
function readFiles(offered: readonly SubtitleOption[], checks: SubtitleChecks) {
  const files: Array<{ url: string; lines: readonly LineTiming[] }> = [];
  const seen = new Set<string>();
  for (const option of offered) {
    const lines = checks.lines(option.url);
    if (!lines || seen.has(option.url)) continue;
    seen.add(option.url);
    files.push({ url: option.url, lines });
  }
  return files;
}

/** What was done with a sure answer, and the answer's move it was decided for. */
interface Decided extends MoveDecision {
  for: LineMove;
}

/** The moves decided on a stream, by file link, and how many came after lines had shown. */
interface StreamMoves {
  entry: StreamEntry | null;
  byLink: ReadonlyMap<string, Decided>;
  late: number;
}

const sameMove = (a: LineMove, b: LineMove) => a.offset === b.offset && a.rate === b.rate;

const noMoves = (entry: StreamEntry | null): StreamMoves => ({ entry, byLink: new Map(), late: 0 });

/** Where the automatic file choice for a stream stands. */
interface AutoState {
  entry: StreamEntry | null;
  /** Its lines are held back while the first few files are read. */
  holding: boolean;
  /** When the first file was read, for the hold's end. */
  firstReadAt?: number;
  /** When its lines were let through, for how long switches may come. */
  shownAt?: number;
  /** Switches made since, to a file that fits clearly better. */
  switches: number;
}

/**
 * Which subtitles show, and their cues. For each stream it picks the language
 * last chosen: the version the viewer picked by hand for this release first,
 * even when its addon answers after the stream lists its own track; then the
 * stream's own track in that language (always in sync), unless it holds
 * forced lines only; then the addon file that fits best; a track of forced
 * lines only when the language has nothing else that can be shown (a file
 * that could not be read, or in another script, comes after it). The first
 * few files are read before one shows (for at most HOLD_MS after the first is
 * read, and never waiting on a slow download): one in another script or of
 * signs only is passed over, and a full plain file that lasts as long as the
 * video wins (`planSubtitlePick`). A file that fits
 * clearly better, read later, takes over soon after, at most twice; one made
 * for the release that arrives later takes over too. A language the viewer
 * turns on from the sheet stays theirs, and its version is chosen the same
 * way. Never once the viewer chose a version, or moved the timing or chose a
 * drift fix of the one showing. If a file cannot be read, the next one in the
 * same language is tried.
 */
export function useSubtitles(
  type: string,
  videoId: string,
  /** The title, whose last subtitle choice comes first; undefined for Lab streams. */
  metaId: string | undefined,
  entry: StreamEntry | null,
  session: PlaybackSession | null,
  state: SessionState,
  /** The title's running time from its page, in seconds, for the checks before the video's own. */
  runtimeSeconds?: number,
): Subtitles {
  const list = useMemo(() => {
    if (!entry) return null;
    const addon = addonCollection
      .get()
      .addons.find((candidate) => candidate.manifest.id === entry.addonId);
    return subtitleList(type, videoId, entry.stream, addon?.manifest.name ?? entry.addonId);
  }, [type, videoId, entry]);
  const listState = useSyncExternalStore(
    list ? list.subscribe : noop,
    list ? list.get : () => EMPTY,
  );
  // What happens to this play's subtitles, for Diagnostics: started before the addons are asked.
  useEffect(() => {
    startSubtitleTrace(videoId);
  }, [videoId]);
  useEffect(() => {
    if (!list) return;
    list.start();
    return () => list.stop();
  }, [list]);

  // Files read for their checks, for this video: the screen is made again for another.
  const [checks] = useState(() => createSubtitleChecks(loadSubtitles));
  const profiles = useSyncExternalStore(checks.subscribe, checks.profiles);

  // Files lined up against a reference, for the stream playing (ADR 0003).
  const [aligner] = useState<SubtitleAligner>(() => createSubtitleAligner(PAGE_SLICING));
  const alignments = useSyncExternalStore(aligner.subscribe, aligner.results);
  // Each run told to Diagnostics by the file's place in the order lined up, and its language:
  // never its link.
  const alignedOrder = useRef(new Map<string, number>());
  useEffect(
    () =>
      aligner.outcomes(({ url, record }) => {
        const order = alignedOrder.current;
        if (!order.has(url)) order.set(url, order.size + 1);
        const { confidence, offset, rate } = record.alignment;
        traceAlignment(videoId, order.get(url)!, {
          language: listState.options.find((option) => option.url === url)?.lang ?? '',
          reference: record.reference,
          confidence,
          offset,
          rate,
          ms: record.ms,
        });
      }),
    // The files offered as they are when a run ends.
    [aligner, videoId, listState],
  );
  // The reference of the stream playing, kept while it still is one: for the plan, and for the
  // screen. And as Diagnostics was last told it.
  const referenceUsed = useRef<Reference | null>(null);
  const [usedReference, setUsedReference] = useState<{
    entry: StreamEntry | null;
    reference: Reference | null;
  }>({ entry: null, reference: null });
  const tracedReference = useRef<string | null>(null);
  // Another stream lines its files up against its own reference, from the start.
  useEffect(() => {
    aligner.reset();
    alignedOrder.current = new Map();
    referenceUsed.current = null;
    tracedReference.current = null;
  }, [aligner, entry]);
  /** Keeps the reference for the stream, and tells Diagnostics what it is as that changes. */
  const noteReference = (reference: Reference | null) => {
    const before = referenceUsed.current;
    referenceUsed.current = reference;
    if (before?.id !== reference?.id || before?.kind !== reference?.kind) {
      setUsedReference({ entry, reference });
    }
    const kind = reference ? reference.kind : null;
    if (kind === tracedReference.current) return;
    tracedReference.current = kind;
    traceReference(videoId, kind);
  };

  // The choice belongs to one stream: another stream starts with none until the next decision.
  const [chosen, setChosen] = useState<{ entry: StreamEntry | null; choice: SubtitleChoice }>({
    entry: null,
    choice: null,
  });
  const choice = chosen.entry === entry ? chosen.choice : null;
  // Kept by link, not key: two streams' own files can share a key.
  const [loaded, setLoaded] = useState<{ url: string; cues: Cue[] } | null>(null);
  const [failedChoice, setFailedChoice] = useState<SubtitleChoice>(null);
  // The stream whose automatic choice is holding its lines back while files are checked.
  const [holdingFor, setHoldingFor] = useState<StreamEntry | null>(null);
  // The start-of-stream choice and the stream it was made for; the viewer's own choice also
  // counts. auto: made here, not by the viewer, so a track listed later may still take over.
  const decided = useRef<{
    entry: StreamEntry | null;
    choice: SubtitleChoice;
    auto: boolean;
    /** The language wanted when it was made, which the audio heard can change. */
    wanted?: string | null;
    /** The version picked by hand for this release: a track listed later does not take over. */
    remembered?: boolean;
    /**
     * The language the viewer turned on from the sheet: theirs, whatever the
     * audio heard, while its version is chosen here.
     */
    language?: string;
  } | null>(null);
  const auto = useRef<AutoState>({ entry: null, holding: false, switches: 0 });
  // Files read for their checks in each language, by link, for the stream playing: another
  // stream of the video reads its own file and the addon's first again. And when each file
  // being read was asked for, by link, to tell a slow download.
  const checkedIn = useRef<{
    entry: StreamEntry | null;
    byLanguage: Map<string, Set<string>>;
    asked: Map<string, number>;
  }>({
    entry: null,
    byLanguage: new Map(),
    asked: new Map(),
  });
  // Plans the choice again, now: for a language the viewer turned on.
  const wake = useRef<(() => void) | null>(null);
  // A version just picked by hand, kept for the release once it reads.
  const handPicked = useRef<{ entry: StreamEntry; key: string; release: string } | null>(null);
  // Links of files that failed for this video, so a retry moves on to another,
  // and the same for the rows to show.
  const broken = useRef(new Set<string>());
  const [failedLinks, setFailedLinks] = useState<ReadonlySet<string>>(() => new Set());
  const markBroken = (url: string, failed: boolean) => {
    if (failed) broken.current.add(url);
    else broken.current.delete(url);
    setFailedLinks(new Set(broken.current));
  };
  const { options, pending } = listState;
  const tracks = state.text;
  const { duration, live } = state;

  /** Who an offered file is, as its timing and the version picked by hand are kept. */
  const fileKeyOf = (key: string, stream: StreamEntry) =>
    subtitleFileKey(videoId, fileIdentity({ kind: 'file', key }, stream));

  /** The release the version picked by hand is kept for; none for Lab streams and Demo checks. */
  const pickReleaseOf = (stream: StreamEntry): string | null =>
    metaId !== undefined && !isSubtitleCheck(stream) ? subtitleRelease(stream, videoId) : null;

  /** The key of the version picked by hand for the release, among those offered. */
  const rememberedIn = (
    offered: readonly SubtitleOption[],
    stream: StreamEntry,
  ): string | undefined => {
    const pickRelease = pickReleaseOf(stream);
    const pickedFile = pickRelease ? subtitlePicks.get(metaId!, pickRelease)?.file : undefined;
    return pickedFile
      ? offered.find((option) => fileKeyOf(option.key, stream) === pickedFile)?.key
      : undefined;
  };

  /**
   * What is known of the files in a language, for picking one: those that could
   * not be read, what reading the others found, and the version picked by hand
   * for the release playing.
   */
  const contextIn = (
    offered: readonly SubtitleOption[],
    language: string,
    stream: StreamEntry,
    length: VideoLength,
  ): PickContext => {
    const fits = fitsIn(offered, language, checks.profile, length);
    const pickRelease = pickReleaseOf(stream);
    return {
      video: playingRelease(stream, videoId),
      broken: (url) => broken.current.has(url) || checks.failed(url),
      // With what lining the file up against a reference found: in step, or for another video.
      fit: (url) => withSync(fits.get(url), syncedOf(aligner.result(url))),
      remembered: rememberedIn(offered, stream),
      hearing: pickRelease ? subtitlePicks.wantsHearing(metaId!, pickRelease) : false,
    };
  };

  // The start-of-stream choice, once the stream's tracks and the addons have had their say,
  // and the automatic file choice planned again as the files are read.
  useEffect(() => {
    if (!entry || !session || !list) return;
    let stopped = false;
    // The language wanted at the latest look, kept with an automatic choice, and whether the
    // viewer turned it on from the sheet.
    let wantedNow: string | null = null;
    let pressedNow: string | undefined;
    // Ends the hold once its time is up, or once a file being read turns out slow; and when.
    let timer: number | undefined;
    let timerAt = 0;
    const wakeAt = (at: number, now: number) => {
      if (timer !== undefined && timerAt <= at) return;
      if (timer !== undefined) clearTimeout(timer);
      timerAt = at;
      timer = window.setTimeout(
        () => {
          timer = undefined;
          decide();
        },
        Math.max(0, at - now) + 20,
      );
    };
    /** Settles on a choice, and says why for Diagnostics, with its language. */
    const settle = (
      next: SubtitleChoice,
      why: PickReason,
      language: string | null,
      remembered = false,
    ) => {
      // For a trace of starting a video: when the subtitles were settled, and how.
      mark(`sub:chosen:${next ? next.kind : 'off'}`);
      traceReason(videoId, why, language, pressedNow !== undefined);
      decided.current = {
        entry,
        choice: next,
        auto: true,
        wanted: wantedNow,
        remembered,
        language: pressedNow,
      };
      setChosen({ entry, choice: next });
    };
    const setHolding = (holding: boolean) => {
      const standing = auto.current;
      if (standing.holding === holding && standing.entry === entry) return;
      if (standing.holding && !holding) standing.shownAt = Date.now();
      standing.holding = holding;
      setHoldingFor(holding ? entry : null);
    };
    /** A fresh automatic choice for this stream: lines held back until the files are read. */
    const startAuto = (holding: boolean) => {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      auto.current = { entry, holding, switches: 0, shownAt: holding ? undefined : Date.now() };
      setHoldingFor(holding ? entry : null);
    };

    /** Plans the automatic file choice in `wanted`, reads what the plan asks, and settles on its pick. */
    const plan = (
      offered: readonly SubtitleOption[],
      wanted: string,
      context: PickContext,
      current: string | undefined,
      sync: Pick<PlanInput<SubtitleOption>, 'syncing' | 'aligning'>,
    ): SubtitlePlan<SubtitleOption> => {
      const standing = auto.current;
      const playing = session.get();
      const now = Date.now();
      const language = languageKey(wanted);
      if (checkedIn.current.entry !== entry) {
        checkedIn.current = { entry, byLanguage: new Map(), asked: new Map() };
      }
      const checked = checkedIn.current.byLanguage.get(language) ?? new Set<string>();
      checkedIn.current.byLanguage.set(language, checked);
      const { asked } = checkedIn.current;
      const files = filesIn(offered, wanted);
      // A file being read that the plan did not ask for (the one chosen, loading) counts from now.
      for (const option of files) {
        if (!checks.reading(option.url)) asked.delete(option.url);
        else if (!asked.has(option.url)) asked.set(option.url, now);
      }
      if (
        standing.holding &&
        standing.firstReadAt === undefined &&
        files.some((option) => checks.profile(option.url))
      ) {
        standing.firstReadAt = now;
      }
      const result = planSubtitlePick({
        ...context,
        offered,
        language: wanted,
        reading: checks.reading,
        slow: (url) => checks.reading(url) && now - (asked.get(url) ?? now) >= HOLD_MS,
        current,
        holding: standing.holding,
        timeUp: standing.firstReadAt !== undefined && now - standing.firstReadAt >= HOLD_MS,
        lengthPending: !playing.live && !(playing.duration > 0),
        readsLeft: MAX_EXTRA_CHECKS + 1 - checked.size,
        switchesLeft:
          standing.shownAt !== undefined && now - standing.shownAt < EARLY_MS
            ? MAX_SWITCHES - standing.switches
            : 0,
        ...sync,
      });
      for (const file of result.read) {
        checked.add(file.url);
        asked.set(file.url, now);
        checks.read(file).catch(() => {
          if (!stopped) markBroken(file.url, true);
        });
      }
      if (result.switched) standing.switches++;
      setHolding(result.hold);
      if (result.hold) {
        // Planned again when the time is up, or when the next file being read turns slow: the
        // one chosen too, whose load starts once it is chosen.
        let due = standing.firstReadAt !== undefined ? standing.firstReadAt + HOLD_MS : Infinity;
        for (const option of files) {
          const at = asked.get(option.url);
          if (at !== undefined && checks.reading(option.url) && at + HOLD_MS > now) {
            due = Math.min(due, at + HOLD_MS);
          }
        }
        if (result.pick && !checks.profile(result.pick.url) && !checks.reading(result.pick.url)) {
          due = Math.min(due, (asked.get(result.pick.url) ?? now) + HOLD_MS);
        }
        if (due !== Infinity) wakeAt(due, now);
      } else if (
        result.pick &&
        !checks.profile(result.pick.url) &&
        (checks.reading(result.pick.url) || result.pick.key !== current)
      ) {
        // Planned again when the file chosen, on its way or about to be, turns slow: other copies
        // made for the release are read then. It counts from when its load started.
        const due = (asked.get(result.pick.url) ?? now) + HOLD_MS;
        if (due > now) wakeAt(due, now);
      }
      const why = result.pick && pickReason(result.pick, offered, wanted, context);
      if (result.pick && result.pick.key !== current) {
        // Landing on the version picked by hand, it stays: a track listed later does not take over.
        settle(
          { kind: 'file', key: result.pick.key },
          why!,
          result.pick.lang,
          result.pick.key === context.remembered,
        );
      } else if (result.pick && why) {
        // The same file, its reason seen again as more of the files are read.
        traceReason(videoId, why, result.pick.lang, pressedNow !== undefined);
      }
      return result;
    };

    const decide = () => {
      if (stopped) return;
      const playing = session.get();
      const { text, status, engine, audio } = playing;
      // hls.js and Shaka list the stream's tracks before its first picture; the
      // TV's player never lists any.
      const tracksKnown = status === 'playing' || status === 'paused' || engine === 'native';
      const made = decided.current;
      const ours = made?.entry === entry ? made : null;
      // A language the viewer turned on from the sheet: its version is chosen in it.
      const pressed = ours?.auto ? ours.language : undefined;
      const wanted =
        pressed ??
        (isSubtitleCheck(entry) ? null : wantedSubtitle(metaId, heardLanguages(audio, entry)));
      wantedNow = wanted;
      pressedNow = pressed;
      const { options: offered, pending: waiting } = list.get();
      const length = videoLength(playing.duration, playing.live, runtimeSeconds);
      const context = wanted === null ? null : contextIn(offered, wanted, entry, length);
      const key = wanted === null ? null : languageKey(wanted);
      // The files read are lined up against the reference, if there is one: the plan weighs what
      // that finds, and waits for it while it holds the lines back.
      const known: FilesKnown = {
        offered,
        fits: fitsByUrl(offered, checks.profile, length),
        checks,
        broken: (url) => broken.current.has(url) || checks.failed(url),
        video: playingRelease(entry, videoId),
      };
      const reference = referenceIn(playing, known, referenceUsed.current);
      noteReference(reference);
      if (reference) aligner.request(readFiles(offered, checks), reference);
      const trackLinesComing = !reference && trackComing(playing);
      const sync = {
        syncing: reference !== null || referenceComing(playing, wanted, known),
        aligning: (url: string) =>
          aligner.pending(url) ||
          (trackLinesComing && checks.profile(url) !== undefined && !aligner.result(url)),
      };
      // The version picked by hand for this release comes first, even before the stream's track,
      // and whether or not the stream has listed its tracks yet.
      const picked =
        context && key !== null
          ? offered.find(
              (o) =>
                o.key === context.remembered &&
                languageKey(o.lang) === key &&
                !context.broken(o.url),
            )
          : undefined;
      // The stream's own track in the language; one of forced lines only (signs, the
      // foreign-language scenes) only when the language has nothing else.
      const inLanguage = (t: EngineTrack) => key !== null && languageKey(t.lang) === key;
      const track = text.find((t) => inLanguage(t) && !t.forced);
      const forcedTrack = text.find((t) => inLanguage(t) && !!t.forced);
      // A file that can be shown: one that could be read, in the language's script. A track of
      // forced lines only comes before one that cannot.
      const usable = (option: SubtitleOption | undefined) =>
        !!option &&
        !!context &&
        !context.broken(option.url) &&
        context.fit(option.url)?.script !== 'wrong';
      if (ours) {
        // A track that left with its engine (hls.js handing the stream to the
        // TV's player) gives way to a file.
        const chosenTrack = ours.choice;
        const lost =
          chosenTrack?.kind === 'track' &&
          tracksKnown &&
          !text.some((t) => t.id === chosenTrack.id);
        // A file or Off picked while the TV's player listed no tracks gives way
        // to the stream's own track once another engine (hls.js) lists one,
        // unless it is the version picked by hand for this release. A track of
        // forced lines only takes over from Off, chosen as nothing was left, and
        // gives way to a full track, or to a file that can be used.
        const onForced =
          chosenTrack?.kind === 'track' && text.some((t) => t.id === chosenTrack.id && !!t.forced);
        const usableLeft =
          context !== null &&
          wanted !== null &&
          pickSubtitleFile(offered, wanted, context) !== undefined;
        // A file that cannot be shown, with nothing better left in the language, gives way to a
        // track of forced lines only; the version picked by hand only once it could not be read.
        const chosenFile =
          chosenTrack?.kind === 'file' ? offered.find((o) => o.key === chosenTrack.key) : undefined;
        const giveUp =
          chosenFile !== undefined &&
          forcedTrack !== undefined &&
          !usableLeft &&
          (ours.remembered ? !!context?.broken(chosenFile.url) : !usable(chosenFile));
        const better =
          ours.auto &&
          (giveUp ||
            (!ours.remembered &&
              (chosenTrack?.kind !== 'track'
                ? track !== undefined || (chosenTrack === null && forcedTrack !== undefined)
                : onForced && (track !== undefined || usableLeft))));
        // "Only when the audio isn't in that language", once the audio's language is known; not
        // for a language the viewer turned on.
        const heardOther =
          ours.auto && pressed === undefined && ours.wanted !== undefined && ours.wanted !== wanted;
        // The version picked by hand for this release, offered after an automatic choice.
        const rememberedNow =
          ours.auto &&
          !ours.remembered &&
          picked !== undefined &&
          !(chosenTrack?.kind === 'file' && chosenTrack.key === picked.key);
        if (!lost && !better && !heardOther && !rememberedNow) {
          // The automatic file choice, planned again as files are read or more addons answer:
          // the one made for this release, or one that fits clearly better, takes over.
          if (ours.auto && chosenTrack?.kind === 'file' && context && wanted !== null) {
            if (auto.current.entry !== entry) {
              auto.current = { entry, holding: false, switches: 0, shownAt: Date.now() };
            }
            plan(offered, wanted, context, chosenTrack.key, sync);
          }
          return;
        }
      }
      if (wanted === null || !context) {
        startAuto(false);
        settle(null, 'off', null);
        return;
      }
      if (picked) {
        startAuto(false);
        settle({ kind: 'file', key: picked.key }, 'by hand', picked.lang, true);
        return;
      }
      if (track) {
        startAuto(false);
        settle({ kind: 'track', id: track.id }, 'own track', track.lang);
        return;
      }
      // Addon files often arrive first, but the stream's own track wins once listed.
      if (!tracksKnown) return;
      startAuto(true);
      const result = plan(offered, wanted, context, undefined, sync);
      // Nothing in the language can be shown (none at all, or only files that could not be read
      // or are in another script): a track of forced lines only, where the stream has one.
      if (result.pick && !usable(result.pick) && forcedTrack) {
        setHolding(false);
        settle({ kind: 'track', id: forcedTrack.id }, 'own track', forcedTrack.lang);
      } else if (!result.pick && waiting === 0) {
        setHolding(false);
        if (forcedTrack)
          settle({ kind: 'track', id: forcedTrack.id }, 'own track', forcedTrack.lang);
        else settle(null, 'off', null);
      }
    };
    wake.current = decide;
    // The session tells of every step of the clock; only what the choice weighs counts.
    const nothingNew = sameAsLast();
    const onSession = () => {
      const { text, audio, status, engine, duration, live, streamTimings } = session.get();
      if (nothingNew([text, audio, status, engine, duration, live, streamTimings])) return;
      decide();
    };
    const stopList = list.subscribe(decide);
    const stopSession = session.subscribe(onSession);
    const stopChecks = checks.subscribe(decide);
    const stopAligner = aligner.subscribe(decide);
    // Both may already hold enough to decide.
    void Promise.resolve().then(decide);
    return () => {
      stopped = true;
      if (wake.current === decide) wake.current = null;
      if (timer !== undefined) clearTimeout(timer);
      stopList();
      stopSession();
      stopChecks();
      stopAligner();
    };
    // contextIn and fileKeyOf read only what these name, and refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry, session, list, metaId, runtimeSeconds, videoId, checks, aligner]);

  // The files read stay in memory only while the player is open.
  useEffect(() => () => clearSubtitleCache(), []);

  // Load the chosen file, moving to the next in its language if it fails.
  useEffect(() => {
    if (!choice || choice.kind !== 'file' || !entry) return;
    const option = options.find((o) => o.key === choice.key);
    if (!option) return;
    let cancelled = false;
    let stopWaiting: (() => void) | undefined;
    // Unless the viewer has chosen something else meanwhile.
    const moveTo = (next: SubtitleOption) => {
      const made = decided.current;
      if (made && made.choice === choice) made.choice = { kind: 'file', key: next.key };
      setChosen((current) =>
        current.choice === choice
          ? { entry: current.entry, choice: made?.choice ?? { kind: 'file', key: next.key } }
          : current,
      );
    };
    // Its download counts from now, to tell when it turns slow (`asked`).
    const counted = checkedIn.current;
    if (counted.entry === entry && !checks.reading(option.url) && !checks.profile(option.url)) {
      counted.asked.set(option.url, Date.now());
    }
    checks.read(option).then(
      (cues) => {
        // A file that failed once and reads now is no longer marked.
        if (broken.current.has(option.url)) markBroken(option.url, false);
        // A version picked by hand is kept for the release once it reads, with whether it
        // was for the hard of hearing: picking one asks for them. Not one given up on while
        // it loaded.
        const picked = handPicked.current;
        if (
          !cancelled &&
          picked &&
          picked.entry === entry &&
          picked.key === option.key &&
          metaId !== undefined
        ) {
          handPicked.current = null;
          const profile = checks.profile(option.url);
          void subtitlePicks.remember({
            metaId,
            release: picked.release,
            file: fileKeyOf(option.key, entry),
            hearing: !!profile && judgeSubtitleFit(profile, { exact: false }, option.lang).hearing,
          });
        }
        if (!cancelled) setLoaded({ url: option.url, cues });
      },
      () => {
        if (cancelled) return;
        markBroken(option.url, true);
        const playing = session?.get();
        const length = videoLength(playing?.duration ?? 0, !!playing?.live, runtimeSeconds);
        // The best of the rest in the language; not the version kept for this release, which a
        // choice made since has passed over.
        const nextIn = (offered: readonly SubtitleOption[]) =>
          pickSubtitleFile(offered, option.lang, {
            ...contextIn(offered, option.lang, entry, length),
            remembered: undefined,
          });
        const made = decided.current;
        // An automatic choice is planned again by the decision above, which has heard of
        // the failure already; this only says when nothing else in the language is left.
        if (made?.entry === entry && made.auto) {
          if (!nextIn(list ? list.get().options : options)) setFailedChoice(choice);
          return;
        }
        // The list as it is now: more addons may have answered since the choice.
        const next = nextIn(list ? list.get().options : options);
        if (next) {
          moveTo(next);
          return;
        }
        setFailedChoice(choice);
        // An addon that answers later may still have one.
        stopWaiting = list?.subscribe(() => {
          const later = nextIn(list.get().options);
          if (!later) return;
          stopWaiting?.();
          stopWaiting = undefined;
          moveTo(later);
        });
      },
    );
    return () => {
      cancelled = true;
      stopWaiting?.();
    };
    // Only a new choice reloads; more options arriving do not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [choice]);

  const fileKey = choice?.kind === 'file' ? choice.key : null;
  const fileOption = fileKey !== null ? options.find((o) => o.key === fileKey) : undefined;
  const fileCues = fileOption && loaded?.url === fileOption.url ? loaded.cues : null;
  const fileFailed = fileKey !== null && failedChoice === choice;
  // The automatic choice's lines wait while the first few files are read.
  const holding = fileKey !== null && holdingFor !== null && holdingFor === entry;

  // The stream's own tracks: tell the engine, and read the cues it hands over. While a file
  // shows, the track to line files up against is read for its lines, and not shown.
  const trackId = choice?.kind === 'track' ? choice.id : null;
  const readTrackId =
    choice?.kind === 'file'
      ? (referenceTrack(tracks, state.engine, state.streamTimings)?.id ?? null)
      : null;
  useEffect(() => {
    session?.selectText(trackId ?? readTrackId);
  }, [session, trackId, readTrackId]);
  const trackCues = trackId === null ? null : (state.streamCues[trackId] ?? []);

  // What reading each file found, judged against the video and the others in its language.
  const { fits, fitsByLink } = useMemo(() => {
    const length = videoLength(duration, live, runtimeSeconds);
    const byLanguage = new Map<string, Map<string, SubtitleFit>>();
    const byLink = new Map<string, SubtitleFit>();
    for (const option of options) {
      const key = languageKey(option.lang);
      if (byLanguage.has(key) || !profiles.has(option.url)) continue;
      const judged = fitsIn(options, option.lang, (url) => profiles.get(url), length);
      byLanguage.set(key, judged);
      judged.forEach((fit, url) => byLink.set(url, fit));
    }
    return { fits: byLanguage, fitsByLink: byLink };
  }, [options, profiles, duration, live, runtimeSeconds]);
  const fitOf = (option: SubtitleOption) => fits.get(languageKey(option.lang))?.get(option.url);

  // What the files are lined up against, and each file read lined up as the reference grows.
  const { text: streamText, engine, streamTimings } = state;
  const reference = useMemo(
    () =>
      referenceIn(
        { text: streamText, engine, streamTimings, duration },
        {
          offered: options,
          fits: fitsByLink,
          checks,
          broken: (url) => failedLinks.has(url) || checks.failed(url),
          video: playingRelease(entry, videoId),
        },
        // The one the automatic choice settled on: it is kept while it still is one.
        usedReference.entry === entry ? usedReference.reference : null,
      ),
    [
      streamText,
      engine,
      streamTimings,
      duration,
      options,
      fitsByLink,
      checks,
      failedLinks,
      entry,
      videoId,
      usedReference,
    ],
  );
  const referenceKey = reference
    ? `${reference.kind}|${reference.id}|${referenceStage(reference)}`
    : null;
  useEffect(() => {
    if (reference) aligner.request(readFiles(options, checks), reference);
    // Each time the reference changes or grows a stage, or another file is read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [referenceKey, profiles, aligner, checks]);

  // The timing and drift fix kept for the file showing.
  const offsetKey = choice && entry ? subtitleFileKey(videoId, fileIdentity(choice, entry)) : null;
  const offset = useSyncExternalStore(subtitleOffsets.subscribe, () =>
    offsetKey === null ? 0 : (subtitleOffsets.get(offsetKey) ?? 0),
  );
  const keptDrift = useSyncExternalStore(subtitleDrifts.subscribe, (): DriftChoice | null =>
    offsetKey === null ? null : (subtitleDrifts.get(offsetKey) ?? null),
  );
  const canFixDrift = !(trackId !== null && state.engine === 'android');
  // A drift the file's length gives away is fixed by itself, unless the viewer set a drift
  // or a timing on this file: theirs stands.
  const evidence = fileOption ? (fitOf(fileOption)?.drift ?? null) : null;
  const unaligned = driftInUse({ canFix: canFixDrift, evidence, kept: keptDrift, offset });

  // The move made on the file showing, once lining it up was sure: decided once a stream for
  // each sure answer of the file (a later look at a stream track still arriving may find it out
  // by a little). Before its first line shows, the move is made; after, only when it moves the
  // lines far enough, and only so many times a stream. Not where the viewer chose its drift fix,
  // nor where they set its timing on this stream before the move came: theirs stands.
  const fileUrl = fileOption?.url ?? null;
  const fileRecord = fileUrl !== null ? alignments.get(fileUrl) : undefined;
  const sureMove = useMemo(
    () => moveOf(fileRecord),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fileRecord?.alignment.offset, fileRecord?.alignment.rate, fileRecord?.alignment.confidence],
  );
  const [movesStore] = useState(() => createStore<StreamMoves>(noMoves(null)));
  const moves = useSyncExternalStore(movesStore.subscribe, movesStore.get);
  const movesNow = moves.entry === entry ? moves : noMoves(entry);
  const touched = useRef<{ entry: StreamEntry | null; links: Set<string> }>({
    entry: null,
    links: new Set(),
  });
  const touchedNow = (url: string) =>
    touched.current.entry === entry && touched.current.links.has(url);
  useEffect(() => {
    if (!entry || fileUrl === null || !sureMove) return;
    const made = movesNow.byLink.get(fileUrl);
    if (made && sameMove(made.for, sureMove)) return;
    if (viewersDrift(keptDrift)) return;
    const lines = checks.lines(fileUrl) ?? (fileCues ? timingOf(fileCues) : []);
    // Where the lines show now (as moved before on this stream, or as the file has them), and
    // where the move puts them, the viewer's timing with each.
    const shown = made?.move ?? null;
    const before: LineMove = shown
      ? { offset: shown.offset + (keptDrift === 'aligned' ? offset : 0), rate: shown.rate }
      : { offset, rate: unaligned.drift ? DRIFT_RATES[unaligned.drift] : 1 };
    const after: LineMove = {
      offset: sureMove.offset + (keptDrift === 'aligned' ? offset : 0),
      rate: sureMove.rate,
    };
    const first = lines.reduce((at, line) => Math.min(at, line.start), Infinity);
    const position = session?.get().position ?? 0;
    const early =
      holding ||
      fileCues === null ||
      position < first / before.rate + before.offset - FIRST_LINE_MARGIN_S;
    const decision = decideMove({
      move: sureMove,
      before,
      after,
      lines,
      early,
      touched: touchedNow(fileUrl),
      lateMoves: movesNow.late,
    });
    // Lines moved before stay where they are when the new answer leaves them.
    const kept: Decided =
      decision.move === null && made?.move
        ? { move: made.move, ...(made.late ? { late: true } : {}), for: sureMove }
        : { ...decision, for: sureMove };
    movesStore.set({
      entry,
      byLink: new Map(movesNow.byLink).set(fileUrl, kept),
      late: movesNow.late + (decision.late ? 1 : 0),
    });
    // Decided once for each file: what it reads of the rest is as it is at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry, fileUrl, sureMove, keptDrift, holding, fileCues, movesStore]);
  const decision = fileUrl !== null ? movesNow.byLink.get(fileUrl) : undefined;
  const appliedMove = decision?.move ?? null;
  const timing = timingInUse({
    canFix: canFixDrift,
    evidence,
    kept: keptDrift,
    offset,
    aligned: appliedMove,
  });
  const { drift, auto: autoDrift, move } = timing;
  // A move to a rate that is neither drift fix (24 against 23.976, 25 against 24) stretches the
  // lines with none of the fixes in use: the drift row shows none of its three on.
  const stretched = !!move && move.rate !== 1 && drift === null;
  const driftShown: SubtitleDrift | null | 'stretched' = stretched ? 'stretched' : drift;

  /** Whether a file is what the others are lined up against. */
  const isReference = (url: string) =>
    !!reference && reference.kind !== 'track' && reference.id === url;
  // What lining the file showing up did, for the Timing tab: from the timing in use, so a drift
  // fix the viewer chose since, which leaves the lines as the file has them, says so.
  const sync = ((): SubtitleSync | null => {
    if (fileUrl === null) return null;
    // Checked against nothing itself: said only where there are other files it is used for.
    if (isReference(fileUrl)) {
      return options.some((option) => option.url !== fileUrl) ? { state: 'reference' } : null;
    }
    if (move) {
      return Math.abs(move.offset) < 0.05 && move.rate === 1
        ? { state: 'inStep' }
        : { state: 'moved', offset: move.offset, rate: move.rate };
    }
    if (appliedMove || sureMove) {
      if (viewersDrift(keptDrift)) return { state: 'yours' };
      if (decision?.left) return { state: decision.left };
      if (sureMove) return { state: 'checking' };
    }
    if (aligner.pending(fileUrl)) return { state: 'checking' };
    if (fileRecord) return { state: fileRecord.final ? 'unmatched' : 'checking' };
    if (reference) return { state: 'checking' };
    const coming = referenceComing(
      { text: streamText, engine, streamTimings },
      fileOption?.lang ?? null,
      {
        offered: options,
        fits: fitsByLink,
        checks,
        broken: (url) => failedLinks.has(url) || checks.failed(url),
        video: playingRelease(entry, videoId),
      },
    );
    return { state: coming ? 'checking' : 'unchecked' };
  })();

  /**
   * Whether a file reads as in step with the video, for its row: lined up for sure, and, showing,
   * its lines moved there; not showing, no drift fix of the viewer's own kept for it, which would
   * leave its lines as the file has them. Not the reference itself, which nothing checked: its
   * row says what is known of it, linked to the video or the same release.
   */
  const syncedFile = (option: SubtitleOption, showing: boolean): boolean => {
    if (isReference(option.url)) return false;
    if (syncedOf(alignments.get(option.url)) !== 'sure') return false;
    if (showing) return sync?.state === 'moved' || sync?.state === 'inStep';
    if (!entry) return false;
    const key = subtitleFileKey(videoId, fileIdentity({ kind: 'file', key: option.key }, entry));
    return !viewersDrift(subtitleDrifts.get(key) ?? null);
  };

  /**
   * The viewer moved the timing or chose a drift fix of the automatic choice showing: it is
   * theirs now. Nothing takes over from it, and its lines show at once. Set on lines the player
   * has not moved yet, they are not moved on this stream.
   */
  const keepShowing = () => {
    if (fileUrl !== null && !decision) {
      if (touched.current.entry !== entry) touched.current = { entry, links: new Set() };
      touched.current.links.add(fileUrl);
    }
    const made = decided.current;
    if (made?.entry !== entry || !made.auto) return;
    decided.current = { ...made, auto: false };
    auto.current = { entry, holding: false, switches: 0 };
    setHoldingFor(null);
  };

  const rawCues = trackId === null ? (fileFailed || holding ? null : fileCues) : trackCues;
  // Moved or stretched once per file and fix, so the subtitle layer's index is built once too.
  const cues = useMemo(
    () =>
      rawCues === null
        ? null
        : move
          ? moveCues(rawCues, move)
          : (stretchCues(rawCues, drift) as Cue[]),
    [rawCues, drift, move],
  );

  return {
    options,
    tracks,
    pending,
    choice,
    cues,
    loading: fileKey !== null && (fileCues === null || holding) && !fileFailed,
    failed: fileFailed,
    offset: timing.offset,
    drift,
    autoDrift,
    stretched,
    canFixDrift,
    sync,
    statusOf(version) {
      const showing =
        version.kind === 'file'
          ? choice?.kind === 'file' && choice.key === version.key
          : choice?.kind === 'track' && choice.id === version.id;
      if (version.kind === 'track') {
        // Until the stream hands over its first line. Android hands each line over as it shows
        // (or draws picture subtitles itself), so a quiet stretch is not loading.
        const drawnByPlayer = state.engine === 'android';
        return showing && !drawnByPlayer && state.streamCues[version.id] === undefined
          ? 'loading'
          : undefined;
      }
      const option = options.find((o) => o.key === version.key);
      if (!option) return undefined;
      if (failedLinks.has(option.url)) return 'failed';
      return showing && (fileCues === null || holding) ? 'loading' : undefined;
    },
    checkOf(version) {
      if (version.kind !== 'file') return undefined;
      const option = options.find((o) => o.key === version.key);
      if (!option) return undefined;
      const fit = fitOf(option);
      // Its name or its addon says it is for another episode: that is known before it is read.
      const episode = otherEpisode(option, playingRelease(entry, videoId));
      if (!fit) return episode ? { hearing: false, problem: 'episode' } : undefined;
      const showing = choice?.kind === 'file' && choice.key === version.key;
      const problem =
        fit.script === 'wrong'
          ? 'script'
          : fit.signs
            ? 'signs'
            : episode
              ? 'episode'
              : fit.length === 'short' || fit.length === 'long'
                ? fit.length
                : undefined;
      const check: SubtitleCheck = { hearing: fit.hearing };
      if (problem) check.problem = problem;
      if (fit.drift) check.drift = fit.drift;
      if (showing && autoDrift) check.autoDrift = true;
      if (syncedFile(option, showing)) check.synced = true;
      return check;
    },
    isRemembered(version) {
      return !!entry && version.kind === 'file' && rememberedIn(options, entry) === version.key;
    },
    wantsHearing() {
      const pickRelease = entry ? pickReleaseOf(entry) : null;
      return pickRelease ? subtitlePicks.wantsHearing(metaId!, pickRelease) : false;
    },
    choose(next, way = 'version') {
      // The version already showing, pressed again, changes nothing: it stays as it was chosen,
      // and is not kept for the release. One that could not be read is tried again.
      if (sameChoice(next, choice) && !fileFailed) return;
      // A version picked before and still loading is given up on: it is not kept.
      handPicked.current = null;
      if (next?.kind === 'file') {
        const option = options.find((o) => o.key === next.key);
        if (option && broken.current.has(option.url)) markBroken(option.url, false);
      }
      const language = languageOf(next, options, tracks);
      // A language turned on from the sheet is the viewer's, but its version is chosen here,
      // with the same reads, hold and switches as at the start of a stream. Not for Lab streams,
      // which remember no language, nor BannerTV Demo's checks: theirs stays as picked.
      const pressed =
        way === 'language' &&
        next !== null &&
        language !== null &&
        metaId !== undefined &&
        !isSubtitleCheck(entry);
      if (pressed) {
        decided.current = { entry, choice: next, auto: true, wanted: language, language };
        auto.current = { entry, holding: next.kind === 'file', switches: 0 };
        setHoldingFor(next.kind === 'file' ? entry : null);
        // A file's reason is the plan's, as it is planned again below.
        if (next.kind === 'track') traceReason(videoId, 'own track', language, true);
      } else {
        decided.current = { entry, choice: next, auto: false };
        auto.current = { entry, holding: false, switches: 0 };
        setHoldingFor(null);
        traceReason(videoId, next === null ? 'off' : 'by hand', language);
      }
      setChosen({ entry, choice: next });
      if (isSubtitleCheck(entry)) return;
      chooseSubtitleLanguage(metaId, language);
      if (pressed) wake.current?.();
      // A version picked from the list is the one for this release; the stream's own track
      // picked over it takes its place. Not for Lab streams, which remember nothing. Picking a
      // language keeps no version.
      if (way !== 'version' || metaId === undefined || !entry) return;
      const pickRelease = subtitleRelease(entry, videoId);
      if (next?.kind === 'file')
        handPicked.current = { entry, key: next.key, release: pickRelease };
      else if (next?.kind === 'track') void subtitlePicks.forget(metaId, pickRelease);
    },
    setOffset(next) {
      // The timing already in use, set again (Reset at +0.0 s), changes nothing.
      if (offsetKey === null || next === timing.offset) return;
      keepShowing();
      // Moving the timing of a file with no drift choice of the viewer's keeps 'auto' beside it:
      // the player's fix is worked out from each stream's own evidence, so the lines stay
      // stretched as they see them, and another release whose length shows a drift is still
      // fixed. Kept first: both are saved in the order asked, so the lines never show for a
      // moment without it. Not for the stream's own track: no length of it shows a drift.
      const keep =
        trackId === null
          ? driftKeptWithTiming(
              { canFix: canFixDrift, evidence, kept: keptDrift, offset, aligned: appliedMove },
              next,
            )
          : null;
      if (keep !== null) void subtitleDrifts.remember(offsetKey, keep);
      void subtitleOffsets.remember(offsetKey, next);
    },
    setDrift(next) {
      if (offsetKey === null) return;
      // The fix already in use, pressed again, is kept as it was: the player's own stays its own,
      // worked out on each stream, and is not made a fixed drift for the file on every release.
      // Lines a move stretched to another rate than the two fixes show none of them in use.
      if (next === driftShown) return;
      keepShowing();
      // No fix is kept where the file's length shows a drift, or the player moved its lines on
      // this stream: the player does not fix it again, and a drift choice of the viewer's means
      // no move at all.
      const keepNone = next === null && (evidence !== null || appliedMove !== null);
      void subtitleDrifts.remember(offsetKey, keepNone ? 'none' : next);
    },
  };
}
