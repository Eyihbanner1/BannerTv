import {
  BANNERTV_DEMO_ID,
  type Cue,
  languageKey,
  type StreamEntry,
  subtitleFileKey,
} from '@bannertv/core';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { addonCollection } from '../../data/addons';
import { subtitleOffsets } from '../../data/library';
import { chooseSubtitleLanguage, wantedSubtitle } from '../../data/tracks';
import { streamTitle } from '../../player/describe';
import type { EngineTrack } from '../../player/engines/types';
import type { PlaybackSession, SessionState } from '../../player/session';
import {
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

export interface Subtitles {
  options: SubtitleOption[];
  tracks: EngineTrack[];
  /** Addons still looking for subtitles. */
  pending: number;
  choice: SubtitleChoice;
  /** What to draw, or null when off or still loading. */
  cues: Cue[] | null;
  loading: boolean;
  /** The chosen file could not be read, nor any other in its language. */
  failed: boolean;
  /** Seconds; positive shows subtitles later. Kept for each file. */
  offset: number;
  /** The viewer chose; their choice becomes the language picked next time. */
  choose(choice: SubtitleChoice): void;
  /** Moves the subtitles showing later or earlier, remembered for that file. */
  setOffset(offset: number): void;
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

/**
 * Which subtitles show, and their cues. For each stream it picks the language
 * last chosen: the stream's own track in that language first (always in
 * sync), then the first addon file. If a file cannot be read, the next one in
 * the same language is tried.
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
  // Counts the changes to `broken`, so a decision can tell whether it has changed.
  const brokenChanges = useRef(0);
  const [failedLinks, setFailedLinks] = useState<ReadonlySet<string>>(() => new Set());
  const markBroken = (url: string, failed: boolean) => {
    if (failed) broken.current.add(url);
    else broken.current.delete(url);
    brokenChanges.current++;
    setFailedLinks(new Set(broken.current));
  };
  const { options, pending } = listState;
  const tracks = state.text;

  // The start-of-stream choice, once the stream's tracks and the addons have had their say.
  useEffect(() => {
    if (!entry || !session || !list) return;
    let stopped = false;
    // The session tells of every clock reading, which changes nothing a decision reads.
    const nothingNew = sameAsLast();
    const settle = (next: SubtitleChoice) => {
      decided.current = { entry, choice: next, auto: true };
      setChosen({ entry, choice: next });
    };
    const decide = () => {
      if (stopped) return;
      const { text, status, engine } = session.get();
      const listed = list.get();
      const made = decided.current;
      const wanted = isSubtitleCheck(entry) ? null : wantedSubtitle(metaId);
      if (nothingNew([text, status, engine, listed, made, wanted, brokenChanges.current])) return;
      // hls.js and Shaka list the stream's tracks before its first picture; the
      // TV's player never lists any.
      const tracksKnown = status === 'playing' || status === 'paused' || engine === 'native';
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
        if (!lost && !better) return;
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
      const { options: offered, pending: waiting } = listed;
      // One that failed earlier for this video only when it is all there is.
      const inLanguage = offered.filter((o) => languageKey(o.lang) === key);
      const file = inLanguage.find((o) => !broken.current.has(o.url)) ?? inLanguage[0];
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
  }, [entry, session, list, metaId]);

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
        const key = languageKey(option.lang);
        const nextIn = (offered: readonly SubtitleOption[]) =>
          offered.find((o) => languageKey(o.lang) === key && !broken.current.has(o.url));
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

  // The timing kept for the file showing.
  const offsetKey = choice && entry ? subtitleFileKey(videoId, fileIdentity(choice, entry)) : null;
  const offset = useSyncExternalStore(subtitleOffsets.subscribe, () =>
    offsetKey === null ? 0 : (subtitleOffsets.get(offsetKey) ?? 0),
  );

  return {
    options,
    tracks,
    pending,
    choice,
    cues: trackId === null ? (fileFailed ? null : fileCues) : trackCues,
    loading: fileKey !== null && fileCues === null && !fileFailed,
    failed: fileFailed,
    offset,
    statusOf(version) {
      const showing =
        version.kind === 'file'
          ? choice?.kind === 'file' && choice.key === version.key
          : choice?.kind === 'track' && choice.id === version.id;
      if (version.kind === 'track') {
        // Until the stream hands over its first line. Android draws its own and hands over none.
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
  };
}
