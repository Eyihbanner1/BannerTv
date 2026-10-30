import {
  findBingeStream,
  languageKey,
  languageName,
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
import { createPortal, flushSync } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { back, type EventPlay, remembersPlace, replace } from '../../app/router';
import { useScreenFocus } from '../../app/use-screen-focus';
import { Artwork } from '../../components/Artwork';
import { Menu } from '../../components/Menu';
import { addonClient } from '../../data/addons';
import { playedVideos, progress } from '../../data/playback';
import { preferences } from '../../data/preferences';
import { chooseAudioLanguage, wantedAudio } from '../../data/tracks';
import { useQuery } from '../../data/use-query';
import { markActivity } from '../../navigation/activity';
import { KeyCode } from '../../navigation/keys';
import { answeredOk, clickCameWithOk } from '../../navigation/ok-click';
import { focusedKey } from '../../navigation/spatial';
import { useBack } from '../../navigation/use-back';
import { inputMode } from '../../platform/input-mode';
import { headlineBadges, resolutionLabel } from '../../player/describe';
import type { EngineTrack } from '../../player/engines/types';
import { entryKey, holdProbing, streamFinder } from '../../player/finder';
import { formatTime } from '../../player/media';
import {
  createPlaybackSession,
  INITIAL_SESSION_STATE,
  type PlaybackSession,
} from '../../player/session';
import { type PlayerAction, PlayerControls } from './PlayerControls';
import { PlayerProblem } from './PlayerProblem';
import { SubtitleLayer } from './SubtitleLayer';
import { SubtitleStylePanel } from './SubtitleStylePanel';
import { TracksPanel } from './TracksPanel';
import { UpNext } from './UpNext';
import { useScrobble } from './use-scrobble';
import { type Subtitles, useSubtitles } from './use-subtitles';
import styles from './PlayerScreen.module.css';

/** Controls hide after this long without a key press, while playing. */
const CONTROLS_HIDE_MS = 5000;
/** A skip lands this long after the last press. */
const SCRUB_COMMIT_MS = 800;
/** The note for a skip made with the controls hidden stays this long after it lands. */
const SKIP_NOTE_MS = 1500;
/** The wheel counts at most one notch this often, as it moves one row a notch elsewhere. */
const WHEEL_STEP_MS = 150;
/** Start over offers to go back to where the viewer was for this long. */
const UNDO_MS = 8000;
/** Start over this close to the start has nothing worth going back to. */
const UNDO_FROM_S = 10;
/** Back this soon after the controls hid by themselves was meant for them: it asks again. */
const BACK_AFTER_HIDE_MS = 2000;
/** How long "Press Back again to leave" shows. */
const LEAVE_HINT_MS = 3000;
/** What the pointer can press in the player; anywhere else is the picture. */
const CONTROL = '[role="button"], [role="slider"]';
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

/** The language of the subtitles showing, for the Audio & subtitles chip; none when off. */
function subtitleValue(subtitles: Subtitles): string | undefined {
  const { choice } = subtitles;
  if (!choice) return undefined;
  if (choice.kind === 'track') {
    const track = subtitles.tracks.find((candidate) => candidate.id === choice.id);
    return (track?.lang && languageName(track.lang)) || track?.label || undefined;
  }
  const option = subtitles.options.find((candidate) => candidate.key === choice.key);
  return option ? languageName(option.lang) || undefined : undefined;
}

/** A skip's total, such as "+30 s" or "−1:30". */
function formatSkip(seconds: number): string {
  const amount = Math.abs(Math.round(seconds));
  const sign = seconds < 0 ? '−' : '+';
  return amount < 60 ? `${sign}${amount} s` : `${sign}${formatTime(amount)}`;
}

/**
 * Full-screen playback. On open it picks the best stream that works on this
 * TV (or plays the one chosen in All streams), resumes where the viewer left
 * off, and moves to another stream at the same moment if one stalls.
 *
 * Remote: OK pauses and shows the controls; Left, Right, Fast forward and
 * Rewind skip 10 s a press, with a small note while the controls are hidden;
 * Up, Down and the wheel show the controls; Back hides them, then leaves.
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
  // Whether it rests on a control, whose OK is that control's; elsewhere it is the picture's.
  const pointerOnControl = useRef(false);
  // Whether the wheel has moved focus since the pointer last moved: OK is then the focused control's.
  const wheelMovedFocus = useRef(false);
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
  // The controls wait to hide while the Up Next card is open (they give way to
  // it, and focus stays on the card), behind a panel, and while Start over
  // offers to go back.
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
  // Whether the controls show. Up Next takes the bottom of the screen and focus
  // while it shows: the controls give way and come back when it goes.
  const chrome = controls && !waiting && !showUpNext;

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
    // A broadcast has no bar to skip along (Fast forward and Rewind jump at once, below).
    if (!session || waiting || state.live) return;
    const current = scrub.current;
    const origin = current ? current.origin : (session.trustedPosition() ?? state.position);
    const from = current ? current.target : origin;
    const wanted = Math.max(0, from + direction * skipStep(repeats));
    // A film whose file gives no length is only kept from going before its start.
    const target = state.duration > 0 ? Math.min(state.duration - 1, wanted) : wanted;
    if (current) clearTimeout(current.timer);
    const timer = window.setTimeout(commitScrub, SCRUB_COMMIT_MS);
    scrub.current = { origin, target, timer };
    setScrubTo(target);
    if (chrome && !panel) {
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
      case KeyCode.Rewind: {
        heldSkip.current = event.repeat ? heldSkip.current + 1 : 0;
        const direction = event.keyCode === KeyCode.FastForward ? 1 : -1;
        if (state.live && session && !waiting) {
          // Within what the broadcast keeps, and the controls show where that is.
          const at = session.trustedPosition() ?? state.position;
          session.seek(at + direction * skipStep(heldSkip.current));
          show();
        } else scrubBy(direction, heldSkip.current);
        break;
      }
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
    const target = event.target instanceof Element ? event.target : null;
    pointerOnChrome.current = target?.closest('[data-player-chrome]') != null;
    pointerOnControl.current = target?.closest(CONTROL) != null;
    if (event.movementX === 0 && event.movementY === 0) return;
    wheelMovedFocus.current = false;
    // Behind the problem box, or while a stream opens, the controls would not show.
    if (problem || waiting) return;
    if (!controls) show();
    else armHide();
  };

  // The wheel never skips (Eyitayo, 30 October 2026). With the controls hidden
  // a notch shows them, on Pause, as Up and Down do. Otherwise it moves between
  // rows, as everywhere else, and keeps the controls up.
  const onWheel = (event: WheelEvent) => {
    if (event.deltaY === 0 || panel || problem || showUpNext) return;
    const now = Date.now();
    const at = focusedKey();
    // Brought up by the pointer, the controls leave focus on the picture: a notch takes it to Pause.
    if (chrome && at !== 'player-surface') {
      // The rest of the roll that brought them up would move on from Pause.
      if (now - lastWheel.current < WHEEL_STEP_MS) {
        event.stopPropagation();
        return;
      }
      armHide();
      // Up stops at the bar, as the arrow does: the back arrow above it is the pointer's.
      if (event.deltaY < 0 && at === 'player-seek') event.stopPropagation();
      else wheelMovedFocus.current = true;
      return;
    }
    // The notch is spent bringing them up, not on moving on from Pause as well.
    event.stopPropagation();
    // While a stream starts they would show without a picture.
    if (waiting || now - lastWheel.current < WHEEL_STEP_MS) return;
    lastWheel.current = now;
    markActivity();
    wheelMovedFocus.current = true;
    // Shown before focus lands, or the TV's own focus (which Audio Guidance reads) stays put.
    flushSync(() => setControls(true));
    show('player-play');
  };

  // A click on the picture shows the controls, or hides them. A click on a
  // control is that control's.
  const picturePressable = () => !problem && !waiting && !panel && !showUpNext;
  function pressPicture() {
    if (controls) hide();
    else show('player-play');
  }
  const onPictureClick = (event: MouseEvent) => {
    if (clickCameWithOk()) return;
    if (event.target instanceof Element && event.target.closest(CONTROL)) return;
    if (picturePressable()) pressPicture();
  };

  // The Magic Remote OK can come as a key press as well as a click. With the
  // pointer on the picture it is the picture's, before the control that kept
  // focus takes it: Pause, or Sources, which would leave. A skip under way
  // lands on it, as OK lands one everywhere else.
  const onOkFirst = useRef<(event: KeyboardEvent) => void>(() => undefined);
  onOkFirst.current = (event) => {
    if (event.keyCode !== KeyCode.Ok || inputMode.get() !== 'pointer') return;
    // A control the pointer rests on is the picture while the controls are hidden.
    if (chrome && (pointerOnControl.current || wheelMovedFocus.current)) return;
    if (!picturePressable()) return;
    event.preventDefault();
    event.stopPropagation();
    answeredOk();
    if (event.repeat) return;
    if (commitScrub()) armHide();
    else pressPicture();
  };
  useEffect(() => {
    const listener = (event: KeyboardEvent) => onOkFirst.current(event);
    window.addEventListener('keydown', listener, true);
    return () => window.removeEventListener('keydown', listener, true);
  }, []);

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
    // Up Next, showing from this render, has focus: the controls wait behind it.
    if (wanted || state.status === 'paused') show(showUpNext ? undefined : 'player-play');
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
  const facts = state.entry ? headlineBadges(state.entry.facts) : [];
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

  // Two tiers with fixed places: nothing comes or goes while the video plays.
  // What can't be used now stays, dimmed, and says why when focused.
  function skipButton(direction: -1 | 1) {
    if (!session || waiting) return;
    if (state.live) {
      // As Rewind on a broadcast: at once, within what it keeps.
      const at = session.trustedPosition() ?? state.position;
      session.seek(at + direction * skipStep(0));
      armHide();
    } else scrubBy(direction);
  }
  const showsPause = state.status !== 'paused' && state.status !== 'ended';
  function noNextReason(): string {
    if (!meta) return t('player.noEpisodeList');
    // The next one listed, aired or not.
    return nextVideo(meta, videoId, Infinity) ? t('player.nextNotOut') : t('player.lastEpisode');
  }
  const transport: (PlayerAction | null)[] = [
    {
      focusKey: 'player-restart',
      icon: 'start',
      label: undo !== null ? t('player.backTo', { time: formatTime(undo) }) : t('player.startOver'),
      // A broadcast's clock begins wherever it was joined.
      unavailable: state.live ? t('player.liveNoStart') : undefined,
      onPress: startOver,
    },
    {
      focusKey: 'player-back10',
      icon: 'back10',
      label: t('player.back10'),
      onPress: () => skipButton(-1),
    },
    {
      focusKey: 'player-play',
      icon: showsPause ? 'pause' : 'play',
      label: showsPause ? t('player.pause') : t('player.play'),
      onPress: () => session?.togglePlay(),
    },
    {
      focusKey: 'player-fwd10',
      icon: 'fwd10',
      label: t('player.forward10'),
      onPress: () => skipButton(1),
    },
    // Anything with an episode list has a place for it, whatever its type,
    // kept while the list loads.
    metaQuery && !state.live && (!meta || episode)
      ? {
          focusKey: 'player-next',
          icon: 'next',
          label: t('player.nextEpisode'),
          unavailable: offersNext ? undefined : noNextReason(),
          onPress: playNextEpisode,
        }
      : null,
  ];

  // What Quality found to choose from, which may not be what plays: a stream
  // picked in All streams can be one it left out.
  const onlyChoice = choices.length === 1 ? resolutionLabel(choices[0]?.resolution) : undefined;
  const tools: PlayerAction[] = [
    {
      focusKey: 'player-tracks-button',
      icon: 'subs',
      label: t('player.audioAndSubtitles'),
      value: subtitleValue(subtitles) ?? t('player.subtitlesOffValue'),
      colourKey: 'blue',
      onPress: () => openTracks('player-tracks-button'),
    },
    {
      focusKey: 'player-quality-button',
      icon: 'quality',
      label: t('player.quality'),
      value: resolutionLabel(state.entry?.facts.resolution),
      unavailable:
        choices.length > 1
          ? undefined
          : onlyChoice
            ? t('player.onlyQuality', { quality: onlyChoice })
            : t('player.noOtherQuality'),
      onPress: () => openPanel('quality', 'player-quality-button'),
    },
  ];
  if (!props.lab) {
    tools.push({
      focusKey: 'player-streams-button',
      icon: 'sources',
      label: t('player.sources'),
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

  const chooseAudio = (track: EngineTrack) => {
    session?.selectAudio(track.id);
    if (track.lang) chooseAudioLanguage(props.lab ? undefined : metaId, track.lang);
  };

  return (
    <section
      className={styles.player}
      aria-label={title}
      onMouseMove={onPointer}
      onWheel={onWheel}
      onClick={onPictureClick}
    >
      {createPortal(<video ref={videoRef} className={styles.video} />, document.body)}
      <SubtitleLayer
        video={video}
        cues={subtitles.cues}
        offset={subtitles.offset}
        look={look}
        raised={chrome}
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
      {skipNote && (!chrome || panel) && (
        <>
          <div className={styles.skipNote} role="status">
            <p className={styles.skipTotal}>{formatSkip(skipNote.delta)}</p>
            {state.duration > 0 && (
              <p className={styles.skipWhere}>
                {t('player.skipWhere', {
                  time: formatTime(skipNote.target),
                  length: formatTime(state.duration),
                })}
              </p>
            )}
          </div>
          {state.duration > 0 && (
            <div className={styles.skipBar}>
              <div
                className={styles.skipPlayed}
                style={{ width: `${Math.min(1, skipNote.target / state.duration) * 100}%` }}
              />
            </div>
          )}
        </>
      )}

      <PlayerControls
        visible={chrome}
        title={title}
        subtitle={subtitle}
        facts={facts}
        live={state.live}
        position={state.position}
        duration={state.duration}
        scrubTo={scrubTo}
        transport={transport}
        tools={tools}
        onScrub={scrubBy}
        onCommit={() => {
          // OK on the bar lands a skip at once; with none under way it plays or pauses.
          if (!commitScrub()) session?.togglePlay();
          armHide();
        }}
        onSeekTo={seekTo}
        onLeave={back}
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
