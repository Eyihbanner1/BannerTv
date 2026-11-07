import {
  askStillWatching,
  BACK_TO_MS,
  bingeEntry,
  bingeHint,
  type CreditsCard,
  creditsCardAt,
  creditsCount,
  creditsCue,
  endAction,
  guessIntro,
  guessSettles,
  introKnown,
  type IntroGuess,
  inLastStretch,
  languageName,
  nextVideo,
  offersBackTo,
  parseRuntime,
  playedCard,
  qualityChoices,
  type QualityReference,
  rearms,
  secondsToEnd,
  SKIP_LANDS_AFTER_MS,
  skipAt,
  skipCardDone,
  skipKey,
  skipRearms,
  type StreamEntry,
  UP_NEXT_AFTER_END_S,
  UP_NEXT_BEFORE_END_S,
  upNextStage,
} from '@bannertv/core';
import type { MetaDetail, MetaPreview, Video } from '@bannertv/protocol';
import { addonClient } from '@tv/data/addons';
import { addonsDidntAnswer } from '@tv/data/describe';
import { playedVideos, progress, releaseMemory, rememberedRelease } from '@tv/data/playback';
import { preferences } from '@tv/data/preferences';
import { learnedIntros, useEpisodeMarks } from '@tv/data/skips';
import { chooseAudioLanguage, wantedAudio } from '@tv/data/tracks';
import { useQuery } from '@tv/data/use-query';
import { noteInput, sinceInput } from '@tv/navigation/activity';
import { audioDetail, audioSummary, audioSwitch, pickAudio } from '@tv/player/audio';
import { problemText, resolutionLabel } from '@tv/player/describe';
import { entryKey, holdProbing, streamFinder } from '@tv/player/finder';
import { formatTime } from '@tv/player/media';
import { playProblem } from '@tv/player/problem';
import {
  createPlaybackSession,
  INITIAL_SESSION_STATE,
  type PlaybackSession,
} from '@tv/player/session';
import { autoplaysSinceInput, countAutoplay } from '@tv/player/sleep';
import { type SubtitleChoice, useSubtitles } from '@tv/screens/player/use-subtitles';
import { useScrobble } from '@tv/screens/player/use-scrobble';
import { motion } from '@brand/tokens/design';
import * as Haptics from 'expo-haptics';
import { StatusBar } from 'expo-status-bar';
import { VideoView } from 'expo-video';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  AppState,
  BackHandler,
  type GestureResponderEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { goBack, openPlayer, type PlayerRoute, remembersPlace } from '../nav/routes';
import { reportScreen } from '../runtime/whereabouts';
import { Artwork } from '../ui/Artwork';
import { Button } from '../ui/Button';
import { Icon, OutlineIcon } from '../ui/icons';
import { StreamList } from '../ui/StreamList';
import { colors, radius, space, touch, type } from '../ui/theme';
import { phoneArt } from '../ui/Tile';
import { holdLandscape } from './orientation';
import {
  BACKGROUND_PAUSE_DELAY_MS,
  phonePlayer,
  pictureInPicture,
  pictureShown,
} from './phone-host';
import { ScenePreview, sceneFrames } from './ScenePreview';
import { SeekBar } from './SeekBar';
import { PanelColumn, PanelOption, SidePanel } from './SidePanel';
import { SkipRipple } from './SkipRipple';
import { SubtitleStyleChoices } from './SubtitleStyle';
import { SubtitleText } from './SubtitleText';
import { isSwipe, startsAtEdge, swipeMoves, swipeTarget } from './swipe-seek';
import {
  addSkip,
  DOUBLE_TAP_MS,
  type PendingSkip,
  readTap,
  skipTotal,
  type TapSide,
  tapSide,
} from './tap-skip';
import { TracksPanel } from './TracksPanel';
import { asVideoElement, PhoneVideoElement } from './video-element';

const CONTROLS_HIDE_MS = motion.controlsHide;
/** A skip on a broadcast, which goes at once rather than adding up. */
const SKIP_S = 10;
/** The next episode's streams are looked up this long before the end. */
const PREFETCH_NEXT_S = 120;
/** The Skip intro pill's height, and how far up it sits while the controls show the seek bar. */
const SKIP_PILL_H = 40;
const SKIP_RAISED = 112;
/** The Back to pill sits just under the title row: its padding, its buttons and a small gap. */
const BACK_TO_TOP = space.m + touch.min + space.s;
const noop = () => () => undefined;

type Panel = 'tracks' | 'style' | 'more' | 'streams' | 'quality' | null;

function episodeLabel(video: Video | undefined): string | undefined {
  if (!video || video.season === undefined || video.episode === undefined) return undefined;
  return `S${video.season}:E${video.episode}${video.title ? ` · ${video.title}` : ''}`;
}

export function PlayerScreen({ route }: { route: PlayerRoute }) {
  const { type: titleType, metaId, videoId } = route;
  // A sports event: streams from the addons that listed it only, and no Continue Watching card.
  const sportsEvent = route.event;
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const element = useMemo(() => new PhoneVideoElement(), []);
  const finder = useMemo(
    () => streamFinder(titleType, videoId, sportsEvent),
    [titleType, videoId, sportsEvent],
  );
  const [session, setSession] = useState<PlaybackSession | null>(null);
  const [nothing, setNothing] = useState(false);
  const [resumedAt, setResumedAt] = useState(0);
  // Episodes out by the time the player opened count as next.
  const [openedAt] = useState(() => Date.now());
  const state = useSyncExternalStore(
    session ? session.subscribe : noop,
    session ? session.get : () => INITIAL_SESSION_STATE,
  );
  const finderState = useSyncExternalStore(finder.subscribe, finder.get);
  const shown = useSyncExternalStore(pictureShown.subscribe, pictureShown.get);
  const pip = useSyncExternalStore(pictureInPicture.subscribe, pictureInPicture.get);
  const videoView = useRef<VideoView>(null);
  const prefs = useSyncExternalStore(preferences.subscribe, preferences.get);

  // The title's full record, for the episode list and the Continue Watching card. A sports
  // event's page comes from the addon that listed it, never another one.
  const metaQuery = useMemo(
    () => (titleType === 'movie' || sportsEvent ? null : addonClient.meta(titleType, metaId)),
    [titleType, metaId, sportsEvent],
  );
  const meta: MetaDetail | undefined = useQuery(metaQuery).data;
  const item: MetaPreview | undefined = meta ?? route.preview;
  useEffect(() => finder.setRuntime(parseRuntime(item?.runtime)), [finder, item?.runtime]);

  // Open: one session per video, as the TV's PlayerScreen.
  useEffect(() => {
    const releaseLandscape = holdLandscape();
    const releaseProbing = holdProbing();
    const created = createPlaybackSession({
      video: asVideoElement(element),
      type: titleType,
      metaId,
      videoId,
      finder,
      autoFailover: !route.chosen,
      // A match saves nothing and never resumes; a replay keeps its place like any other video,
      // but never goes on Continue Watching.
      remember: remembersPlace(route),
      continueRow: !sportsEvent,
    });
    // The session lives as long as this effect: made here, destroyed in its cleanup.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSession(created);
    finder.start();
    let cancelled = false;
    void Promise.all([progress.load(), releaseMemory.load()])
      .catch(() => undefined)
      .then(async () => {
        if (cancelled) return;
        // From saved progress a few seconds early (resumeLeadIn); a place carried over exactly.
        const start = route.startAt ?? progress.resumeFrom(videoId) ?? 0;
        setResumedAt(start);
        // The release played last for the title goes first, as the next episode's does.
        const release =
          remembersPlace(route) && !sportsEvent ? rememberedRelease(metaId) : undefined;
        const entry = route.stream ?? (await finder.choose(route.binge ?? release));
        if (cancelled) return;
        if (entry) created.play(entry, start);
        else setNothing(true);
      });
    return () => {
      cancelled = true;
      created.destroy();
      releaseProbing();
      releaseLandscape();
    };
    // One session per mounted player: the route is keyed by video.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => reportScreen('player'), []);

  const waiting = !nothing && (state.status === 'idle' || state.status === 'loading');
  const problem = nothing || state.status === 'failed';
  const problemWords = problem ? problemText(t, playProblem(nothing, finderState, state)) : null;
  const buffering = state.status === 'buffering';
  const playing = state.status === 'playing' || buffering;
  const ended = state.status === 'ended';

  // Controls: shown on a tap, hidden again after a while of playing.
  const [controls, setControls] = useState(true);
  const [panel, setPanel] = useState<Panel>(null);
  const [scrubbing, setScrubbing] = useState(false);
  // Taps on the controls, which start the wait to hide them again (the clock does not).
  const [pokes, setPokes] = useState(0);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const poke = useCallback(() => {
    noteInput();
    setControls(true);
    setPokes((count) => count + 1);
  }, []);
  useEffect(() => {
    clearTimeout(hideTimer.current);
    if (controls && state.status === 'playing' && panel === null && !scrubbing) {
      hideTimer.current = setTimeout(() => setControls(false), CONTROLS_HIDE_MS);
    }
    return () => clearTimeout(hideTimer.current);
  }, [controls, state.status, panel, scrubbing, pokes]);
  // A problem closes the other sheets; its Sources button opens the stream list over it.
  if (problem && panel !== null && panel !== 'streams') setPanel(null);

  // The app going to the background saves, and pauses unless the film went on in a small
  // window (picture-in-picture), as hiding the TV app does.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const subscription = AppState.addEventListener('change', (next) => {
      clearTimeout(timer);
      if (next === 'background' && session) {
        session.saveProgress();
        timer = setTimeout(() => {
          if (AppState.currentState !== 'active' && !pictureInPicture.get()) session.pause();
        }, BACKGROUND_PAUSE_DELAY_MS);
      } else if (next === 'active') {
        setControls(true);
      }
    });
    return () => {
      clearTimeout(timer);
      subscription.remove();
    };
  }, [session]);
  // Leaving the player ends the small window too.
  useEffect(() => () => pictureInPicture.set(false), []);
  const startPip = () => {
    setPanel(null);
    void videoView.current?.startPictureInPicture();
  };

  // What IntroDB marks in this episode, as on the TV: the intro and recap (with an intro
  // learned from the viewer's own skips where it has none) and the end credits, for Up Next
  // when its mark fits this file. Never for sports.
  const marks = useEpisodeMarks(titleType, metaId, videoId, !sportsEvent);
  const cue = state.clip || state.live ? undefined : creditsCue(marks.credits, state.duration);

  const subtitles = useSubtitles(
    titleType,
    videoId,
    metaId,
    state.entry,
    session,
    state,
    // The title's own running time judges a file's length until the video's is known.
    parseRuntime(item?.runtime),
  );
  useScrobble(
    session,
    state,
    { type: titleType, metaId, videoId },
    finder.runtimeSeconds,
    cue?.start,
  );
  // The progress saved counts the episode watched from the credits.
  const creditsAt = cue?.start;
  useEffect(() => session?.markCredits(creditsAt), [session, creditsAt]);

  // The language the viewer chose before, once per stream and engine.
  const audioDecided = useRef('');
  useEffect(() => {
    if (!session || !state.entry || state.audio.length < 2) return;
    const key = `${entryKey(state.entry)}|${state.engine ?? ''}`;
    if (audioDecided.current === key) return;
    audioDecided.current = key;
    const wanted = wantedAudio(metaId);
    if (!wanted) return;
    const match = pickAudio(state.audio, wanted, !sportsEvent);
    if (match && !match.active) session.selectAudio(match.id);
  }, [session, state.entry, state.engine, state.audio, metaId, sportsEvent]);

  // The Continue Watching card: name, artwork and episode (the session saves the position).
  // Never for sports, replays included: the row would ask every addon with the id's prefix for
  // its page, not the one that listed it.
  const recorded = useRef('');
  useEffect(() => {
    if (sportsEvent || state.status !== 'playing' || state.live || !item) return;
    const card = playedCard(item, videoId, meta, { metaId, type: titleType });
    const key = [videoId, meta ? 'meta' : '', card.season, card.episode, card.next?.videoId].join(
      '|',
    );
    if (recorded.current === key) return;
    recorded.current = key;
    playedVideos.record(card);
  }, [sportsEvent, state.status, state.live, item, meta, videoId, metaId, titleType]);

  // Next episode.
  const next = useMemo(
    () => (meta ? nextVideo(meta, videoId, openedAt) : undefined),
    [meta, videoId, openedAt],
  );
  const current = meta?.videos.find((video) => video.id === videoId);
  const offersNext = !!next && !state.live && !state.clip;
  // As long before the credits pill as before the last 30 seconds' count.
  const toCredits = cue ? cue.start - state.position : Infinity;
  useEffect(() => {
    if (!next) return;
    if (
      ended ||
      (state.duration > 0 && state.duration - state.position <= PREFETCH_NEXT_S) ||
      toCredits <= PREFETCH_NEXT_S - UP_NEXT_BEFORE_END_S
    ) {
      streamFinder(titleType, next.id).start();
    }
  }, [next, ended, state.duration, state.position, titleType, toCredits]);

  const playEpisode = useCallback(
    (target: Video) => {
      session?.saveProgress();
      const binge = bingeHint(state.entry);
      const stream =
        binge && bingeEntry(streamFinder(titleType, target.id).get().candidates, binge);
      openPlayer(
        {
          type: titleType,
          metaId,
          videoId: target.id,
          ...(item ? { preview: item } : {}),
          ...(stream ? { stream } : {}),
          ...(binge ? { binge } : {}),
        },
        'replace',
      );
    },
    [session, state.entry, titleType, metaId, item],
  );

  // Up Next and the end of a video, decided by core's endAction as on the TV.
  const [dismissed, setDismissed] = useState(false);
  const [askAtEnd, setAskAtEnd] = useState<boolean | null>(null);
  const [afterEnd, setAfterEnd] = useState<number | null>(null);
  const [countSeen, setCountSeen] = useState(false);
  // A skip still adding up (the 10 s buttons, double taps, below) holds Up Next as a sheet
  // does, as on the TV: a count does not run out under it and start the next episode.
  const [pending, setPending] = useState<PendingSkip | null>(null);
  const held = panel !== null || waiting || problem || scrubbing || pending !== null;
  const inStretch = offersNext && inLastStretch(state.position, state.duration, state.rate);
  const counting = inStretch && !dismissed && !held;
  // As the credits start, the pill offers the next episode or Watch credits; with "Start next
  // at credits" on and a mark for this very release, it counts a few seconds and plays it,
  // unless "Still watching?" is due. Otherwise the last 30 seconds count down as before.
  const stage = offersNext
    ? upNextStage(state.position, state.duration, state.rate, cue?.start)
    : 'none';
  const [creditsCard, setCreditsCard] = useState<CreditsCard | null>(null);
  if (!waiting) {
    const counts = () =>
      prefs.nextAtCredits &&
      !!cue?.startsNext &&
      !(
        prefs.stillWatching &&
        askStillWatching({ autoplaysSinceInput: autoplaysSinceInput(), sinceInputMs: sinceInput() })
      );
    let card =
      offersNext && !ended ? creditsCardAt(creditsCard, state.position, cue?.start, counts) : null;
    // On a stream the mark is not exact for, the count stops for good: back on the marked one,
    // the pill only offers, never starting the next episode at once.
    if (card && card.counts && !cue?.startsNext) card = { ...card, counts: false };
    if (card !== creditsCard) setCreditsCard(card);
  }
  // Only while the file playing is the release marked: another stream cut a little
  // differently stops the count, and the ending plays out.
  const creditsCounts =
    !!creditsCard && creditsCard.counts && !!cue?.startsNext && !creditsCard.gone && !dismissed;
  const creditsUp =
    !!creditsCard &&
    !creditsCard.gone &&
    !ended &&
    !held &&
    playing &&
    (stage === 'credits' || creditsCounts);
  const creditsLeft =
    creditsCard && creditsCounts
      ? creditsCount(creditsCard, state.position, state.duration, state.rate)
      : null;
  // Run out while something held it: it counts no more, and the ending plays out.
  if (creditsCard && creditsCounts && creditsLeft === 0 && !creditsUp && !waiting) {
    setCreditsCard({ ...creditsCard, counts: false });
  }
  const creditsDue = creditsUp && creditsCounts && creditsLeft === 0;
  useEffect(() => {
    if (!creditsDue || !next) return;
    countAutoplay();
    playEpisode(next);
    // Only the count running out matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [creditsDue]);
  const count = ended
    ? (afterEnd ?? UP_NEXT_AFTER_END_S)
    : (secondsToEnd(state.position, state.duration, state.rate) ?? 0);
  // What Next episode counts with the controls up: to the next episode at the credits, or to
  // the end, or nothing over credits it only offers it over.
  const nextCount = creditsUp ? creditsLeft : counting ? count : null;
  if (dismissed && !waiting && !ended && rearms(state.position, state.duration, state.rate)) {
    setDismissed(false);
  }
  // Whether the count was on screen as the episode played into its end: the next one then
  // starts as it ends. Kept through the pause the video makes as it ends.
  const seen = counting && playing && !controls ? true : !counting && !ended ? false : countSeen;
  if (seen !== countSeen) setCountSeen(seen);
  // "Still watching?", decided once as the video ends, and kept until the viewer answers.
  if (!ended && askAtEnd !== null) setAskAtEnd(null);
  if (!ended && afterEnd !== null) setAfterEnd(null);
  if (ended && askAtEnd === null) {
    setAskAtEnd(
      prefs.stillWatching &&
        askStillWatching({
          autoplaysSinceInput: autoplaysSinceInput(),
          sinceInputMs: sinceInput(),
        }),
    );
  }
  const decision = ended
    ? endAction({
        hasNext: offersNext,
        live: state.live,
        dismissed,
        held,
        countedOnScreen: seen || afterEnd === 0,
        sleepsHere: false,
        stillWatching: askAtEnd === true,
      })
    : null;
  // An end nobody saw counted down gets a short count of its own.
  if (decision === 'hold' && !held && afterEnd === null) setAfterEnd(UP_NEXT_AFTER_END_S);
  useEffect(() => {
    if (decision === 'leave') goBack();
    else if (decision === 'play' && next) {
      countAutoplay();
      playEpisode(next);
    }
  }, [decision, next, playEpisode]);
  useEffect(() => {
    if (afterEnd === null || afterEnd <= 0 || held) return;
    const timer = setTimeout(() => setAfterEnd((left) => (left === null ? null : left - 1)), 1000);
    return () => clearTimeout(timer);
  }, [afterEnd, held]);

  // Back closes a sheet first, then leaves.
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (panel !== null) {
        setPanel(null);
        return true;
      }
      // Over the credits pill (the controls hide it), or a Next episode count it stops: Watch
      // credits. With the controls up over a pill that only offers, Back leaves, as before.
      if (creditsUp && (!controls || creditsCounts)) {
        setCreditsCard((card) => card && { ...card, gone: true });
        return true;
      }
      if (counting || (ended && decision === 'hold')) {
        setDismissed(true);
        return true;
      }
      return false;
    });
    return () => subscription.remove();
  }, [panel, counting, ended, decision, creditsUp, controls, creditsCounts]);

  // Back to: after a jump of two minutes or more, whichever way it was made, a pill offers for
  // a few seconds to go back to where the viewer was. A new big jump replaces the offer, and
  // going back offers nothing more. Never on a broadcast.
  const [backTo, setBackTo] = useState<{ at: number } | null>(null);
  useEffect(() => {
    if (!backTo) return;
    const timer = setTimeout(() => setBackTo(null), BACK_TO_MS);
    return () => clearTimeout(timer);
  }, [backTo]);
  // A skip by hand that looks like the intro, until playback shows it was (learned-intros.ts):
  // one of an intro's length early in an episode is learned once playback goes on from where
  // it landed, and the series' next episode offers Skip intro at the same place, as on the TV.
  const introGuess = useRef<IntroGuess | null>(null);
  const learnsIntro = titleType === 'series' && !sportsEvent && !state.live && !state.clip;
  /**
   * Goes to `to` from `from`: where the video was, trusted, as the jump began. `byHand`: a tap,
   * swipe or the bar, which may be the intro skipped; not Skip intro or Skip recap.
   */
  const jump = useCallback(
    (from: number, to: number, byHand = true) => {
      if (!session) return;
      session.seek(to);
      if (!session.get().live && offersBackTo(from, to)) setBackTo({ at: from });
      if (!byHand) return;
      // A jump from inside IntroDB's recap is that recap's.
      const inRecap = marks.segments.some(
        (segment) => segment.kind === 'recap' && from >= segment.start && from < segment.end,
      );
      // Nor in an episode whose intro IntroDB times or says it has none.
      if (!learnsIntro || introKnown(marks)) introGuess.current = null;
      else if (!inRecap) introGuess.current = guessIntro(introGuess.current, from, to);
    },
    [session, marks, learnsIntro],
  );
  const position = state.position;
  useEffect(() => {
    const guess = introGuess.current;
    if (!guess || waiting) return;
    const verdict = guessSettles(guess, position);
    if (verdict === 'wait') return;
    introGuess.current = null;
    // IntroDB may have answered since the skip: its own word wins.
    if (verdict === 'learn' && !introKnown(marks)) learnedIntros.learn(metaId, guess);
  }, [position, waiting, metaId, marks]);

  // Taps: one shows or hides the controls; two on a side start a skip of ten seconds, and each
  // tap after that adds ten more (tap-skip.ts). The 10 s buttons add to the same total. It
  // shows in a ripple on that side and lands once, a moment after the last tap or press, with
  // a light buzz, as the TV's remote adds up presses. Not on a broadcast, where taps and the
  // buttons skip at once as they always have, nor while a stream opens or fails, a panel is
  // open or a finger is on the bar or swiping. A skip adding up as one of those comes is let
  // go: what it counted from is no longer playing, or the viewer has chosen another way.
  const lastTap = useRef<{ at: number; side: TapSide } | null>(null);
  const tapTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const skipsAddUp =
    !!session && !waiting && !problem && !state.live && panel === null && !scrubbing;
  if (pending && !skipsAddUp) setPending(null);
  useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(() => {
      setPending(null);
      // Taps that came back to where they began go nowhere, and say nothing.
      if (skipTotal(pending) === 0) return;
      jump(pending.origin, pending.target);
      Haptics.selectionAsync().catch(() => undefined);
    }, SKIP_LANDS_AFTER_MS);
    return () => clearTimeout(timer);
  }, [pending, jump]);
  const skip = useCallback(
    (seconds: number) => {
      if (!session) return;
      const origin = session.trustedPosition() ?? session.get().position;
      session.seek(origin + seconds);
    },
    [session],
  );
  /** One tap or press of a skip: -1 back, 1 forward. */
  const skipBy = (direction: -1 | 1) => {
    if (!session) return;
    if (state.live) {
      skip(direction * SKIP_S);
      return;
    }
    if (!skipsAddUp) return;
    const position = session.trustedPosition() ?? state.position;
    setPending((adding) => addSkip(adding, direction, position, state.duration));
  };
  const onSurfaceTap = (x: number, width: number) => {
    noteInput();
    const side = tapSide(x, width);
    const now = Date.now();
    if (readTap(lastTap.current, pending !== null, now, side) !== 'single') {
      clearTimeout(tapTimer.current);
      lastTap.current = null;
      skipBy(side === 'left' ? -1 : 1);
      return;
    }
    lastTap.current = { at: now, side };
    clearTimeout(tapTimer.current);
    tapTimer.current = setTimeout(() => setControls((shownNow) => !shownNow), DOUBLE_TAP_MS);
  };
  const surfaceWidth = useRef(1);

  // Swipe to seek: a finger dragged sideways across the picture moves where to play from, with
  // a still of that scene, and the player goes there as it lifts. Taps and double taps work as
  // before; a touch only becomes a swipe once it has moved sideways, and one starting at the
  // screen's edge is left to Android's back gesture. Not on a broadcast, while a stream opens or
  // fails, or with a panel open.
  const [swipe, setSwipe] = useState<{ origin: number; target: number } | null>(null);
  // Where a finger on the seek bar is, and where the video was as it went down, for the same
  // scene preview and for Back to.
  const [barAt, setBarAt] = useState<number | null>(null);
  const [barFrom, setBarFrom] = useState(0);
  // Where the finger went down, in the page.
  const touchStart = useRef({ x: 0, y: 0 });
  const swipeAllowed = !!session && !waiting && !problem && !state.live && panel === null;
  const swipeLands = (origin: number, pageX: number) =>
    swipeTarget(origin, pageX - touchStart.current.x, surfaceWidth.current, state.duration);
  const endSwipe = (pageX: number | null) => {
    const from = swipe;
    setSwipe(null);
    setScrubbing(false);
    if (!from || pageX === null || !session) return;
    const target = swipeLands(from.origin, pageX);
    if (!swipeMoves(from.origin, target)) return;
    jump(from.origin, target);
    Haptics.selectionAsync().catch(() => undefined);
  };
  const swipeHandlers = {
    onStartShouldSetResponderCapture: (event: GestureResponderEvent) => {
      touchStart.current = { x: event.nativeEvent.pageX, y: event.nativeEvent.pageY };
      // The tap below still takes the touch; it only becomes a swipe once it moves sideways.
      return false;
    },
    onMoveShouldSetResponderCapture: (event: GestureResponderEvent) => {
      if (!swipeAllowed || swipe) return false;
      const start = touchStart.current;
      return (
        !startsAtEdge(start.x, surfaceWidth.current) &&
        isSwipe(event.nativeEvent.pageX - start.x, event.nativeEvent.pageY - start.y)
      );
    },
    onResponderGrant: () => {
      if (!session) return;
      const origin = session.trustedPosition() ?? session.get().position;
      noteInput();
      clearTimeout(tapTimer.current);
      lastTap.current = null;
      setScrubbing(true);
      setControls(false);
      setSwipe({ origin, target: origin });
    },
    onResponderMove: (event: GestureResponderEvent) => {
      if (!swipe) return;
      const target = swipeLands(swipe.origin, event.nativeEvent.pageX);
      if (target !== swipe.target) setSwipe({ origin: swipe.origin, target });
    },
    onResponderRelease: (event: GestureResponderEvent) => endSwipe(event.nativeEvent.pageX),
    onResponderTerminate: () => endSwipe(null),
    onResponderTerminationRequest: () => false,
  };
  // Frames for the scene preview come from the stream playing; another stream starts over.
  const frameKey =
    shown && state.entry && !state.live ? `${entryKey(state.entry)}|${state.engine ?? ''}` : null;
  useEffect(() => sceneFrames.reset(frameKey), [frameKey]);

  // Skip intro and Skip recap, from IntroDB's timings as on the TV: a pill in the corner for a
  // few seconds as the intro or recap starts, and again whenever the controls are up during it.
  // It only offers; it never skips by itself. Never over a clip, a broadcast or sports.
  const skips = marks.segments;
  const skipping =
    state.clip || state.live ? undefined : skipAt(skips, state.position, state.duration);
  // The intro or recap the pill was for, and where it first showed.
  const [skipShown, setSkipShown] = useState<{ key: string; at: number } | null>(null);
  if (skipping && !waiting) {
    const key = skipKey(skipping);
    if (!skipShown || skipShown.key !== key || skipRearms(skipShown.at, state.position)) {
      setSkipShown({ key, at: state.position });
    }
  }
  const skipFresh =
    !!skipping &&
    skipShown?.key === skipKey(skipping) &&
    !skipCardDone(skipShown.at, state.position, state.rate);
  const skipUp =
    !!skipping && !waiting && !problem && panel === null && !scrubbing && (controls || skipFresh);
  const skipSegment = () => {
    if (!session || !skipping) return;
    noteInput();
    // A skip still adding up would undo it.
    setPending(null);
    jump(session.trustedPosition() ?? state.position, skipping.end, false);
    // A learned intro skipped can be corrected as the skip it was learned from.
    introGuess.current = skipping.learned ? { start: skipping.start, end: skipping.end } : null;
  };
  const goBackTo = () => {
    if (!session || !backTo) return;
    noteInput();
    setPending(null);
    setBackTo(null);
    session.seek(backTo.at);
    // Going back is not playback going on from a skip: no intro is learned from it.
    introGuess.current = null;
  };

  // The scene preview, for a swipe or a finger on the bar, names the intro or recap it lands in.
  const previewAt = swipe ? swipe.target : barAt;
  const previewIn =
    previewAt === null
      ? undefined
      : skips.find((segment) => previewAt >= segment.start && previewAt < segment.end);
  const previewTag = previewIn
    ? t(previewIn.kind === 'intro' ? 'phone.sceneIntro' : 'phone.sceneRecap')
    : undefined;

  // Quality, as on the TV: at each resolution, the stream closest to what plays, in the
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
  const currentQuality = state.entry?.facts.resolution ?? 'other';
  // Whether Quality offers something smaller than what is playing.
  const lowerChoice = useMemo(() => {
    const index = choices.findIndex((c) => (c.resolution ?? 'other') === currentQuality);
    if (index < 0) return choices.length > 1;
    return choices.slice(index + 1).some((c) => c.resolution !== undefined);
  }, [choices, currentQuality]);
  const qualityValue = resolutionLabel(state.entry?.facts.resolution) ?? t('player.otherQuality');
  // The note about a quality switch lasts while that stream opens.
  const [switching, setSwitching] = useState<{ entry: StreamEntry; label?: string } | null>(null);
  useEffect(() => {
    if (!session || !switching) return;
    return session.subscribe(() => {
      const { entry, status } = session.get();
      if (entry !== switching.entry || (status !== 'idle' && status !== 'loading')) {
        setSwitching(null);
      }
    });
  }, [session, switching]);
  const pickQuality = (value: string) => {
    setPanel(null);
    // The resolution already playing stays as it is, whichever stream at it is playing.
    if (value === currentQuality) return;
    const choice = choices.find((c) => (c.resolution ?? 'other') === value);
    if (!session || !choice) return;
    // A paused film stays paused, and a note says what is coming.
    session.play(choice.entry, session.carryOn(), {
      chosen: true,
      paused: state.status === 'paused',
    });
    const label = resolutionLabel(choice.resolution);
    setSwitching(label ? { entry: choice.entry, label } : { entry: choice.entry });
  };

  // "English audio: switch stream", as on the TV: audio in the language wanted (the app's own
  // when none was chosen) from another stream, when this one has no track in it.
  const switchLanguage = wantedAudio(metaId) || i18n.language;
  const switchTo = useMemo(
    () =>
      reference
        ? audioSwitch(
            state.audio,
            reference,
            finderState.candidates,
            switchLanguage,
            finder.orderOptions(),
          )
        : undefined,
    [state.audio, reference, finderState.candidates, switchLanguage, finder],
  );
  const switchDetail = switchTo && resolutionLabel(switchTo.facts.resolution);
  /** Plays the other stream from where the film is, and keeps the language for the title. */
  const switchForAudio = (entry: StreamEntry, language: string) => {
    setPanel(null);
    if (!session) return;
    chooseAudioLanguage(metaId, language);
    session.play(entry, session.carryOn(), { chosen: true, paused: state.status === 'paused' });
    setSwitching({ entry });
  };

  const clock = useCallback(() => element.currentTime, [element]);
  const title = item?.name ?? '';
  const subtitle = episodeLabel(current);
  const toast = (() => {
    if (switching && waiting && state.entry === switching.entry) {
      return switching.label
        ? t('player.switchingTo', { quality: switching.label })
        : t('player.switchingStream');
    }
    if (state.steppedDown && waiting) return t('player.steppingDown');
    if (state.failedOver && waiting) return t('player.tryingAnother');
    if (state.struggling && buffering) {
      return t(lowerChoice ? 'player.keepsBuffering' : 'player.keepsBufferingStreams');
    }
    if (subtitles.failed && !waiting) return t('player.subtitlesFailed');
    return undefined;
  })();

  const tryAgain = () => {
    if (!session) return;
    if (nothing) {
      setNothing(false);
      finder.retry();
      void finder.choose().then((entry) => {
        if (entry) session.play(entry, resumedAt);
        else setNothing(true);
      });
    } else if (state.entry) {
      session.play(state.entry, session.carryOn());
    }
  };

  const pickStream = (entry: StreamEntry) => {
    setPanel(null);
    if (!session) return;
    if (state.entry && entryKey(entry) === entryKey(state.entry)) return;
    session.play(entry, state.entry ? session.carryOn() : resumedAt, {
      chosen: true,
      handPicked: true,
      paused: state.status === 'paused',
    });
  };

  const chooseSubtitle = (choice: SubtitleChoice) => {
    subtitles.choose(choice);
    setPanel(null);
  };

  const backdrop = item?.background ?? item?.poster;

  return (
    <View
      style={styles.screen}
      onLayout={(event) => {
        surfaceWidth.current = event.nativeEvent.layout.width;
      }}
    >
      <StatusBar hidden />
      {shown ? (
        <VideoView
          ref={videoView}
          player={phonePlayer()}
          style={styles.video}
          contentFit="contain"
          nativeControls={false}
          allowsPictureInPicture
          // Home or a swipe away while a film plays keeps it going in a small window.
          startsPictureInPictureAutomatically={playing && !problem}
          onPictureInPictureStart={() => {
            pictureInPicture.set(true);
            setPanel(null);
            setControls(false);
          }}
          onPictureInPictureStop={() => {
            pictureInPicture.set(false);
            // The small window was closed rather than opened full again: stop there.
            if (AppState.currentState !== 'active' && session) {
              session.pause();
              session.saveProgress();
            }
          }}
        />
      ) : null}

      <View style={StyleSheet.absoluteFill} {...swipeHandlers}>
        {/* Measured in the page, as the swipe is: the picture fills the screen, and the web
            build's taps arrive as clicks, which have no locationX. */}
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={(event) => onSurfaceTap(event.nativeEvent.pageX, surfaceWidth.current)}
          accessibilityLabel={controls ? undefined : t('phone.playLabel')}
        />
      </View>

      <SubtitleText
        cues={subtitles.cues}
        offset={subtitles.offset}
        clock={clock}
        raised={controls}
        look={prefs.subtitleStyle}
      />

      {!pip && (waiting || problem) ? (
        <View style={StyleSheet.absoluteFill}>
          {backdrop ? (
            <Artwork
              src={phoneArt(backdrop)}
              retrySrc={backdrop}
              seed={metaId}
              style={StyleSheet.absoluteFill}
            />
          ) : null}
          <View style={[StyleSheet.absoluteFill, styles.dim]} />
        </View>
      ) : null}

      {waiting && !pip ? (
        <View style={styles.centre} pointerEvents="none">
          <ActivityIndicator color={colors.prismTop} size="large" />
          <Text style={styles.waitTitle}>{title}</Text>
          {subtitle ? <Text style={styles.waitLine}>{subtitle}</Text> : null}
          <Text style={styles.waitLine}>{toast ?? t('phone.findingStream')}</Text>
        </View>
      ) : null}

      {buffering && !pip ? (
        <View style={styles.centre} pointerEvents="none">
          <ActivityIndicator color={colors.prismTop} size="large" />
        </View>
      ) : null}

      {problem && !pip ? (
        <View style={styles.centre}>
          <View style={styles.problem}>
            <Text style={styles.problemTitle}>{problemWords?.title}</Text>
            {problemWords?.lines.map((line) => (
              <Text key={line} style={styles.problemText}>
                {line}
              </Text>
            ))}
            {finderState.failed.length > 0 ? (
              <Text style={styles.problemText}>{addonsDidntAnswer(t, finderState.failed)}</Text>
            ) : null}
            <View style={styles.problemButtons}>
              {!nothing && session?.hasNext() ? (
                <Button
                  kind="primary"
                  label={t('player.problem.tryAnother')}
                  onPress={() => session.playNext()}
                />
              ) : null}
              <Button label={t('phone.sources')} onPress={() => setPanel('streams')} />
              <Button label={t('common.tryAgain')} onPress={tryAgain} />
              <Button label={t('common.back')} kind="quiet" onPress={goBack} />
            </View>
          </View>
        </View>
      ) : null}

      {controls && !problem && !pip ? (
        <View
          style={[
            StyleSheet.absoluteFill,
            styles.controls,
            {
              paddingLeft: Math.max(insets.left, space.xl),
              paddingRight: Math.max(insets.right, space.xl),
            },
          ]}
          pointerEvents="box-none"
        >
          <View style={styles.top}>
            <Pressable
              onPress={goBack}
              accessibilityRole="button"
              accessibilityLabel={t('phone.leavePlayer')}
              style={styles.iconButton}
            >
              <OutlineIcon name="back" size={22} />
            </Pressable>
            <View style={styles.titles}>
              <Text style={styles.title} numberOfLines={1}>
                {title}
              </Text>
              {subtitle ? (
                <Text style={styles.subtitle} numberOfLines={1}>
                  {subtitle}
                </Text>
              ) : null}
            </View>
            {state.live ? <Text style={styles.live}>{t('phone.live')}</Text> : null}
            <Pressable
              onPress={() => setPanel('tracks')}
              disabled={waiting}
              accessibilityRole="button"
              accessibilityLabel={t('phone.audioAndSubtitles')}
              accessibilityState={{ disabled: waiting }}
              style={[styles.iconButton, waiting && styles.disabled]}
            >
              <OutlineIcon name="captions" size={22} weight={1.8} />
            </Pressable>
            <Pressable
              onPress={() => setPanel('more')}
              accessibilityRole="button"
              accessibilityLabel={t('phone.moreOptions')}
              style={styles.iconButton}
            >
              <Icon name="more" size={22} />
            </Pressable>
          </View>

          {/* The scene preview takes the middle while a finger is on the bar. */}
          {!waiting && barAt === null ? (
            <View style={styles.middle} pointerEvents="box-none">
              <Pressable
                onPress={() => {
                  poke();
                  skipBy(-1);
                }}
                accessibilityRole="button"
                accessibilityLabel={t('phone.back10')}
                style={styles.skipButton}
              >
                <Icon name="replay10" size={32} />
              </Pressable>
              <Pressable
                onPress={() => {
                  poke();
                  session?.togglePlay();
                }}
                style={({ pressed }) => [styles.playButton, pressed && styles.playPressed]}
                accessibilityRole="button"
                accessibilityLabel={t(playing ? 'phone.pauseLabel' : 'phone.playLabel')}
              >
                <Icon name={playing ? 'pause' : 'play'} size={34} />
              </Pressable>
              <Pressable
                onPress={() => {
                  poke();
                  skipBy(1);
                }}
                accessibilityRole="button"
                accessibilityLabel={t('phone.forward10')}
                style={styles.skipButton}
              >
                <Icon name="forward10" size={32} />
              </Pressable>
            </View>
          ) : (
            <View style={styles.middle} pointerEvents="none" />
          )}

          <View style={[styles.bottom, { paddingBottom: Math.max(insets.bottom, space.l) }]}>
            {!state.live ? (
              <SeekBar
                // While a skip adds up, the bar shows where it will land.
                position={pending ? pending.target : state.position}
                duration={state.duration}
                onSeek={(seconds) => {
                  poke();
                  jump(barFrom, seconds);
                }}
                onScrubbing={setScrubbing}
                onScrubAt={(seconds) => {
                  if (seconds !== null && barAt === null) {
                    setBarFrom(session?.trustedPosition() ?? state.position);
                  }
                  setBarAt(seconds);
                }}
                {...(offersNext && next
                  ? {
                      right: (
                        <Pressable
                          onPress={() => playEpisode(next)}
                          accessibilityRole="button"
                          hitSlop={(touch.min - touch.chip) / 2}
                          style={({ pressed }) => [styles.pill, pressed && styles.pillPressed]}
                        >
                          <Text style={styles.pillText}>
                            {nextCount !== null
                              ? t('phone.nextIn', { seconds: nextCount })
                              : t('phone.nextEpisode')}
                          </Text>
                        </Pressable>
                      ),
                    }
                  : {})}
              />
            ) : null}
          </View>
        </View>
      ) : null}

      {/* Over the controls, so its total reads while they are up; it takes no touches. Keyed by
          side, so it fades in afresh where the total turns round. */}
      {pending ? (
        <SkipRipple
          key={pending.side}
          side={pending.side}
          total={skipTotal(pending)}
          target={pending.target}
        />
      ) : null}

      {previewAt !== null && !problem ? (
        <ScenePreview
          at={previewAt}
          origin={swipe ? swipe.origin : barFrom}
          duration={state.duration}
          swiping={swipe !== null}
          {...(previewTag ? { tag: previewTag } : {})}
        />
      ) : null}

      {skipUp && skipping ? (
        <Pressable
          onPress={skipSegment}
          accessibilityRole="button"
          hitSlop={(touch.min - SKIP_PILL_H) / 2}
          style={({ pressed }) => [
            styles.skipPill,
            {
              right: Math.max(insets.right, space.xl),
              // Over the seek bar while the controls are up.
              bottom: controls ? SKIP_RAISED + insets.bottom : Math.max(insets.bottom, space.xl),
            },
            pressed && styles.skipPillPressed,
          ]}
        >
          <Text style={styles.skipPillText}>
            {t(skipping.kind === 'intro' ? 'player.skipIntro' : 'player.skipRecap')}
          </Text>
        </Pressable>
      ) : null}

      {/* Top centre, under the title row: Skip intro, Up Next and Next episode all sit bottom
          right and subtitles at the bottom, so it never covers any of them, and it stays where
          it is as the controls come and go. It makes way for the scene preview. */}
      {backTo && !waiting && !problem && !state.live && previewAt === null ? (
        <Pressable
          onPress={goBackTo}
          accessibilityRole="button"
          accessibilityLabel={t('phone.backToLabel', { time: formatTime(backTo.at) })}
          hitSlop={(touch.min - SKIP_PILL_H) / 2}
          style={({ pressed }) => [
            styles.skipPill,
            styles.backToPill,
            pressed && styles.skipPillPressed,
          ]}
        >
          <Text style={styles.skipPillText}>
            {t('phone.backTo', { time: formatTime(backTo.at) })}
          </Text>
        </Pressable>
      ) : null}

      {!controls &&
      !problem &&
      !pip &&
      (creditsUp || (counting && playing) || (ended && decision === 'hold')) &&
      next ? (
        <View style={[styles.upNext, { right: Math.max(insets.right, space.xl) }]}>
          <Text style={styles.upNextTitle}>{t('phone.upNext')}</Text>
          <Text style={styles.upNextLine} numberOfLines={1}>
            {episodeLabel(next) ?? next.title}
          </Text>
          <View style={styles.upNextButtons}>
            <Button
              kind="primary"
              label={
                creditsUp && creditsLeft === null
                  ? t('phone.playNow')
                  : `${t('phone.playNow')} (${creditsUp ? creditsLeft : count})`
              }
              onPress={() => playEpisode(next)}
            />
            {creditsUp ? (
              <Button
                label={t('phone.watchCredits')}
                onPress={() => setCreditsCard((card) => card && { ...card, gone: true })}
              />
            ) : (
              <Button label={t('phone.keepWatching')} onPress={() => setDismissed(true)} />
            )}
          </View>
        </View>
      ) : null}

      {ended && decision === 'ask' && next && !pip ? (
        <View style={styles.centre}>
          <View style={styles.problem}>
            <Text style={styles.problemTitle}>{t('phone.stillWatching')}</Text>
            <Text style={styles.problemText}>{t('phone.stillWatchingLead')}</Text>
            <View style={styles.problemButtons}>
              <Button
                kind="primary"
                label={t('phone.nextEpisode')}
                onPress={() => {
                  noteInput();
                  playEpisode(next);
                }}
              />
              <Button label={t('phone.stop')} onPress={goBack} />
            </View>
          </View>
        </View>
      ) : null}

      {toast && !waiting && !pip ? (
        <View style={styles.toast} pointerEvents="none">
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      ) : null}

      <SidePanel
        visible={panel === 'tracks'}
        title={t('phone.audioAndSubtitles')}
        onClose={() => setPanel(null)}
      >
        {/* SidePanel builds its body only while it can be seen, so the panel mounts afresh at
            each opening and its rows take their places anew. */}
        {() => (
          <TracksPanel
            subtitles={subtitles}
            entry={state.entry}
            onChoose={chooseSubtitle}
            onStyle={() => setPanel('style')}
            audioRows={
              // The Audio tab: the stream's audio tracks, then another stream in the language
              // wanted when this one has none in it.
              state.audio.length > 0 || switchTo
                ? [
                    ...state.audio.map((track) => {
                      const detail = audioDetail(track);
                      return (
                        <PanelOption
                          key={track.id}
                          label={audioSummary(track)}
                          {...(detail ? { detail } : {})}
                          selected={track.active}
                          onPress={() => {
                            session?.selectAudio(track.id);
                            if (track.lang) chooseAudioLanguage(metaId, track.lang);
                            setPanel(null);
                          }}
                        />
                      );
                    }),
                    switchTo ? (
                      <PanelOption
                        key="audio-switch"
                        label={t('player.audioSwitch', { language: languageName(switchLanguage) })}
                        {...(switchDetail ? { detail: switchDetail } : {})}
                        onPress={() => switchForAudio(switchTo, switchLanguage)}
                      />
                    ) : null,
                  ]
                : null
            }
          />
        )}
      </SidePanel>

      <SidePanel
        visible={panel === 'style'}
        title={t('player.style')}
        onClose={() => setPanel('tracks')}
      >
        {() => <SubtitleStyleChoices />}
      </SidePanel>

      <SidePanel visible={panel === 'more'} title={t('phone.more')} onClose={() => setPanel(null)}>
        {() => (
          <PanelColumn>
            <PanelOption
              label={t('player.quality')}
              detail={qualityValue}
              accessibilityLabel={`${t('player.quality')}, ${qualityValue}`}
              disabled={!state.entry}
              onPress={() => setPanel('quality')}
            />
            <PanelOption label={t('phone.sources')} onPress={() => setPanel('streams')} />
            {shown ? <PanelOption label={t('phone.pictureInPicture')} onPress={startPip} /> : null}
          </PanelColumn>
        )}
      </SidePanel>

      <SidePanel
        visible={panel === 'quality'}
        title={t('player.quality')}
        onClose={() => setPanel(null)}
      >
        {() => (
          <ScrollView>
            {choices.length <= 1 ? (
              <Text style={styles.sheetNote}>
                {choices.length === 1
                  ? t('player.onlyQuality', {
                      quality: resolutionLabel(choices[0]?.resolution) ?? t('player.otherQuality'),
                    })
                  : t('player.noOtherQuality')}
              </Text>
            ) : null}
            {choices.map((choice) => {
              const value = choice.resolution ?? 'other';
              return (
                <PanelOption
                  key={value}
                  label={resolutionLabel(choice.resolution) ?? t('player.otherQuality')}
                  {...(choice.otherLanguages
                    ? {
                        detail: t('player.otherAudio', {
                          languages: choice.otherLanguages.map(languageName).join(', '),
                        }),
                      }
                    : {})}
                  selected={value === currentQuality}
                  onPress={() => pickQuality(value)}
                />
              );
            })}
          </ScrollView>
        )}
      </SidePanel>

      <SidePanel
        visible={panel === 'streams'}
        title={t('phone.sources')}
        onClose={() => setPanel(null)}
      >
        {() => (
          <StreamList
            finder={finder}
            {...(state.entry ? { playingKey: entryKey(state.entry) } : {})}
            onPick={pickStream}
          />
        )}
      </SidePanel>
    </View>
  );
}

const styles = StyleSheet.create({
  // Sized as well as placed: the web build draws a <video>, which keeps its own size otherwise.
  video: { position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' },
  screen: { flex: 1, backgroundColor: colors.playerBg },
  dim: { backgroundColor: 'rgba(0,0,0,0.6)' },
  centre: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.s,
    padding: space.xl,
  },
  waitTitle: { ...type.title, color: colors.text, textAlign: 'center' },
  waitLine: { ...type.body, color: colors.textMuted, textAlign: 'center' },
  problem: {
    maxWidth: 520,
    backgroundColor: colors.surface2,
    borderRadius: radius.l,
    padding: space.xl,
    gap: space.s,
  },
  problemTitle: { ...type.title, color: colors.text },
  problemText: { ...type.body, color: colors.textMuted },
  problemButtons: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s, marginTop: space.s },
  controls: { backgroundColor: colors.playerDim, justifyContent: 'space-between' },
  top: { flexDirection: 'row', alignItems: 'center', gap: space.s, paddingTop: space.m },
  iconButton: {
    width: touch.min,
    height: touch.min,
    borderRadius: touch.min / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: { opacity: 0.45 },
  titles: { flex: 1, marginLeft: space.xs },
  title: { ...type.body, fontSize: 16, fontWeight: '700', color: colors.text },
  subtitle: { ...type.small, color: colors.textMuted },
  live: {
    ...type.label,
    color: colors.text,
    backgroundColor: '#D7263D',
    paddingHorizontal: space.s,
    borderRadius: radius.s,
    overflow: 'hidden',
  },
  // Calm controls: line glyphs, no fills, and one soft circle behind Play.
  middle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 88 },
  skipButton: {
    width: touch.skip,
    height: touch.skip,
    borderRadius: touch.skip / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playButton: {
    width: touch.playBig,
    height: touch.playBig,
    borderRadius: touch.playBig / 2,
    backgroundColor: colors.controlPress,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playPressed: { backgroundColor: colors.barBuffer },
  bottom: { gap: space.xs },
  pill: {
    minHeight: 36,
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.barBuffer,
  },
  pillPressed: { backgroundColor: colors.controlPress },
  // Skip intro: quiet, as the controls are: a dark pill with a fine edge, no fill colour.
  skipPill: {
    position: 'absolute',
    height: SKIP_PILL_H,
    justifyContent: 'center',
    paddingHorizontal: space.l,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.barBuffer,
    backgroundColor: colors.scrim,
  },
  skipPillPressed: { backgroundColor: colors.controlPress },
  skipPillText: { ...type.label, color: colors.text },
  // Back to looks as Skip intro does.
  backToPill: { top: BACK_TO_TOP, alignSelf: 'center' },
  pillText: { ...type.meta, fontWeight: '700', color: colors.text },
  upNext: {
    position: 'absolute',
    bottom: space.xl,
    width: 320,
    backgroundColor: colors.surface2,
    borderRadius: radius.l,
    padding: space.l,
    gap: space.xs,
  },
  upNextTitle: { ...type.small, color: colors.accent },
  upNextLine: { ...type.label, color: colors.text },
  upNextButtons: { flexDirection: 'row', gap: space.s, marginTop: space.s },
  toast: {
    position: 'absolute',
    top: space.xl,
    alignSelf: 'center',
    backgroundColor: colors.surface2,
    borderRadius: radius.pill,
    paddingHorizontal: space.l,
    paddingVertical: space.s,
  },
  toastText: { ...type.label, color: colors.text },
  sheetNote: { ...type.small, color: colors.textMuted, padding: space.m },
});
