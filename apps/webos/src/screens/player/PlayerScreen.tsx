import {
  findBingeStream,
  languageKey,
  nextVideo,
  parseRuntime,
  playedCard,
  qualityChoices,
  type StreamEntry,
} from '@bannertv/core';
import type { MetaPreview } from '@bannertv/protocol';
import { setFocus, useFocusable } from '@noriginmedia/norigin-spatial-navigation';
import {
  type MouseEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type WheelEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { back, type EventPlay, remembersPlace, replace } from '../../app/router';
import { useScreenFocus } from '../../app/use-screen-focus';
import { Artwork } from '../../components/Artwork';
import { Menu } from '../../components/Menu';
import { addonClient, addonCollection } from '../../data/addons';
import { playedVideos, progress } from '../../data/playback';
import { preferences } from '../../data/preferences';
import { chooseAudioLanguage, wantedAudio } from '../../data/tracks';
import { useQuery } from '../../data/use-query';
import { markActivity } from '../../navigation/activity';
import { KeyCode } from '../../navigation/keys';
import { useBack } from '../../navigation/use-back';
import { inputMode } from '../../platform/input-mode';
import { resolutionLabel, streamBadges } from '../../player/describe';
import type { EngineTrack } from '../../player/engines/types';
import { entryKey, holdProbing, streamFinder } from '../../player/finder';
import { formatTime } from '../../player/media';
import {
  createPlaybackSession,
  INITIAL_SESSION_STATE,
  type PlaybackSession,
} from '../../player/session';
import { type ControlButton, PlayerControls } from './PlayerControls';
import { PlayerProblem } from './PlayerProblem';
import { SubtitleLayer } from './SubtitleLayer';
import { SubtitleStylePanel } from './SubtitleStylePanel';
import { TracksPanel } from './TracksPanel';
import { UpNext } from './UpNext';
import { useScrobble } from './use-scrobble';
import { useSubtitles } from './use-subtitles';
import styles from './PlayerScreen.module.css';

/** Controls hide after this long without a key press, while playing. */
const CONTROLS_HIDE_MS = 5000;
/** A skip lands this long after the last press. */
const SCRUB_COMMIT_MS = 800;
/** The note for a skip made with the controls hidden stays this long after it lands. */
const SKIP_NOTE_MS = 1500;
/** The wheel skips at most one notch this often, as it moves one row elsewhere. */
const WHEEL_STEP_MS = 150;
/** Start over offers to go back to where the viewer was for this long. */
const UNDO_MS = 8000;
/** Start over this close to the start has nothing worth going back to. */
const UNDO_FROM_S = 10;
/** Back this soon after the controls hid by themselves was meant for them: it asks again. */
const BACK_AFTER_HIDE_MS = 2000;
/** How long "Press Back again to leave" shows. */
const LEAVE_HINT_MS = 3000;
/** The Up Next card shows this long before the end. */
const UP_NEXT_BEFORE_END_S = 30;
/** The next episode's streams are asked for this long before the end. */
const NEXT_STREAMS_BEFORE_END_S = 120;

type Panel = 'tracks' | 'style' | 'quality' | null;

interface PlayerScreenProps {
  type: string;
  metaId: string;
  videoId: string;
  preview?: MetaPreview;
  stream?: StreamEntry;
  chosen?: boolean;
  startAt?: number;
  lab?: boolean;
  /** A sports event: its own sources only, and no Continue Watching card. */
  event?: EventPlay;
}

const noop = () => () => undefined;
const initial = () => INITIAL_SESSION_STATE;

/**
 * How far one press skips: 10 s, the same for every way of skipping. A key
 * held down repeats, and goes further the longer it is held.
 */
function skipStep(repeats: number): number {
  if (repeats > 12) return 60;
  if (repeats > 4) return 30;
  return 10;
}

/** A skip's total, such as "+30 s" or "−1:30". */
function formatSkip(seconds: number): string {
  const amount = Math.abs(Math.round(seconds));
  const sign = seconds < 0 ? '−' : '+';
  return amount < 60 ? `${sign}${amount} s` : `${sign}${formatTime(amount)}`;
}

function addonName(addonId: string): string {
  const addon = addonCollection.get().addons.find((a) => a.manifest.id === addonId);
  return addon?.manifest.name ?? addonId;
}

/**
 * Full-screen playback. On open it picks the best stream that works on this
 * TV (or plays the one chosen in All streams), resumes where the viewer left
 * off, and moves to another stream at the same moment if one stalls.
 *
 * Remote: OK pauses and shows the controls; Left, Right, the wheel, Fast
 * forward and Rewind skip 10 s a press, with a small note while the controls
 * are hidden; Up and Down show the controls; Back hides them, then leaves.
 * Play, Pause and Stop work at any time, and Blue opens and closes audio and
 * subtitles.
 */
export function PlayerScreen(props: PlayerScreenProps) {
  const { type, metaId, videoId, preview } = props;
  const { t } = useTranslation();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  const sportsEvent = props.event;
  const finder = useMemo(
    () => streamFinder(type, videoId, sportsEvent),
    [type, videoId, sportsEvent],
  );
  const [session, setSession] = useState<PlaybackSession | null>(null);
  const [nothing, setNothing] = useState(false);
  const [resumedAt, setResumedAt] = useState(0);
  const state = useSyncExternalStore(
    session ? session.subscribe : noop,
    session ? session.get : initial,
  );
  const finderState = useSyncExternalStore(finder.subscribe, finder.get);
  const look = useSyncExternalStore(preferences.subscribe, () => preferences.get().subtitleStyle);

  const [controls, setControls] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  const [panelFrom, setPanelFrom] = useState('player-play');
  // Audio and subtitles open on the subtitle playing, or on Style when coming back from it.
  const [tracksFocus, setTracksFocus] = useState<'choice' | 'style'>('choice');
  const [scrubTo, setScrubTo] = useState<number | null>(null);
  // A skip in progress: where it began, where it will land, and the timer that lands it.
  const scrub = useRef<{ origin: number; target: number; timer: number } | null>(null);
  const [skipNote, setSkipNote] = useState<{ delta: number; target: number } | null>(null);
  const noteTimer = useRef<number | undefined>(undefined);
  // How many times Fast forward or Rewind has repeated while held down.
  const heldSkip = useRef(0);
  const lastWheel = useRef(0);
  const hideTimer = useRef<number | undefined>(undefined);
  // Whether the Magic Remote pointer rests on the title or the bar, which keeps them up.
  const pointerOnChrome = useRef(false);
  const lastAutoHide = useRef(0);
  const [leaveHint, setLeaveHint] = useState(false);
  const leaveTimer = useRef<number | undefined>(undefined);
  // Where Start over left from, while it offers to go back there.
  const [undo, setUndo] = useState<number | null>(null);
  const undoTimer = useRef<number | undefined>(undefined);
  // The stream a Quality choice opened, and its quality, for the note while it opens.
  const [switching, setSwitching] = useState<{ entry: StreamEntry; label?: string } | null>(null);
  // OK pressed while the stream was starting: the controls show once it plays.
  const wantsControls = useRef(false);
  const [upNextDismissed, setUpNextDismissed] = useState(false);

  // A sports event's page comes from the addon that listed it, never another one.
  const metaQuery = useMemo(
    () => (type === 'movie' || sportsEvent ? null : addonClient.meta(type, metaId)),
    [type, metaId, sportsEvent],
  );
  const meta = useQuery(metaQuery).data;
  const item = meta ?? preview;
  const episode = meta?.videos.find((v) => v.id === videoId);
  const next = useMemo(
    () => (meta ? nextVideo(meta, videoId, Date.now()) : undefined),
    [meta, videoId],
  );
  // Up Next: the last 30 seconds of an episode, or its end. Never during a live broadcast.
  const offersNext = !!next && !state.live;
  const remaining = state.duration > 0 ? state.duration - state.position : Infinity;
  const showUpNext =
    offersNext &&
    !upNextDismissed &&
    !panel &&
    (state.status === 'ended' || (remaining <= UP_NEXT_BEFORE_END_S && state.status === 'playing'));
  // While the Up Next card is open, the controls stay and focus stays on the card.
  // Nor do they hide behind a panel, or while Start over offers to go back.
  const upNextOpen = useRef(showUpNext);
  const panelOpen = useRef(false);
  const offeringUndo = useRef(false);
  useEffect(() => {
    upNextOpen.current = showUpNext;
    panelOpen.current = panel !== null;
    offeringUndo.current = undo !== null;
  });
  const waiting = !nothing && (state.status === 'idle' || state.status === 'loading');
  const problem = nothing || state.status === 'failed';

  const subtitles = useSubtitles(
    type,
    videoId,
    props.lab ? undefined : metaId,
    state.entry,
    session,
    state,
  );

  useScrobble(session, state, { type, metaId, videoId, lab: props.lab }, finder.runtimeSeconds);

  // Once the video plays, Home's Continue Watching gets its name, artwork and
  // episode: again when the series' episode list arrives or changes, never for
  // the Lab or a live broadcast. The card keeps the ids the progress is saved under.
  // Never for sports either, replays included: the row would ask every addon
  // with the id's prefix for its page, not the one that listed it. Their
  // progress is marked to stay off the row too (continueRow below).
  const playing = state.status === 'playing';
  const live = state.live;
  const recorded = useRef<string | null>(null);
  useEffect(() => {
    if (props.lab || sportsEvent || !playing || live || !item) return;
    const card = playedCard(item, videoId, meta, { metaId, type });
    const prior = meta ? undefined : playedVideos.get(videoId);
    if (prior && prior.metaId === metaId) {
      // Until the episode list arrives, keep the episode an earlier card knew.
      if (prior.season !== undefined) card.season = prior.season;
      if (prior.episode !== undefined) card.episode = prior.episode;
      if (prior.episodeName !== undefined) card.episodeName = prior.episodeName;
      if (prior.next) card.next = prior.next;
    }
    const key = [
      videoId,
      meta ? 'meta' : 'preview',
      card.season,
      card.episode,
      card.next?.videoId,
      card.next?.name,
      card.next?.released,
    ].join('|');
    if (recorded.current === key) return;
    recorded.current = key;
    playedVideos.record(card);
  }, [props.lab, sportsEvent, playing, live, item, meta, videoId, metaId, type]);

  // The running time tells a heavy file from a long one, for auto-play's ranking.
  const runtime = item?.runtime;
  useEffect(() => finder.setRuntime(parseRuntime(runtime)), [finder, runtime]);

  // Open: free the decoder from any link test, then pick and start a stream.
  useEffect(() => {
    const element = videoRef.current;
    if (!element) return;
    setVideo(element);
    const releaseProbing = holdProbing();
    // A sports match saves nothing and never resumes; a replay keeps its place
    // like any other video, but never goes on Continue Watching.
    const remember = remembersPlace(props);
    const created = createPlaybackSession({
      video: element,
      type,
      metaId,
      videoId,
      finder,
      autoFailover: !props.chosen,
      remember,
      continueRow: !sportsEvent,
    });
    setSession(created);
    if (!props.lab) finder.start();
    let cancelled = false;
    void progress
      .load()
      .catch(() => undefined)
      .then(async () => {
        if (cancelled) return;
        const start = props.startAt ?? (remember ? progress.resumeAt(videoId) : 0) ?? 0;
        setResumedAt(start);
        const entry = props.stream ?? (await finder.choose());
        if (cancelled) return;
        if (entry) created.play(entry, start);
        else setNothing(true);
      });
    return () => {
      cancelled = true;
      created.destroy();
      releaseProbing();
    };
    // One session per video: the screen remounts for another episode.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Paused and saved when the TV goes to another app or the home screen.
  useEffect(() => {
    if (!session) return;
    const onVisibility = () => {
      if (!document.hidden) {
        // Back again: the controls show, with Play ready unless a panel is open.
        if (session.get().status === 'paused') {
          setControls(true);
          if (!panel) void setFocus('player-play');
        }
        return;
      }
      session.pause();
      session.saveProgress();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [session, panel]);

  // The audio language chosen last time, once per stream.
  const audioDecided = useRef<string | null>(null);
  useEffect(() => {
    const entry = state.entry;
    if (!session || !entry || state.audio.length < 2) return;
    const key = entryKey(entry);
    if (audioDecided.current === key) return;
    audioDecided.current = key;
    const wanted = wantedAudio(props.lab ? undefined : metaId);
    if (!wanted) return;
    const match = state.audio.find((track) => languageKey(track.lang) === languageKey(wanted));
    if (match && !match.active) session.selectAudio(match.id);
  }, [session, state.entry, state.audio, props.lab, metaId]);

  // Controls.
  function armHide() {
    clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      if (session?.get().status !== 'playing' || upNextOpen.current || panelOpen.current) return;
      if ((pointerOnChrome.current && inputMode.get() === 'pointer') || offeringUndo.current) {
        armHide();
        return;
      }
      hide();
      lastAutoHide.current = Date.now();
    }, CONTROLS_HIDE_MS);
  }
  function show(focusKey?: string) {
    setControls(true);
    // Back after these controls is meant for them, whatever hid them before.
    lastAutoHide.current = 0;
    if (focusKey) void setFocus(focusKey);
    armHide();
  }
  function hide() {
    clearTimeout(hideTimer.current);
    setControls(false);
    void setFocus('player-surface');
  }
  useEffect(
    () => () => {
      clearTimeout(hideTimer.current);
      clearTimeout(noteTimer.current);
      clearTimeout(leaveTimer.current);
      clearTimeout(undoTimer.current);
    },
    [],
  );
  // Paused, buffering, failed or offering the next episode: the controls stay up.
  useEffect(() => {
    if (controls && !panel && !showUpNext && state.status === 'playing') armHide();
    else clearTimeout(hideTimer.current);
    // armHide only reads refs and the session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controls, panel, state.status, showUpNext]);

  /**
   * One press of a skip: each adds to a total that lands once, a moment after
   * the last. `repeats`: how often the key has repeated while held down. With
   * the controls hidden, or behind a panel, a small note shows the total and
   * the controls stay away.
   */
  function scrubBy(direction: -1 | 1, repeats = 0) {
    if (!session || state.duration <= 0 || waiting) return;
    const current = scrub.current;
    const origin = current ? current.origin : (session.trustedPosition() ?? state.position);
    const from = current ? current.target : origin;
    const target = Math.max(0, Math.min(state.duration - 1, from + direction * skipStep(repeats)));
    if (current) clearTimeout(current.timer);
    const timer = window.setTimeout(commitScrub, SCRUB_COMMIT_MS);
    scrub.current = { origin, target, timer };
    setScrubTo(target);
    if (controls && !panel) {
      armHide();
      return;
    }
    clearTimeout(noteTimer.current);
    setSkipNote({ delta: target - origin, target });
    noteTimer.current = window.setTimeout(() => setSkipNote(null), SCRUB_COMMIT_MS + SKIP_NOTE_MS);
  }
  /** Lands the skip in progress at once. False when there is none. */
  function commitScrub(): boolean {
    const current = scrub.current;
    if (!current) return false;
    clearTimeout(current.timer);
    scrub.current = null;
    setScrubTo(null);
    session?.seek(current.target);
    return true;
  }
  function cancelScrub(): boolean {
    if (!scrub.current) return false;
    clearTimeout(scrub.current.timer);
    scrub.current = null;
    setScrubTo(null);
    clearTimeout(noteTimer.current);
    setSkipNote(null);
    return true;
  }
  useEffect(() => () => void cancelScrub(), []);

  /** A click on the bar: straight there, whatever skip was in progress. */
  function seekTo(seconds: number) {
    cancelScrub();
    session?.seek(seconds);
    armHide();
  }

  /** Start over goes back to 0:00, then for a few seconds offers to go back to where it was. */
  function startOver() {
    // Until a stream opened paused has its length, a seek would only be undone by its own start.
    if (!session || !video || video.readyState < HTMLMediaElement.HAVE_METADATA) return;
    // A skip still to land would undo it.
    cancelScrub();
    clearTimeout(undoTimer.current);
    if (undo !== null) {
      session.seek(undo);
      setUndo(null);
      return;
    }
    const from = session.trustedPosition() ?? state.position;
    session.seek(0);
    if (from < UNDO_FROM_S) return;
    setUndo(from);
    undoTimer.current = window.setTimeout(() => setUndo(null), UNDO_MS);
  }

  function showLeaveHint() {
    clearTimeout(leaveTimer.current);
    setLeaveHint(true);
    leaveTimer.current = window.setTimeout(() => setLeaveHint(false), LEAVE_HINT_MS);
  }

  function openPanel(which: Panel, from: string) {
    setPanelFrom(from);
    setPanel(which);
  }
  function openTracks(from: string) {
    setTracksFocus('choice');
    openPanel('tracks', from);
  }

  // The surface holds focus while the controls are hidden, and turns keys into player actions.
  // While a stream starts there is nothing to skip, and the controls would show without a picture.
  const surface = useFocusable<object, HTMLDivElement>({
    focusKey: 'player-surface',
    onArrowPress: (direction, _props, details) => {
      if (waiting) return false;
      if (direction === 'left' || direction === 'right') {
        scrubBy(direction === 'left' ? -1 : 1, (details.pressedKeys[direction] ?? 1) - 1);
      } else show('player-play');
      return false;
    },
    onEnterPress: () => {
      // OK leaves a starting stream to start: the controls show once it plays.
      if (waiting) {
        wantsControls.current = true;
        return;
      }
      if (commitScrub()) return;
      session?.togglePlay();
      show('player-play');
    },
  });
  useScreenFocus('player-surface');

  // Transport keys work everywhere in the player, panels included.
  const onKey = useRef<(event: KeyboardEvent) => void>(() => undefined);
  onKey.current = (event) => {
    if (controls && !panel) armHide();
    // Behind the problem box only Stop reaches the player; the box has its own ways on.
    if (problem && event.keyCode !== KeyCode.Stop) return;
    switch (event.keyCode) {
      case KeyCode.Play:
        session?.resume();
        break;
      case KeyCode.Pause:
        session?.pause();
        show();
        break;
      case KeyCode.Stop:
        back();
        break;
      case KeyCode.FastForward:
      case KeyCode.Rewind:
        heldSkip.current = event.repeat ? heldSkip.current + 1 : 0;
        scrubBy(event.keyCode === KeyCode.FastForward ? 1 : -1, heldSkip.current);
        break;
      case KeyCode.Blue:
        // Held down, it would open and close the panel over and over.
        if (event.repeat) break;
        if (panel === 'tracks' || panel === 'style') setPanel(null);
        else openTracks(controls ? 'player-tracks-button' : 'player-surface');
        break;
      default:
        return;
    }
    event.preventDefault();
  };
  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKey.current(event);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);

  useBack('screen', () => {
    if (cancelScrub()) return true;
    // Not while a stream opens: the controls do not show then, and Back leaves.
    if (controls && !waiting) {
      hide();
      return true;
    }
    // Just after the controls hid by themselves, Back was most likely meant for them.
    if (Date.now() - lastAutoHide.current < BACK_AFTER_HIDE_MS) {
      lastAutoHide.current = 0;
      showLeaveHint();
      return true;
    }
    return false;
  });

  // The Magic Remote pointer brings the controls up, like a mouse over a web player,
  // and they stay while it rests on the title or the bar (until an arrow hides
  // it: the hide timer checks inputMode). Chromium also sends moves of no
  // distance when the picture changes under a still pointer: they only say
  // what the pointer rests on.
  const onPointer = (event: MouseEvent) => {
    pointerOnChrome.current =
      event.target instanceof Element && event.target.closest('[data-player-chrome]') !== null;
    // Behind the problem box, or while a stream opens, the controls would not show.
    if (problem || waiting || (event.movementX === 0 && event.movementY === 0)) return;
    if (!controls) show();
    else armHide();
  };

  // With the controls hidden the wheel skips, a notch at a time. Otherwise it
  // moves between rows, as everywhere else, and keeps the controls up.
  const onWheel = (event: WheelEvent) => {
    if (controls || panel || problem || waiting || event.deltaY === 0) {
      if (controls && !panel) armHide();
      return;
    }
    event.stopPropagation();
    const now = Date.now();
    if (now - lastWheel.current < WHEEL_STEP_MS) return;
    lastWheel.current = now;
    markActivity();
    scrubBy(event.deltaY > 0 ? 1 : -1);
  };

  // While another stream opens (Quality, or one after a failure) the controls
  // give way, so no hidden button takes the remote. Once it shows, they come
  // back if OK asked for them while it started, if it opened paused, or if
  // Play started a stream paused before its first picture.
  const wasWaiting = useRef(waiting);
  const lastStatus = useRef(state.status);
  useEffect(() => {
    if (waiting === wasWaiting.current) return;
    wasWaiting.current = waiting;
    if (waiting) {
      if (controls && lastStatus.current === 'paused') wantsControls.current = true;
      if (controls && !panel) hide();
      return;
    }
    const wanted = wantsControls.current;
    wantsControls.current = false;
    if (problem || panel) return;
    if (wanted || state.status === 'paused') show('player-play');
    // Only the change of waiting matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waiting]);
  // After the effect above, so it reads the status before this render's.
  useEffect(() => {
    lastStatus.current = state.status;
  });
  // The Quality note lasts as long as that switch: once the stream shows,
  // pauses, fails or gives way to another, it is over, and Try again is not one.
  useEffect(() => {
    if (!session || !switching) return;
    const over = () => {
      const { entry, status } = session.get();
      if (entry !== switching.entry || (status !== 'idle' && status !== 'loading')) {
        setSwitching(null);
      }
    };
    over();
    return session.subscribe(over);
  }, [session, switching]);
  // A panel closed while a stream opens (the player moved on to another
  // stream behind it) leaves the hidden controls behind: they give way too.
  useEffect(() => {
    if (waiting && controls && !panel) hide();
    // Only the panel closing matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panel]);

  // Up Next. The next episode's streams are asked for well before the card,
  // so reading them does not slow the countdown and the episode starts at once.
  const nearEnd = showUpNext || remaining <= NEXT_STREAMS_BEFORE_END_S;
  useEffect(() => {
    if (nearEnd && next) streamFinder(type, next.id).start();
  }, [nearEnd, next, type]);

  function playNextEpisode() {
    if (!next) return;
    session?.saveProgress();
    const nextFinder = streamFinder(type, next.id);
    const current = state.entry;
    let stream: StreamEntry | undefined;
    if (current) {
      // The same release group from the same addon, as Stremio's binge watching does.
      const same = nextFinder.get().entries.filter((e) => e.addonId === current.addonId);
      const found = findBingeStream(
        same.map((e) => e.stream),
        current.stream.behaviorHints.bingeGroup,
      );
      stream = same.find((e) => e.stream === found && e.assessment.action.kind === 'play');
    }
    replace({ name: 'player', type, metaId, videoId: next.id, preview, stream });
  }

  // When a film or a broadcast ends, or the viewer turned Up Next away, go back to the title's page.
  useEffect(() => {
    if (state.status === 'ended' && (!offersNext || upNextDismissed)) back();
  }, [state.status, offersNext, upNextDismissed]);

  // Quality.
  const choices = useMemo(() => qualityChoices(finderState.candidates), [finderState.candidates]);
  const currentQuality = state.entry?.facts.resolution ?? 'other';
  // Whether the Quality menu offers something smaller than what is playing.
  const lowerChoice = useMemo(() => {
    const index = choices.findIndex((c) => (c.resolution ?? 'other') === currentQuality);
    if (index < 0) return choices.length > 1;
    return choices.slice(index + 1).some((c) => c.resolution !== undefined);
  }, [choices, currentQuality]);

  // What the screen shows.
  const title = item?.name ?? '';
  const subtitle = episode
    ? [
        episode.season !== undefined && episode.episode !== undefined
          ? t('player.episodeNumber', { season: episode.season, episode: episode.episode })
          : undefined,
        episode.title,
      ]
        .filter(Boolean)
        .join(' · ')
    : undefined;
  const facts = state.entry
    ? streamBadges(state.entry.facts).concat(addonName(state.entry.addonId))
    : [];
  // One note at a time, the most useful first, so they never sit on top of each other.
  // Those about another stream last while it opens: one that opened paused, as
  // the film was, shows Play and nothing more.
  let toast: string | undefined;
  if (leaveHint) toast = t('player.pressBackAgain');
  else if (switching && waiting && state.entry === switching.entry) {
    toast = switching.label
      ? t('player.switchingTo', { quality: switching.label })
      : t('player.switchingStream');
  } else if (state.steppedDown && waiting) toast = t('player.steppingDown');
  else if (state.failedOver && waiting) toast = t('player.tryingAnother');
  else if (state.struggling && state.status === 'buffering') {
    // Only name a button that is there and would help.
    if (lowerChoice) toast = t('player.keepsBuffering');
    else if (!props.lab) toast = t('player.keepsBufferingStreams');
    else toast = t('player.keepsBufferingPlain');
  } else if (subtitles.failed && !waiting) toast = t('player.subtitlesFailed');

  const buttons: ControlButton[] = [
    {
      focusKey: 'player-play',
      label:
        state.status === 'paused' || state.status === 'ended'
          ? t('player.play')
          : t('player.pause'),
      onPress: () => session?.togglePlay(),
    },
    {
      focusKey: 'player-tracks-button',
      label: t('player.audioAndSubtitles'),
      onPress: () => openTracks('player-tracks-button'),
    },
  ];
  if (choices.length > 1) {
    buttons.push({
      focusKey: 'player-quality-button',
      label: t('player.quality'),
      onPress: () => openPanel('quality', 'player-quality-button'),
    });
  }
  if (!props.lab) {
    buttons.push({
      focusKey: 'player-streams-button',
      label: t('player.otherStreams'),
      onPress: () =>
        replace({
          name: 'streams',
          type,
          metaId,
          videoId,
          preview,
          // Before a stream has opened, where the viewer asked to start.
          startAt: session && state.entry ? session.carryOn() : resumedAt,
          event: sportsEvent,
        }),
    });
  }
  // Whenever there is a start to go back to: a broadcast's clock begins wherever it was joined.
  if (!state.live) {
    buttons.push({
      focusKey: 'player-restart',
      label: undo !== null ? t('player.backTo', { time: formatTime(undo) }) : t('player.startOver'),
      onPress: startOver,
    });
  }
  if (offersNext) {
    buttons.push({
      focusKey: 'player-next',
      label: t('player.nextEpisode'),
      onPress: playNextEpisode,
    });
  }

  const chooseAudio = (track: EngineTrack) => {
    session?.selectAudio(track.id);
    if (track.lang) chooseAudioLanguage(props.lab ? undefined : metaId, track.lang);
  };

  return (
    <section className={styles.player} aria-label={title} onMouseMove={onPointer} onWheel={onWheel}>
      {createPortal(<video ref={videoRef} className={styles.video} />, document.body)}
      <SubtitleLayer
        video={video}
        cues={subtitles.cues}
        offset={subtitles.offset}
        look={look}
        raised={controls}
      />
      <div
        ref={surface.ref}
        className={styles.surface}
        tabIndex={-1}
        data-focus-key="player-surface"
        data-focused={surface.focused ? 'true' : undefined}
      />

      {waiting && (
        <div className={styles.waiting} role="status" aria-label={t('player.starting')}>
          {item?.background && <Artwork src={item.background} className={styles.waitingArt} />}
          <div className={styles.shimmer} />
          <div className={styles.waitingTitle}>
            {item?.logo ? (
              <Artwork
                src={item.logo}
                className={styles.waitingLogo}
                fallback={<p className={styles.title}>{title}</p>}
              />
            ) : (
              <p className={styles.title}>{title}</p>
            )}
            {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
          </div>
        </div>
      )}
      {state.status === 'buffering' && (
        <div className={styles.spinner} role="status" aria-label={t('player.buffering')} />
      )}
      {toast && (
        <p className={styles.toast} role="status">
          {toast}
        </p>
      )}
      {skipNote && (!controls || panel) && state.duration > 0 && (
        <>
          <div className={styles.skipNote} role="status">
            <p className={styles.skipTotal}>{formatSkip(skipNote.delta)}</p>
            <p className={styles.skipWhere}>
              {t('player.skipWhere', {
                time: formatTime(skipNote.target),
                length: formatTime(state.duration),
              })}
            </p>
          </div>
          <div className={styles.skipBar}>
            <div
              className={styles.skipPlayed}
              style={{ width: `${Math.min(1, skipNote.target / state.duration) * 100}%` }}
            />
          </div>
        </>
      )}

      <PlayerControls
        visible={controls && !waiting}
        title={title}
        subtitle={subtitle}
        facts={facts}
        position={state.position}
        duration={state.duration}
        scrubTo={scrubTo}
        buttons={buttons}
        onScrub={scrubBy}
        onCommit={() => {
          // OK on the bar lands a skip at once; with none under way it plays or pauses.
          if (!commitScrub()) session?.togglePlay();
          armHide();
        }}
        onSeekTo={seekTo}
      />

      {showUpNext && next && (
        <UpNext
          video={next}
          returnFocusKey={controls ? 'player-play' : 'player-surface'}
          onPlay={playNextEpisode}
          onDismiss={() => setUpNextDismissed(true)}
        />
      )}

      {panel === 'tracks' && (
        <TracksPanel
          audio={state.audio}
          subtitles={subtitles}
          focusStyle={tracksFocus === 'style'}
          returnFocusKey={panelFrom}
          onAudio={chooseAudio}
          onStyle={() => setPanel('style')}
          onClose={() => setPanel(null)}
        />
      )}
      {/* Back from Style goes back to Audio and subtitles, on Style. */}
      {panel === 'style' && (
        <SubtitleStylePanel
          returnFocusKey={panelFrom}
          onClose={() => {
            setTracksFocus('style');
            setPanel('tracks');
          }}
        />
      )}
      {panel === 'quality' && (
        <Menu
          focusKey="player-quality"
          title={t('player.quality')}
          options={choices.map((choice) => ({
            value: choice.resolution ?? 'other',
            label: resolutionLabel(choice.resolution) ?? t('player.otherQuality'),
          }))}
          selected={currentQuality}
          returnFocusKey={panelFrom}
          onSelect={(value) => {
            setPanel(null);
            // The resolution already playing stays as it is, whichever stream at it is playing.
            if (value === currentQuality) return;
            const choice = choices.find((c) => (c.resolution ?? 'other') === value);
            if (session && choice) {
              // A paused film stays paused, and a note says what is coming.
              session.play(choice.entry, session.carryOn(), {
                chosen: true,
                paused: state.status === 'paused',
              });
              setSwitching({ entry: choice.entry, label: resolutionLabel(choice.resolution) });
            }
          }}
          onClose={() => setPanel(null)}
        />
      )}

      {problem && (
        <PlayerProblem
          nothing={nothing}
          error={state.error}
          failedAddons={finderState.failed.length}
          canTryAnother={!nothing && !!session && session.hasNext()}
          onTryAnother={() => session?.playNext()}
          onAllStreams={() =>
            replace({
              name: 'streams',
              type,
              metaId,
              videoId,
              preview,
              startAt: session && state.entry ? session.carryOn() : resumedAt,
              event: sportsEvent,
            })
          }
          onRetry={() => {
            if (nothing) {
              setNothing(false);
              finder.retry();
              void finder.choose().then((entry) => {
                if (entry) session?.play(entry, resumedAt);
                else setNothing(true);
              });
            } else if (state.entry) {
              session?.play(state.entry, session.carryOn());
            }
          }}
          onBack={back}
        />
      )}
    </section>
  );
}
