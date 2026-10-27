import { type Cue, languageKey, type StreamEntry } from '@bannertv/core';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { addonCollection } from '../../data/addons';
import { preferences, setPreference } from '../../data/preferences';
import type { EngineTrack } from '../../player/engines/types';
import type { PlaybackSession, SessionState } from '../../player/session';
import {
  loadSubtitles,
  subtitleList,
  type SubtitleListState,
  type SubtitleOption,
} from '../../player/subtitles';

/** A subtitle file from an addon, or one of the stream's own tracks (HLS through hls.js). */
export type SubtitleChoice = { kind: 'file'; key: string } | { kind: 'track'; id: string } | null;

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
  /** Seconds; positive shows subtitles later. */
  offset: number;
  /** The viewer chose; their choice becomes the language picked next time. */
  choose(choice: SubtitleChoice): void;
  setOffset(offset: number): void;
}

const EMPTY: SubtitleListState = { options: [], pending: 0 };
const noop = () => () => undefined;

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
  const [loaded, setLoaded] = useState<{ key: string; cues: Cue[] } | null>(null);
  const [failedChoice, setFailedChoice] = useState<SubtitleChoice>(null);
  const [offset, setOffset] = useState(0);
  // The stream the start-of-stream choice was made for; the viewer's own choice also counts.
  const decidedFor = useRef<StreamEntry | null>(null);
  // Files that failed for this video, so a retry moves on to another.
  const broken = useRef(new Set<string>());
  const { options, pending } = listState;
  const tracks = state.text;

  // The start-of-stream choice, once the stream's tracks and the addons have had their say.
  useEffect(() => {
    if (!entry || !session || !list) return;
    let stopped = false;
    const settle = (next: SubtitleChoice) => {
      decidedFor.current = entry;
      setChosen({ entry, choice: next });
    };
    const decide = () => {
      if (stopped || decidedFor.current === entry) return;
      const wanted = preferences.get().subtitleLanguage;
      if (wanted === null) {
        settle(null);
        return;
      }
      const key = languageKey(wanted);
      const { text, status } = session.get();
      const track = text.find((t) => languageKey(t.lang) === key);
      if (track) {
        settle({ kind: 'track', id: track.id });
        return;
      }
      // Stream tracks show up when playback starts; addon files may arrive before.
      const ready = status === 'playing' || status === 'paused';
      const { options: offered, pending: waiting } = list.get();
      const file = offered.find((o) => languageKey(o.lang) === key);
      if (file && (ready || waiting === 0)) settle({ kind: 'file', key: file.key });
      else if (ready && waiting === 0) settle(null);
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
  }, [entry, session, list]);

  // Load the chosen file, moving to the next in its language if it fails.
  useEffect(() => {
    if (!choice || choice.kind !== 'file') return;
    const option = options.find((o) => o.key === choice.key);
    if (!option) return;
    let cancelled = false;
    loadSubtitles(option).then(
      (cues) => {
        if (!cancelled) setLoaded({ key: option.key, cues });
      },
      () => {
        if (cancelled) return;
        broken.current.add(option.key);
        const key = languageKey(option.lang);
        const next = options.find((o) => languageKey(o.lang) === key && !broken.current.has(o.key));
        if (!next) {
          setFailedChoice(choice);
          return;
        }
        // Unless the viewer has chosen something else meanwhile.
        setChosen((current) =>
          current.choice === choice
            ? { entry: current.entry, choice: { kind: 'file', key: next.key } }
            : current,
        );
      },
    );
    return () => {
      cancelled = true;
    };
    // Only a new choice reloads; more options arriving do not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [choice]);

  const fileKey = choice?.kind === 'file' ? choice.key : null;
  const fileCues = fileKey !== null && loaded?.key === fileKey ? loaded.cues : null;
  const fileFailed = fileKey !== null && failedChoice === choice;

  // The stream's own tracks: tell the engine, and read the cues it hands over.
  const trackId = choice?.kind === 'track' ? choice.id : null;
  useEffect(() => {
    session?.selectText(trackId);
  }, [session, trackId]);
  const trackCues = trackId === null ? null : (state.streamCues[trackId] ?? []);

  return {
    options,
    tracks,
    pending,
    choice,
    cues: trackId === null ? fileCues : trackCues,
    loading: fileKey !== null && fileCues === null && !fileFailed,
    failed: fileFailed,
    offset,
    choose(next) {
      decidedFor.current = entry;
      setChosen({ entry, choice: next });
      if (next?.kind === 'file') broken.current.delete(next.key);
      setPreference('subtitleLanguage', languageOf(next, options, tracks));
    },
    setOffset,
  };
}
