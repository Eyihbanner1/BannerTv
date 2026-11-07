import {
  BANNERTV_DEMO_ID,
  type Cue,
  type DriftChoice,
  judgeSubtitleFit,
  languageKey,
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
import { streamTitle } from '../../player/describe';
import {
  driftInUse,
  driftKeptWithTiming,
  stretchCues,
  type SubtitleDrift,
} from '../../player/drift';
import type { EngineTrack } from '../../player/engines/types';
import type { PlaybackSession, SessionState } from '../../player/session';
import { createSubtitleChecks } from '../../player/subtitle-checks';
import {
  filesIn,
  fitsIn,
  MAX_EXTRA_CHECKS,
  type PickContext,
  pickSubtitleFile,
  planSubtitlePick,
  type SubtitlePlan,
} from '../../player/subtitle-pick';
import { playingRelease } from '../../player/subtitle-versions';
import {
  loadSubtitles,
  subtitleList,
  type SubtitleListState,
  type SubtitleOption,
} from '../../player/subtitles';

/** A subtitle file from an addon, or one of the stream's own tracks (HLS through hls.js). */
export type SubtitleChoice = { kind: 'file'; key: string } | { kind: 'track'; id: string } | null;

/** A version's state for its row: its first line still to come, or a file that could not be read. */
export type SubtitleStatus = 'loading' | 'failed';

/** What reading a file found, for its row: only for files read so far. */
export interface SubtitleCheck {
  /** For the hard of hearing: sounds and speakers' names among the lines. */
  hearing: boolean;
  /**
   * Why it fits the video badly: its text is in another script, it holds
   * signs only, it covers only part of the video, or it runs well past its end.
   */
  problem?: 'script' | 'signs' | 'short' | 'long';
  /** The version showing, whose drift the player fixed by itself. */
  autoDrift?: boolean;
}

/** How the viewer chose: a version from a language's list, or a language (its first version). */
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
   * The viewer chose; their choice becomes the language picked next time. A version picked
   * from a language's list is also kept for the release playing, and tried first next time.
   */
  choose(choice: SubtitleChoice, way?: ChoiceWay): void;
  /** Moves the subtitles showing later or earlier, remembered for that file. */
  setOffset(offset: number): void;
  /** Stretches the subtitles showing onto the video's frame rate, remembered for that file. */
  setDrift(drift: SubtitleDrift | null): void;
  statusOf(choice: NonNullable<SubtitleChoice>): SubtitleStatus | undefined;
  /** What reading the file found, once it has been read; undefined for the stream's tracks. */
  checkOf(choice: NonNullable<SubtitleChoice>): SubtitleCheck | undefined;
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
 * then the stream's own track in that language (always in sync), then the
 * addon file that fits best. The first few files are read before one shows
 * (for at most HOLD_MS after the first is read): one in another script or of
 * signs only is passed over, and a full plain file that lasts as long as the
 * video wins (`planSubtitlePick`). A file that fits clearly better, read
 * later, takes over soon after, at most twice; one made for the release that
 * arrives later takes over too. Never when the viewer chose. If a file cannot
 * be read, the next one in the same language is tried.
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
  useEffect(() => {
    if (!list) return;
    list.start();
    return () => list.stop();
  }, [list]);

  // Files read for their checks, for this video: the screen is made again for another.
  const [checks] = useState(() => createSubtitleChecks(loadSubtitles));
  const profiles = useSyncExternalStore(checks.subscribe, checks.profiles);

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
  } | null>(null);
  const auto = useRef<AutoState>({ entry: null, holding: false, switches: 0 });
  // Files read for their checks in each language of this video, by link.
  const checkedIn = useRef(new Map<string, Set<string>>());
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
    const pickRelease =
      metaId !== undefined && !isSubtitleCheck(stream) ? subtitleRelease(stream, videoId) : null;
    const pickedFile = pickRelease ? subtitlePicks.get(metaId!, pickRelease)?.file : undefined;
    const remembered = pickedFile
      ? offered.find((option) => fileKeyOf(option.key, stream) === pickedFile)?.key
      : undefined;
    return {
      video: playingRelease(stream),
      broken: (url) => broken.current.has(url) || checks.failed(url),
      fit: (url) => fits.get(url),
      remembered,
      hearing: pickRelease ? subtitlePicks.wantsHearing(metaId!, pickRelease) : false,
    };
  };

  // The start-of-stream choice, once the stream's tracks and the addons have had their say,
  // and the automatic file choice planned again as the files are read.
  useEffect(() => {
    if (!entry || !session || !list) return;
    let stopped = false;
    // The language wanted at the latest look, kept with an automatic choice.
    let wantedNow: string | null = null;
    // Ends the hold once its time is up.
    let timer: number | undefined;
    const settle = (next: SubtitleChoice, remembered = false) => {
      decided.current = { entry, choice: next, auto: true, wanted: wantedNow, remembered };
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
    ): SubtitlePlan<SubtitleOption> => {
      const standing = auto.current;
      const playing = session.get();
      const now = Date.now();
      const language = languageKey(wanted);
      const checked = checkedIn.current.get(language) ?? new Set<string>();
      checkedIn.current.set(language, checked);
      if (
        standing.holding &&
        standing.firstReadAt === undefined &&
        filesIn(offered, wanted).some((option) => checks.profile(option.url))
      ) {
        standing.firstReadAt = now;
      }
      if (standing.holding && standing.firstReadAt !== undefined && timer === undefined) {
        timer = window.setTimeout(
          () => {
            timer = undefined;
            decide();
          },
          Math.max(0, standing.firstReadAt + HOLD_MS - now) + 20,
        );
      }
      const result = planSubtitlePick({
        ...context,
        offered,
        language: wanted,
        reading: checks.reading,
        current,
        holding: standing.holding,
        timeUp: standing.firstReadAt !== undefined && now - standing.firstReadAt >= HOLD_MS,
        lengthPending: !playing.live && !(playing.duration > 0),
        readsLeft: MAX_EXTRA_CHECKS + 1 - checked.size,
        switchesLeft:
          standing.shownAt !== undefined && now - standing.shownAt < EARLY_MS
            ? MAX_SWITCHES - standing.switches
            : 0,
      });
      for (const file of result.read) {
        checked.add(file.url);
        checks.read(file).catch(() => {
          if (!stopped) markBroken(file.url, true);
        });
      }
      if (result.switched) standing.switches++;
      setHolding(result.hold);
      if (result.pick && result.pick.key !== current) {
        settle({ kind: 'file', key: result.pick.key });
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
      const wanted = isSubtitleCheck(entry)
        ? null
        : wantedSubtitle(metaId, heardLanguages(audio, entry));
      wantedNow = wanted;
      const { options: offered, pending: waiting } = list.get();
      const length = videoLength(playing.duration, playing.live, runtimeSeconds);
      const context = wanted === null ? null : contextIn(offered, wanted, entry, length);
      if (made?.entry === entry) {
        // A track that left with its engine (hls.js handing the stream to the
        // TV's player) gives way to a file.
        const chosenTrack = made.choice;
        const lost =
          chosenTrack?.kind === 'track' &&
          tracksKnown &&
          !text.some((t) => t.id === chosenTrack.id);
        // A file or Off picked while the TV's player listed no tracks gives way
        // to the stream's own track once another engine (hls.js) lists one,
        // unless it is the version picked by hand for this release.
        const better =
          made.auto &&
          !made.remembered &&
          chosenTrack?.kind !== 'track' &&
          wanted !== null &&
          text.some((t) => languageKey(t.lang) === languageKey(wanted));
        // "Only when the audio isn't in that language", once the audio's language is known.
        const heardOther = made.auto && made.wanted !== undefined && made.wanted !== wanted;
        if (!lost && !better && !heardOther) {
          // The automatic file choice, planned again as files are read or more addons answer:
          // the one made for this release, or one that fits clearly better, takes over.
          if (made.auto && chosenTrack?.kind === 'file' && context && wanted !== null) {
            if (auto.current.entry !== entry) {
              auto.current = { entry, holding: false, switches: 0, shownAt: Date.now() };
            }
            plan(offered, wanted, context, chosenTrack.key);
          }
          return;
        }
      }
      if (wanted === null || !context) {
        startAuto(false);
        settle(null);
        return;
      }
      const key = languageKey(wanted);
      // The version picked by hand for this release comes first, even before the stream's track.
      const picked = offered.find(
        (o) =>
          o.key === context.remembered && languageKey(o.lang) === key && !context.broken(o.url),
      );
      if (picked && tracksKnown) {
        startAuto(false);
        settle({ kind: 'file', key: picked.key }, true);
        return;
      }
      const track = text.find((t) => languageKey(t.lang) === key);
      if (track) {
        startAuto(false);
        settle({ kind: 'track', id: track.id });
        return;
      }
      // Addon files often arrive first, but the stream's own track wins once listed.
      if (!tracksKnown) return;
      startAuto(true);
      const result = plan(offered, wanted, context, undefined);
      if (!result.pick && waiting === 0) {
        setHolding(false);
        settle(null);
      }
    };
    // The session tells of every step of the clock; only what the choice weighs counts.
    let seen: SessionState | undefined;
    const onSession = () => {
      const now = session.get();
      if (
        seen &&
        now.text === seen.text &&
        now.audio === seen.audio &&
        now.status === seen.status &&
        now.engine === seen.engine &&
        now.duration === seen.duration &&
        now.live === seen.live
      ) {
        return;
      }
      seen = now;
      decide();
    };
    const stopList = list.subscribe(decide);
    const stopSession = session.subscribe(onSession);
    const stopChecks = checks.subscribe(decide);
    // Both may already hold enough to decide.
    void Promise.resolve().then(decide);
    return () => {
      stopped = true;
      if (timer !== undefined) clearTimeout(timer);
      stopList();
      stopSession();
      stopChecks();
    };
    // contextIn and fileKeyOf read only what these name, and refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry, session, list, metaId, runtimeSeconds, videoId, checks]);

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
    checks.read(option).then(
      (cues) => {
        // A file that failed once and reads now is no longer marked.
        if (broken.current.has(option.url)) markBroken(option.url, false);
        // A version picked by hand is kept for the release once it reads, with whether it
        // was for the hard of hearing: picking one asks for them.
        const picked = handPicked.current;
        if (picked && picked.entry === entry && picked.key === option.key && metaId !== undefined) {
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

  // The stream's own tracks: tell the engine, and read the cues it hands over.
  const trackId = choice?.kind === 'track' ? choice.id : null;
  useEffect(() => {
    session?.selectText(trackId);
  }, [session, trackId]);
  const trackCues = trackId === null ? null : (state.streamCues[trackId] ?? []);

  // What reading each file found, judged against the video and the others in its language.
  const fits = useMemo(() => {
    const length = videoLength(duration, live, runtimeSeconds);
    const byLanguage = new Map<string, Map<string, SubtitleFit>>();
    for (const option of options) {
      const key = languageKey(option.lang);
      if (byLanguage.has(key) || !profiles.has(option.url)) continue;
      byLanguage.set(
        key,
        fitsIn(options, option.lang, (url) => profiles.get(url), length),
      );
    }
    return byLanguage;
  }, [options, profiles, duration, live, runtimeSeconds]);
  const fitOf = (option: SubtitleOption) => fits.get(languageKey(option.lang))?.get(option.url);

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
  const inUse = driftInUse({ canFix: canFixDrift, evidence, kept: keptDrift, offset });
  const { drift, auto: autoDrift } = inUse;

  const rawCues = trackId === null ? (fileFailed || holding ? null : fileCues) : trackCues;
  // Stretched once per file and fix, so the subtitle layer's index is built once too.
  const cues = useMemo(
    () => (rawCues === null ? null : (stretchCues(rawCues, drift) as Cue[])),
    [rawCues, drift],
  );

  return {
    options,
    tracks,
    pending,
    choice,
    cues,
    loading: fileKey !== null && (fileCues === null || holding) && !fileFailed,
    failed: fileFailed,
    offset,
    drift,
    autoDrift,
    canFixDrift,
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
      if (!fit) return undefined;
      const showing = choice?.kind === 'file' && choice.key === version.key;
      const problem =
        fit.script === 'wrong'
          ? 'script'
          : fit.signs
            ? 'signs'
            : fit.length === 'short' || fit.length === 'long'
              ? fit.length
              : undefined;
      const check: SubtitleCheck = { hearing: fit.hearing };
      if (problem) check.problem = problem;
      if (showing && autoDrift) check.autoDrift = true;
      return check;
    },
    choose(next, way = 'version') {
      decided.current = { entry, choice: next, auto: false };
      auto.current = { entry, holding: false, switches: 0 };
      setHoldingFor(null);
      setChosen({ entry, choice: next });
      if (next?.kind === 'file') {
        const option = options.find((o) => o.key === next.key);
        if (option && broken.current.has(option.url)) markBroken(option.url, false);
      }
      if (isSubtitleCheck(entry)) return;
      chooseSubtitleLanguage(metaId, languageOf(next, options, tracks));
      // A version picked from the list is the one for this release; the stream's own track
      // picked over it takes its place. Not for Lab streams, which remember nothing.
      if (way !== 'version' || metaId === undefined || !entry) return;
      const pickRelease = subtitleRelease(entry, videoId);
      if (next?.kind === 'file')
        handPicked.current = { entry, key: next.key, release: pickRelease };
      else if (next?.kind === 'track') {
        handPicked.current = null;
        void subtitlePicks.forget(metaId, pickRelease);
      }
    },
    setOffset(next) {
      if (offsetKey === null) return;
      // Moving the timing of a file whose drift the player fixed keeps that fix as the viewer's,
      // so the lines stay stretched as they see them. Kept first: both are saved in the order
      // asked, so the lines never show for a moment without it.
      const keep = driftKeptWithTiming(inUse, next);
      if (keep !== null) void subtitleDrifts.remember(offsetKey, keep);
      void subtitleOffsets.remember(offsetKey, next);
    },
    setDrift(next) {
      if (offsetKey === null) return;
      // No fix, where the file's length shows a drift, is kept: the player does not fix it again.
      void subtitleDrifts.remember(offsetKey, next === null && evidence !== null ? 'none' : next);
    },
  };
}
