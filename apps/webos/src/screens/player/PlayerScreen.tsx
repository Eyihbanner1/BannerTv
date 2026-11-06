import {
  addSleepTime,
  askStillWatching,
  bingeEntry,
  type BingeHint,
  bingeHint,
  endAction,
  inLastStretch,
  languageName,
  nextSleepCheck,
  nextVideo,
  parseRuntime,
  playedCard,
  type QualityReference,
  qualityChoices,
  rearms,
  secondsToEnd,
  skipAt,
  skipCardDone,
  skipKey,
  skipRearms,
  type SleepChoice,
  sleepPhase,
  SPEED_KINDS,
  speedKindOf,
  startSleep,
  stopsBeforeNext,
  type StreamEntry,
  UP_NEXT_AFTER_END_S,
} from '@bannertv/core';
import type { MetaPreview, Video } from '@bannertv/protocol';
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
import {
  back,
  type EventPlay,
  type PlayerRoute,
  remembersPlace,
  replace,
  topRoute,
} from '../../app/router';
import { useScreenFocus } from '../../app/use-screen-focus';
import { Artwork } from '../../components/Artwork';
import { Menu } from '../../components/Menu';
import { addonClient } from '../../data/addons';
import { playedVideos, progress, speedMemory } from '../../data/playback';
import { preferences } from '../../data/preferences';
import { useSkipSegments } from '../../data/skips';
import { chooseAudioLanguage, wantedAudio } from '../../data/tracks';
import { useQuery } from '../../data/use-query';
import { markActivity, sinceInput } from '../../navigation/activity';
import { KeyCode } from '../../navigation/keys';
import { answeredOk, clickCameWithOk, okWentDownOn } from '../../navigation/ok-click';
import { focusedKey, pressFocused } from '../../navigation/spatial';
import { useBack } from '../../navigation/use-back';
import { inputMode } from '../../platform/input-mode';
import { playTrailer } from '../../platform/youtube';
import { audioSwitch, pickAudio } from '../../player/audio';
import { headlineBadges, problemText, resolutionLabel } from '../../player/describe';
import type { EngineTrack } from '../../player/engines/types';
import { entryKey, holdProbing, isHeavy, streamFinder } from '../../player/finder';
import { playProblem } from '../../player/problem';
import { formatClock, formatTime, guessMimeType } from '../../player/media';
import {
  createPlaybackSession,
  INITIAL_SESSION_STATE,
  type PlaybackSession,
} from '../../player/session';
import {
  autoplaysSinceInput,
  countAutoplay,
  keepSleepTimer,
  leaveSleepTimer,
  SLEEP_OFF,
  sleepTimerFor,
} from '../../player/sleep';
import { EpisodesSheet } from './EpisodesSheet';
import { InfoSheet } from './InfoSheet';
import { type PlayerAction, PlayerControls } from './PlayerControls';
import { PlayerProblem } from './PlayerProblem';
import { SkipCard } from './SkipCard';
import { SleepScreen, SleepWarning } from './SleepTimer';
import { SourcesSheet } from './SourcesSheet';
import { StillWatching } from './StillWatching';
import { SubtitleLayer } from './SubtitleLayer';
import { type SheetTab, subtitlesValue, TracksSheet } from './TracksSheet';
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
/**
 * The roll of the wheel that brought the controls up is spent until the wheel
 * rests this long: on the TV a quick roll comes in flicks, with gaps between.
 */
const WHEEL_REST_MS = 500;
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
/** The next episode's streams are asked for this long before the end. */
const NEXT_STREAMS_BEFORE_END_S = 120;
/** A minutes sleep timer is read again at least this often: does it run out before the next episode? */
const SLEEP_TICK_MS = 30 * 1000;

type Panel = 'tracks' | 'sources' | 'episodes' | 'info' | 'quality' | null;
/** The panels that rise from the bottom over the picture: the controls make way for them. */
const SHEETS: readonly Panel[] = ['tracks', 'sources', 'episodes', 'info'];
const isSheet = (panel: Panel) => panel !== null && SHEETS.indexOf(panel) >= 0;

interface PlayerScreenProps {
  type: string;
  metaId: string;
  videoId: string;
  preview?: MetaPreview;
  stream?: StreamEntry;
  chosen?: boolean;
  /** The release the episode before played, which goes first when its addon has this one. */
  binge?: BingeHint;
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
  const { t, i18n } = useTranslation();
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
  // The audio and subtitle sheet's tab.
  const [sheetTab, setSheetTab] = useState<SheetTab>('subtitles');
  // How a sheet closed: Back goes to its own chip, a pick to the picture,
  // anything else (Blue, a click above it) back to where it was opened.
  const closedBy = useRef<'back' | 'pick' | null>(null);
  // A stream picked in Sources stays the viewer's own through All streams and back.
  const pickedHere = useRef(false);
  const [scrubTo, setScrubTo] = useState<number | null>(null);
  // A skip in progress: where it began, where it will land, and the timer that lands it.
  const scrub = useRef<{ origin: number; target: number; timer: number } | null>(null);
  const [skipNote, setSkipNote] = useState<{ delta: number; target: number } | null>(null);
  const noteTimer = useRef<number | undefined>(undefined);
  // How many times Fast forward or Rewind has repeated while held down.
  const heldSkip = useRef(0);
  // The last notch of the roll that brought the controls up.
  const showingRoll = useRef(0);
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
  // The sleep timer, kept for this title through All streams and the next episode.
  const [sleep, setSleep] = useState(() => sleepTimerFor(metaId));
  // The time it is read at, moved on as it nears a change.
  const [sleepNow, setSleepNow] = useState(() => Date.now());
  const [sleepWarningGone, setSleepWarningGone] = useState(false);
  // Paused by the sleep timer, under its dark screen.
  const [asleep, setAsleep] = useState(false);
  const askPreference = useSyncExternalStore(
    preferences.subscribe,
    () => preferences.get().stillWatching,
  );
  // What the Lab passed on this TV, which its speed test can change while the sheet shows.
  const speeds = useSyncExternalStore(speedMemory.subscribe, speedMemory.results);

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
  // The controls wait to hide behind a panel, and while Start over offers to go back.
  const panelOpen = useRef(false);
  const offeringUndo = useRef(false);
  useEffect(() => {
    panelOpen.current = panel !== null;
    offeringUndo.current = undo !== null;
  });
  const waiting = !nothing && (state.status === 'idle' || state.status === 'loading');
  const problem = nothing || state.status === 'failed';
  // Whether the controls show.
  const chrome = controls && !waiting;
  // On a broadcast whose live point the engine knows, playing live leaves
  // Forward 10 s, Fast forward and Go to live nowhere to go.
  const atLive = state.live && state.liveWindow !== null && state.behind === 0;

  // Up Next, in the last 30 seconds of an episode: a card while nothing else
  // is on screen, else the count on Next episode. It counts to the real end,
  // in watching seconds, so the ending is never cut. Never on a broadcast,
  // nor over a clip the viewer picked: its end is not the episode's.
  const hasNext = !!next && !state.live;
  const offersNext = hasNext && !state.clip;
  const ended = state.status === 'ended';
  const running = state.status === 'playing' || state.status === 'buffering';
  const inStretch = offersNext && inLastStretch(state.position, state.duration, state.rate);
  // The sleep timer. Minutes pause the video wherever it is; the end of what
  // plays, or minutes that would run out early in the next episode, stop at this end.
  const sleepAt = sleepPhase(sleep, sleepNow, {
    remainingS: state.duration > 0 ? state.duration - state.position : Infinity,
    ended,
    live: state.live,
    rate: state.rate,
  });
  const sleepsHere =
    stopsBeforeNext(sleep, sleepNow) && !state.live && (offersNext || sleep.choice === 'end');
  if (sleepAt === 'due' && sleep.choice !== 'end' && !asleep) {
    setAsleep(true);
    setSleep(SLEEP_OFF);
    setPanel(null);
    setControls(false);
  }
  // What holds the end, and keeps the cards away: a sheet or menu, a skip on
  // its way, a stream starting, the problem box, the sleep timer's dark screen.
  const held = panel !== null || scrubTo !== null || waiting || problem || asleep;
  // A rewind well back from the end brings a dismissed Up Next back.
  if (upNextDismissed && !waiting && rearms(state.position, state.duration, state.rate)) {
    setUpNextDismissed(false);
  }
  // Not when the sleep timer stops at this end.
  const counting = inStretch && !upNextDismissed && !held && !sleepsHere;
  // Whether the count was on screen as the episode played into its end: the
  // next one then starts as it ends. Kept through the pause the video makes as it ends.
  const [countSeen, setCountSeen] = useState(false);
  if (running && countSeen !== counting) setCountSeen(counting);
  // "Still watching?", decided once as the video ends: the next episode would
  // be the third in a row to start by itself, or nothing was pressed for 90
  // minutes. Kept until the viewer answers, whatever they press meanwhile.
  const [askAtEnd, setAskAtEnd] = useState<boolean | null>(null);
  if (!ended && askAtEnd !== null) setAskAtEnd(null);
  if (ended && askAtEnd === null) {
    setAskAtEnd(
      askPreference &&
        askStillWatching({
          autoplaysSinceInput: autoplaysSinceInput(),
          sinceInputMs: sinceInput(),
        }),
    );
  }
  // Whether anything has held the end since the video ended.
  const [heldAtEnd, setHeldAtEnd] = useState(false);
  const holdsEnd = ended && (heldAtEnd || held);
  if (heldAtEnd !== holdsEnd) setHeldAtEnd(holdsEnd);
  // The short count after an end nobody saw counted down, once nothing holds it.
  const [afterEnd, setAfterEnd] = useState<number | null>(null);
  if (afterEnd !== null && (!ended || held)) setAfterEnd(null);
  const decision = ended
    ? endAction({
        hasNext: offersNext,
        live: state.live,
        dismissed: upNextDismissed,
        held,
        countedOnScreen: (countSeen && !heldAtEnd) || afterEnd === 0,
        sleepsHere,
        stillWatching: askAtEnd === true,
      })
    : null;
  if (decision === 'sleep') {
    setAsleep(true);
    setSleep(SLEEP_OFF);
    setControls(false);
  }
  const asking = decision === 'ask';
  const countsAfterEnd = decision === 'hold' && !held;
  const showsCount = !upNextDismissed && (ended ? countsAfterEnd : counting && running);
  const count = ended
    ? (afterEnd ?? UP_NEXT_AFTER_END_S)
    : (secondsToEnd(state.position, state.duration, state.rate) ?? 0);
  // The sleep timer's last minute, in the corner as Up Next is.
  const warns = sleepAt === 'warning' && !sleepWarningGone && !held;
  // The controls win: with them up, the count is on Next episode instead.
  const cardUp = showsCount && !chrome && !warns;
  const warningUp = warns && !chrome;

  // Skip intro and Skip recap, from IntroDB's timings for this episode: in
  // Up Next's corner as the intro or recap plays, while nothing else is on
  // screen, for SKIP_CARD_S, then gone until a rewind brings it back. It only
  // offers; it never skips by itself. Never over a clip, a broadcast, the Lab
  // or sports.
  const skips = useSkipSegments(type, videoId, !props.lab && !sportsEvent);
  const skipping =
    state.clip || state.live ? undefined : skipAt(skips, state.position, state.duration);
  // The intro or recap the card was for, where it first showed, and whether it was let go.
  const [skipShown, setSkipShown] = useState<{ key: string; at: number; gone: boolean } | null>(
    null,
  );
  if (skipping && !waiting) {
    const key = skipKey(skipping);
    if (!skipShown || skipShown.key !== key || skipRearms(skipShown.at, state.position)) {
      setSkipShown({ key, at: state.position, gone: false });
    }
  } else if (!waiting && skipShown && skipRearms(skipShown.at, state.position)) {
    // Back before the intro or recap: it shows again when playback reaches it,
    // even after OK or Back let it go.
    setSkipShown(null);
  }
  const skipUp =
    !!skipping &&
    skipShown !== null &&
    skipShown.key === skipKey(skipping) &&
    !skipShown.gone &&
    !skipCardDone(skipShown.at, state.position, state.rate) &&
    !chrome &&
    !held &&
    !cardUp &&
    !warns;

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
        const entry = props.stream ?? (await finder.choose(props.binge));
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
        // Back again: the controls show, with Play ready unless a panel is
        // open. The dark screen and "Still watching?" keep the remote.
        if (asleep || asking) return;
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
  }, [session, panel, asleep, asking]);

  // The audio language chosen last time, once per stream and engine: a stream
  // the TV's player hands to hls.js lists its tracks again, under other ids.
  // Not a commentary, when the language has another track: on sport, where
  // the main sound is often called "commentary", only one the stream marks.
  const audioDecided = useRef<string | null>(null);
  useEffect(() => {
    const entry = state.entry;
    if (!session || !entry || state.audio.length < 2) return;
    const key = `${entryKey(entry)}|${state.engine ?? ''}`;
    if (audioDecided.current === key) return;
    audioDecided.current = key;
    const wanted = wantedAudio(props.lab ? undefined : metaId);
    if (!wanted) return;
    const match = pickAudio(state.audio, wanted, !sportsEvent);
    if (match && !match.active) session.selectAudio(match.id);
  }, [session, state.entry, state.engine, state.audio, props.lab, metaId, sportsEvent]);

  // Controls.
  function armHide() {
    clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      if (session?.get().status !== 'playing' || panelOpen.current) return;
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
  // Paused, buffering or failed: the controls stay up.
  useEffect(() => {
    if (controls && !panel && state.status === 'playing') armHide();
    else clearTimeout(hideTimer.current);
    // armHide only reads refs and the session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controls, panel, state.status]);

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
    // A broadcast's right end is live, which has moved on since the bar was
    // drawn: there it is Go to live, which reads where live is now.
    const kept = state.live ? state.liveWindow : null;
    if (session && kept && seconds >= kept.live - Math.max(0, kept.slack)) {
      if (!atLive) session.goToLive();
    } else session?.seek(seconds);
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
    closedBy.current = null;
    setPanelFrom(from);
    setPanel(which);
  }
  function openTracks(from: string) {
    setSheetTab('subtitles');
    openPanel('tracks', from);
  }
  /** Where focus goes when a sheet opened from its chip closes. */
  function sheetReturn(chip: string) {
    return () =>
      closedBy.current === 'back'
        ? chip
        : closedBy.current === 'pick'
          ? 'player-surface'
          : panelFrom;
  }
  /** Back from a sheet: one level at a time, onto the controls. */
  function backFromSheet() {
    setPanel(null);
    // Not while a stream opens: they would show without a picture.
    if (waiting) return;
    closedBy.current = 'back';
    show();
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
    onEnterPress: (_props, details) => {
      // An OK held down from a sheet's row or a button lands here: not a press of its own.
      if ((details.pressedKeys.enter ?? 1) > 1 && okWentDownOn() !== 'player-surface') return;
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
    // Behind the problem box, the dark screen or "Still watching?" only Stop
    // reaches the player; each has its own ways on.
    if ((problem || asleep || asking) && event.keyCode !== KeyCode.Stop) return;
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
          if (direction === 1 && atLive) {
            show();
            break;
          }
          const at = session.trustedPosition() ?? state.position;
          session.seek(at + direction * skipStep(heldSkip.current));
          show();
        } else scrubBy(direction, heldSkip.current);
        break;
      }
      case KeyCode.Blue:
        // Held down, it would open and close the panel over and over.
        if (event.repeat) break;
        if (panel === 'tracks') setPanel(null);
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
    // Behind the problem box, or while a stream opens, the controls would not
    // show; nor under a sheet, which they make way for. Nor over Up Next,
    // which would go from under the pointer heading for it.
    if (problem || waiting || isSheet(panel) || card || asleep || asking) return;
    if (!controls) show();
    else armHide();
  };

  // A roll ends with the controls it brought up: once they hide, the next notch brings them again.
  useEffect(() => {
    if (!controls) showingRoll.current = 0;
  }, [controls]);

  // The wheel never skips (Eyitayo, 30 October 2026). With the controls hidden
  // a notch shows them, on Pause, as Up and Down do. Otherwise it moves between
  // rows, as everywhere else, and keeps the controls up.
  const onWheel = (event: WheelEvent) => {
    if (event.deltaY === 0 || panel || problem || card || asleep || asking) return;
    const now = Date.now();
    // The rest of the roll that brought them up, however long and in however
    // many flicks, would move on from Pause: it is spent until the wheel rests.
    if (chrome && now - showingRoll.current < WHEEL_REST_MS) {
      showingRoll.current = now;
      // Still someone at the remote: the controls stay.
      armHide();
      event.stopPropagation();
      return;
    }
    const at = focusedKey();
    // Brought up by the pointer, the controls leave focus on the picture: a notch takes it to Pause.
    if (chrome && at !== 'player-surface') {
      armHide();
      // Up stops at the bar, as the arrow does: the back arrow above it is the pointer's.
      if (event.deltaY < 0 && at === 'player-seek') event.stopPropagation();
      else wheelMovedFocus.current = true;
      return;
    }
    // The notch is spent bringing them up, not on moving on from Pause as well.
    event.stopPropagation();
    // While a stream starts they would show without a picture.
    if (waiting) return;
    markActivity();
    wheelMovedFocus.current = true;
    // Shown before focus lands, or the TV's own focus (which Audio Guidance reads) stays put.
    flushSync(() => setControls(true));
    // After the render, which first runs what a hide left waiting: its reset of the roll.
    showingRoll.current = now;
    show('player-play');
  };

  // A click on the picture shows the controls, or hides them. A click on a
  // control is that control's, and so is a click after the wheel moved focus
  // to one: the Magic Remote sends its OK as a click alone while the pointer shows.
  const picturePressable = () => !problem && !waiting && !panel && !card && !asleep && !asking;
  function pressPicture() {
    if (controls) hide();
    else show('player-play');
  }
  const onPictureClick = (event: MouseEvent) => {
    if (clickCameWithOk()) return;
    if (event.target instanceof Element && event.target.closest(CONTROL)) return;
    if (!picturePressable()) return;
    if (chrome && wheelMovedFocus.current) pressFocused();
    else pressPicture();
  };

  // The Magic Remote OK can come as a key press as well as a click. With the
  // pointer on the picture it is the picture's, before the control that kept
  // focus takes it: Pause, or a chip, which would open its sheet. A skip under way
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
    if (problem || panel || asleep || asking) return;
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
  // The problem box takes the remote: a panel open behind it goes, in the
  // same render as the box comes, so its focus goes back before the box takes it.
  const [hadProblem, setHadProblem] = useState(problem);
  if (problem !== hadProblem) {
    setHadProblem(problem);
    if (problem) setPanel(null);
  }
  // A panel closed while a stream opens (the player moved on to another
  // stream behind it) leaves the hidden controls behind: they give way too.
  useEffect(() => {
    if (waiting && controls && !panel) hide();
    // Only the panel closing matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panel]);

  // The next episode's streams are asked for well before Up Next, so reading
  // them does not hold up the count, and the episode starts at once.
  const remaining = state.duration > 0 ? state.duration - state.position : Infinity;
  const nearEnd = ended || remaining <= NEXT_STREAMS_BEFORE_END_S;
  useEffect(() => {
    if (nearEnd && next) streamFinder(type, next.id).start();
  }, [nearEnd, next, type]);

  /**
   * Plays another episode of the series (Next episode, Up Next, Episodes) on
   * the same release from the same addon, as Stremio's binge watching does.
   */
  function playEpisode(target: Video) {
    session?.saveProgress();
    const binge = bingeHint(state.entry);
    // Up Next asked for the next episode's streams already: that one starts at once.
    // Otherwise the new player waits a little for the addon's answer.
    const stream = binge && bingeEntry(streamFinder(type, target.id).get().candidates, binge);
    replace({ name: 'player', type, metaId, videoId: target.id, preview, stream, binge });
  }
  function playNextEpisode() {
    if (next) playEpisode(next);
  }

  /** Skip intro or Skip recap: to its end, and the card goes. */
  function skipSegment() {
    if (!session || !skipping) return;
    // A skip still to land would undo it.
    cancelScrub();
    session.seek(skipping.end);
    setSkipShown((shown) => shown && { ...shown, gone: true });
  }
  function letSkipGo() {
    setSkipShown((shown) => shown && { ...shown, gone: true });
  }

  // As a card (Up Next, the sleep timer's warning, Skip intro) goes with focus,
  // focus goes to the controls that came up in its place, else to the picture.
  // A sheet, a dialog or the dark screen takes it itself.
  const card = cardUp || warningUp || skipUp;
  const hadCard = useRef(card);
  useEffect(() => {
    if (card === hadCard.current) return;
    hadCard.current = card;
    if (card || panel || problem || asleep || asking) return;
    const at = focusedKey();
    if (
      at.indexOf('player-upnext') !== 0 &&
      at.indexOf('player-sleepwarn') !== 0 &&
      at.indexOf('player-skip') !== 0
    ) {
      return;
    }
    void setFocus(chrome ? 'player-play' : 'player-surface');
    // Only the card going matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card]);

  // The end: back to the title's page, or on to the next episode, once nothing holds it.
  useEffect(() => {
    if (decision === 'leave') back();
    else if (decision === 'play') {
      countAutoplay();
      playNextEpisode();
    }
    // Only the decision matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [decision]);
  // The sleep timer: kept for the next screen of this title, read again as it
  // nears its warning and its end, and it pauses the video under its dark screen.
  useEffect(() => keepSleepTimer(metaId, sleep), [metaId, sleep]);
  // Gone anywhere but on with this title, the player leaves no timer behind.
  useEffect(() => () => leaveSleepTimer(metaId, topRoute()), [metaId]);
  useEffect(() => {
    const wait = nextSleepCheck(sleep, sleepNow);
    if (wait === null) return;
    const timer = window.setTimeout(() => setSleepNow(Date.now()), Math.min(wait, SLEEP_TICK_MS));
    return () => clearTimeout(timer);
  }, [sleep, sleepNow]);
  // Again if a stream starts playing under the dark screen.
  const playingNow = state.status === 'playing';
  useEffect(() => {
    if (asleep) session?.pause();
  }, [asleep, session, playingNow]);
  // Speed, where the Lab passed one for this kind of stream; in the Lab, its
  // test. Not on a broadcast, which can't run ahead of live.
  const source = state.entry?.stream.source;
  const speedKind = state.entry
    ? speedKindOf(
        state.engine,
        state.entry.facts.container,
        source?.kind === 'url' ? guessMimeType(source.url) : undefined,
      )
    : undefined;
  const speedRates = speedMemory.rates(speedKind);
  const speedShown =
    !state.live &&
    (!!props.lab || SPEED_KINDS.some((kind) => (speeds[kind]?.rates.length ?? 0) > 0));

  function chooseSleep(choice: SleepChoice) {
    const now = Date.now();
    setSleep(startSleep(choice, now));
    setSleepNow(now);
    setSleepWarningGone(false);
  }
  function addSleep() {
    const now = Date.now();
    setSleep(addSleepTime(sleep, now));
    setSleepNow(now);
    setSleepWarningGone(false);
  }
  // "Carry on watching" plays on from where the timer paused, with the
  // controls up a moment to say where; Back leaves it paused. At an end the
  // timer stopped, Next episode counts instead.
  function wake(carryOn: boolean) {
    setAsleep(false);
    // At an end, waking is the viewer's answer: "Still watching?" decided as
    // it ended does not ask again over the count.
    if (ended) setAskAtEnd(false);
    else if (carryOn) session?.resume();
    show('player-play');
  }
  // An end nobody saw counted down gets a short count of its own, on the
  // clock: a busy TV runs timers late, and the count must not stretch.
  useEffect(() => {
    if (!countsAfterEnd) return;
    const ends = Date.now() + UP_NEXT_AFTER_END_S * 1000;
    const timer = window.setInterval(
      () => setAfterEnd(Math.max(0, Math.ceil((ends - Date.now()) / 1000))),
      250,
    );
    return () => window.clearInterval(timer);
  }, [countsAfterEnd]);

  // Quality: at each resolution, the stream closest to what plays, in the
  // language heard and at its length, never a clip.
  const heard = state.audio.find((track) => track.active)?.lang || undefined;
  const length = state.duration > 0 ? state.duration : undefined;
  const reference = useMemo(
    (): QualityReference | undefined =>
      state.entry ? { entry: state.entry, audioLanguage: heard, lengthSeconds: length } : undefined,
    [state.entry, heard, length],
  );
  const choices = useMemo(
    () => qualityChoices(finderState.candidates, reference, finder.orderOptions()),
    [finderState.candidates, reference, finder],
  );
  // Audio in the language wanted, or the app's own when none was chosen, from
  // another stream when this one lacks it. Not for a Lab file, which has no other.
  const switchLanguage = (!props.lab && wantedAudio(metaId)) || i18n.language;
  const switchTo = useMemo(
    () =>
      reference && !props.lab
        ? audioSwitch(
            state.audio,
            reference,
            finderState.candidates,
            switchLanguage,
            finder.orderOptions(),
          )
        : undefined,
    [state.audio, reference, finderState.candidates, switchLanguage, finder, props.lab],
  );
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
      if (direction === 1 && atLive) return;
      const at = session.trustedPosition() ?? state.position;
      session.seek(at + direction * skipStep(0));
      armHide();
    } else scrubBy(direction);
  }
  function goToLive() {
    if (!session || waiting) return;
    session.goToLive();
    armHide();
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
      unavailable: atLive ? t('player.atLive') : undefined,
      onPress: () => skipButton(1),
    },
    // A broadcast has Go to live in Next episode's place; anything with an
    // episode list has Next, whatever its type, kept while the list loads.
    state.live
      ? {
          focusKey: 'player-live',
          icon: 'live',
          label: t('player.goToLive'),
          unavailable: !state.liveWindow
            ? t('player.liveUnknownPoint')
            : atLive
              ? t('player.atLive')
              : undefined,
          onPress: goToLive,
        }
      : metaQuery && (!meta || episode)
        ? {
            focusKey: 'player-next',
            icon: 'next',
            // Up Next's count, while the controls hide its card.
            label: showsCount ? t('player.nextIn', { seconds: count }) : t('player.nextEpisode'),
            // Over a clip too: only the count and the end leave it alone.
            unavailable: hasNext ? undefined : noNextReason(),
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
      value: subtitlesValue(subtitles) ?? t('player.subtitlesOffValue'),
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
      onPress: () => openPanel('sources', 'player-streams-button'),
    });
  }
  // Anything with an episode list has Episodes, from the first frame: it
  // never comes or goes while the video plays, only waits for the list.
  if (metaQuery) {
    tools.push({
      focusKey: 'player-episodes-button',
      icon: 'episodes',
      label: t('player.episodes'),
      unavailable: meta && meta.videos.length > 0 ? undefined : t('player.noEpisodeList'),
      onPress: () => openPanel('episodes', 'player-episodes-button'),
    });
  }
  // Last, and in the Lab too: what plays and what it is.
  tools.push({
    focusKey: 'player-info-button',
    icon: 'info',
    label: t('player.info'),
    // The sleep timer, which Info sets, while it is on.
    value:
      sleep.choice === 'off'
        ? undefined
        : sleep.choice === 'end'
          ? t('player.sleep.chipEnd')
          : t('player.sleep.chip', { time: formatClock(sleep.endsAt ?? 0) }),
    onPress: () => openPanel('info', 'player-info-button'),
  });

  /** All streams, in place of the film: Back from it comes back to the film where it was. */
  function openAllStreams() {
    // Before a stream has opened, where the viewer asked to start.
    const startAt = session && state.entry ? session.carryOn() : resumedAt;
    const film: PlayerRoute = {
      name: 'player',
      type,
      metaId,
      videoId,
      preview,
      stream: state.entry ?? props.stream,
      chosen: props.chosen || pickedHere.current,
      startAt,
      event: sportsEvent,
    };
    replace({
      name: 'streams',
      type,
      metaId,
      videoId,
      preview,
      startAt,
      event: sportsEvent,
      backTo: film,
    });
  }

  /** A stream picked in Sources plays from where the film is, and does not fail over. */
  function chooseSource(entry: StreamEntry) {
    const action = entry.assessment.action;
    // The one playing: nothing to change, as with Quality.
    if (state.entry && entryKey(entry) === entryKey(state.entry)) {
      closedBy.current = 'pick';
      setPanel(null);
      hide();
      return;
    }
    if (action.kind === 'play') {
      closedBy.current = 'pick';
      setPanel(null);
      if (!session) return;
      pickedHere.current = true;
      // A paused film stays paused, and a note says what is coming.
      session.play(entry, session.carryOn(), {
        chosen: true,
        handPicked: true,
        paused: state.status === 'paused',
      });
      setSwitching({ entry });
    } else if (action.kind === 'youtube' && entry.stream.source.kind === 'youtube') {
      session?.pause();
      void playTrailer(entry.stream.source.ytId).catch(() => undefined);
    }
    // Anything else says on its row why it can't play here.
  }

  /** "English audio: switch stream": plays from where the film is, and keeps the language for the title. */
  function switchForAudio(entry: StreamEntry, language: string) {
    closedBy.current = 'pick';
    setPanel(null);
    if (!session) return;
    chooseAudioLanguage(metaId, language);
    session.play(entry, session.carryOn(), { chosen: true, paused: state.status === 'paused' });
    setSwitching({ entry });
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
        lift={isSheet(panel) ? 'sheet' : chrome ? 'controls' : 'none'}
        // While the style changes, a line shows how it looks when nobody speaks.
        sample={panel === 'tracks' && sheetTab === 'style' ? t('player.sampleLine') : undefined}
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
        // They make way for a sheet, and come back when it goes.
        visible={chrome && !isSheet(panel)}
        title={title}
        subtitle={subtitle}
        facts={facts}
        live={state.live}
        liveWindow={state.liveWindow}
        behind={state.behind}
        position={state.position}
        duration={state.duration}
        rate={state.rate}
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

      {warningUp && (
        <SleepWarning
          timer={sleep}
          episode={!!episode}
          onAdd={addSleep}
          onOff={() => chooseSleep('off')}
          onDismiss={() => setSleepWarningGone(true)}
          onControls={() => show('player-play')}
        />
      )}
      {cardUp && next && (
        <UpNext
          video={next}
          seconds={count}
          onPlay={playNextEpisode}
          onDismiss={() => setUpNextDismissed(true)}
          onControls={() => show('player-play')}
        />
      )}
      {skipUp && skipping && (
        <SkipCard
          kind={skipping.kind}
          onSkip={skipSegment}
          onDismiss={letSkipGo}
          onControls={() => show('player-play')}
        />
      )}

      {panel === 'tracks' && (
        <TracksSheet
          audio={state.audio}
          subtitles={subtitles}
          entry={state.entry}
          tab={sheetTab}
          onTab={setSheetTab}
          returnFocusKey={sheetReturn('player-tracks-button')}
          onAudio={chooseAudio}
          audioSwitch={
            switchTo && {
              language: switchLanguage,
              entry: switchTo,
              onPress: () => switchForAudio(switchTo, switchLanguage),
            }
          }
          onBack={backFromSheet}
          onClose={() => setPanel(null)}
        />
      )}
      {panel === 'sources' && (
        <SourcesSheet
          finder={finder}
          playing={state.entry}
          reference={reference}
          returnFocusKey={sheetReturn('player-streams-button')}
          onPick={chooseSource}
          onAllStreams={openAllStreams}
          onBack={backFromSheet}
          onClose={() => setPanel(null)}
        />
      )}
      {panel === 'episodes' && meta && (
        <EpisodesSheet
          meta={meta}
          videoId={videoId}
          returnFocusKey={sheetReturn('player-episodes-button')}
          onPlay={(target) => {
            // The one playing: nothing to change.
            if (target.id === videoId) {
              closedBy.current = 'pick';
              setPanel(null);
              hide();
            } else playEpisode(target);
          }}
          onBack={backFromSheet}
          onClose={() => setPanel(null)}
        />
      )}
      {panel === 'info' && (
        <InfoSheet
          title={title}
          subtitle={subtitle}
          item={item}
          episode={episode}
          entry={state.entry}
          audio={state.audio}
          duration={state.duration}
          live={state.live}
          engine={state.engine}
          heavy={!!state.entry && isHeavy(state.entry, finder.runtimeSeconds())}
          reference={reference}
          sleep={sleep}
          onSleep={chooseSleep}
          speed={
            speedShown
              ? {
                  rates: speedRates,
                  current: state.rate,
                  kind: speedKind,
                  lab: !!props.lab,
                  video,
                  onChoose: (rate) => session?.setRate(rate),
                }
              : undefined
          }
          returnFocusKey={sheetReturn('player-info-button')}
          onBack={backFromSheet}
          onClose={() => setPanel(null)}
        />
      )}
      {panel === 'quality' && (
        <Menu
          focusKey="player-quality"
          title={t('player.quality')}
          options={choices.map((choice) => ({
            value: choice.resolution ?? 'other',
            label: resolutionLabel(choice.resolution) ?? t('player.otherQuality'),
            detail: choice.otherLanguages
              ? t('player.otherAudio', {
                  languages: choice.otherLanguages.map(languageName).join(', '),
                })
              : undefined,
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

      {asking && <StillWatching title={title} onPlay={playNextEpisode} onStop={back} />}
      {asleep && <SleepScreen onWake={wake} />}

      {problem && (
        <PlayerProblem
          text={problemText(t, playProblem(nothing, finderState, state))}
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
