import {
  BANNERTV_DEMO_ID,
  type Cue,
  languageKey,
  type StreamEntry,
  subtitleFileKey,
} from '@bannertv/core';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { addonCollection } from '../../data/addons';
import { subtitleDrifts, subtitleOffsets } from '../../data/library';
import { chooseSubtitleLanguage, wantedSubtitle } from '../../data/tracks';
import { streamTitle } from '../../player/describe';
import { stretchCues, type SubtitleDrift } from '../../player/drift';
import type { EngineTrack } from '../../player/engines/types';
import type { PlaybackSession, SessionState } from '../../player/session';
import { matchesRelease, pickSubtitleFile, type PlayingRelease } from '../../player/subtitle-pick';
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
  /**
   * Whether a drift fix applies. Not to a track Android hands over line by line as the video
   * plays: it is in step with the video, and its last line has no end to stretch yet.
   */
  canFixDrift: boolean;
  /** The viewer chose; their choice becomes the language picked next time. */
  choose(choice: SubtitleChoice): void;
  /** Moves the subtitles showing later or earlier, remembered for that file. */
  setOffset(offset: number): void;
  /** Stretches the subtitles showing onto the video's frame rate, remembered for that file. */
  setDrift(drift: SubtitleDrift | null): void;
  statusOf(choice: NonNullable<SubtitleChoice>): SubtitleStatus | undefined;
}

const EMPTY: SubtitleListState = { options: [], pending: 0 };
const noop = () => () => undefined;

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

/** The release playing, as subtitle files are matched against it. */
function releaseOf(entry: StreamEntry | null): PlayingRelease {
  return entry ? { filename: entry.stream.behaviorHints.filename, title: streamTitle(entry) } : {};
}

/**
 * Which subtitles show, and their cues. For each stream it picks the language
 * last chosen: the stream's own track in that language first (always in
 * sync), then the addon file made for the release playing, then the first
 * addon file. A file made for the release that arrives after another was
 * picked takes over, unless the viewer chose. If a file cannot be read, the
 * next one in the same language is tried.
 */
export function useSubtitles(
  type: string,
  videoId: string,
  /** The title, whose last subtitle choice comes first; undefined for Lab streams. */
  metaId: string | undefined,
  entry: StreamEntry | null,
  session: PlaybackSession | null,
  state: SessionState,
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

  // The choice belongs to one stream: another stream starts with none until the next decision.
  const [chosen, setChosen] = useState<{ entry: StreamEntry | null; choice: SubtitleChoice }>({
    entry: null,
    choice: null,
  });
  const choice = chosen.entry === entry ? chosen.choice : null;
  // Kept by link, not key: two streams' own files can share a key.
  const [loaded, setLoaded] = useState<{ url: string; cues: Cue[] } | null>(null);
  const [failedChoice, setFailedChoice] = useState<SubtitleChoice>(null);
  // The start-of-stream choice and the stream it was made for; the viewer's own choice also
  // counts. auto: made here, not by the viewer, so a track listed later may still take over.
  const decided = useRef<{
    entry: StreamEntry | null;
    choice: SubtitleChoice;
    auto: boolean;
  } | null>(null);
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
  const release = useMemo(() => releaseOf(entry), [entry]);

  // The start-of-stream choice, once the stream's tracks and the addons have had their say.
  useEffect(() => {
    if (!entry || !session || !list) return;
    let stopped = false;
    const settle = (next: SubtitleChoice) => {
      decided.current = { entry, choice: next, auto: true };
      setChosen({ entry, choice: next });
    };
    const decide = () => {
      if (stopped) return;
      const { text, status, engine } = session.get();
      // hls.js and Shaka list the stream's tracks before its first picture; the
      // TV's player never lists any.
      const tracksKnown = status === 'playing' || status === 'paused' || engine === 'native';
      const made = decided.current;
      const wanted = isSubtitleCheck(entry) ? null : wantedSubtitle(metaId);
      const { options: offered, pending: waiting } = list.get();
      if (made?.entry === entry) {
        // A track that left with its engine (hls.js handing the stream to the
        // TV's player) gives way to a file.
        const chosenTrack = made.choice;
        const lost =
          chosenTrack?.kind === 'track' &&
          tracksKnown &&
          !text.some((t) => t.id === chosenTrack.id);
        // A file or Off picked while the TV's player listed no tracks gives way
        // to the stream's own track once another engine (hls.js) lists one.
        const better =
          made.auto &&
          chosenTrack?.kind !== 'track' &&
          wanted !== null &&
          text.some((t) => languageKey(t.lang) === languageKey(wanted));
        // A file picked before a slower addon answered gives way to one made for
        // this release: a file made for another release drifts against the sound.
        let matching = false;
        if (made.auto && chosenTrack?.kind === 'file' && wanted !== null) {
          const current = offered.find((o) => o.key === chosenTrack.key);
          const best = pickSubtitleFile(offered, wanted, broken.current, release);
          matching =
            !!current &&
            !!best &&
            best.key !== current.key &&
            !matchesRelease(current, release) &&
            matchesRelease(best, release);
        }
        if (!lost && !better && !matching) return;
      }
      if (wanted === null) {
        settle(null);
        return;
      }
      const key = languageKey(wanted);
      const track = text.find((t) => languageKey(t.lang) === key);
      if (track) {
        settle({ kind: 'track', id: track.id });
        return;
      }
      // Addon files often arrive first, but the stream's own track wins once listed.
      // One that failed earlier for this video only when it is all there is.
      const file =
        pickSubtitleFile(offered, wanted, broken.current, release) ??
        offered.find((o) => languageKey(o.lang) === key);
      if (file && tracksKnown) settle({ kind: 'file', key: file.key });
      else if (tracksKnown && waiting === 0) settle(null);
    };
    const stopList = list.subscribe(decide);
    const stopSession = session.subscribe(decide);
    // Both may already hold enough to decide.
    void Promise.resolve().then(decide);
    return () => {
      stopped = true;
      stopList();
      stopSession();
    };
  }, [entry, session, list, metaId, release]);

  // Load the chosen file, moving to the next in its language if it fails.
  useEffect(() => {
    if (!choice || choice.kind !== 'file') return;
    const option = options.find((o) => o.key === choice.key);
    if (!option) return;
    let cancelled = false;
    let stopWaiting: (() => void) | undefined;
    // Unless the viewer has chosen something else meanwhile.
    const moveTo = (next: SubtitleOption) =>
      setChosen((current) =>
        current.choice === choice
          ? { entry: current.entry, choice: { kind: 'file', key: next.key } }
          : current,
      );
    loadSubtitles(option).then(
      (cues) => {
        // A file that failed once and reads now is no longer marked.
        if (broken.current.has(option.url)) markBroken(option.url, false);
        if (!cancelled) setLoaded({ url: option.url, cues });
      },
      () => {
        if (cancelled) return;
        markBroken(option.url, true);
        // The one made for this release first, then the next in the language.
        const nextIn = (offered: readonly SubtitleOption[]) =>
          pickSubtitleFile(offered, option.lang, broken.current, release);
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

  // The stream's own tracks: tell the engine, and read the cues it hands over.
  const trackId = choice?.kind === 'track' ? choice.id : null;
  useEffect(() => {
    session?.selectText(trackId);
  }, [session, trackId]);
  const trackCues = trackId === null ? null : (state.streamCues[trackId] ?? []);

  // The timing and drift fix kept for the file showing.
  const offsetKey = choice && entry ? subtitleFileKey(videoId, fileIdentity(choice, entry)) : null;
  const offset = useSyncExternalStore(subtitleOffsets.subscribe, () =>
    offsetKey === null ? 0 : (subtitleOffsets.get(offsetKey) ?? 0),
  );
  const keptDrift = useSyncExternalStore(subtitleDrifts.subscribe, () =>
    offsetKey === null ? null : (subtitleDrifts.get(offsetKey) ?? null),
  );
  const canFixDrift = !(trackId !== null && state.engine === 'android');
  const drift = canFixDrift ? keptDrift : null;

  const rawCues = trackId === null ? (fileFailed ? null : fileCues) : trackCues;
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
    loading: fileKey !== null && fileCues === null && !fileFailed,
    failed: fileFailed,
    offset,
    drift,
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
      return showing && fileCues === null ? 'loading' : undefined;
    },
    choose(next) {
      decided.current = { entry, choice: next, auto: false };
      setChosen({ entry, choice: next });
      if (next?.kind === 'file') {
        const option = options.find((o) => o.key === next.key);
        if (option && broken.current.has(option.url)) markBroken(option.url, false);
      }
      if (!isSubtitleCheck(entry)) {
        chooseSubtitleLanguage(metaId, languageOf(next, options, tracks));
      }
    },
    setOffset(next) {
      if (offsetKey !== null) void subtitleOffsets.remember(offsetKey, next);
    },
    setDrift(next) {
      if (offsetKey !== null) void subtitleDrifts.remember(offsetKey, next);
    },
  };
}
