import {
  askStillWatching,
  bingeEntry,
  bingeHint,
  endAction,
  inLastStretch,
  languageName,
  nextVideo,
  parseRuntime,
  playedCard,
  qualityChoices,
  type QualityReference,
  rearms,
  secondsToEnd,
  skipAt,
  skipCardDone,
  skipKey,
  skipRearms,
  type StreamEntry,
  UP_NEXT_AFTER_END_S,
} from '@bannertv/core';
import type { MetaDetail, MetaPreview, Video } from '@bannertv/protocol';
import { addonClient } from '@tv/data/addons';
import { playedVideos, progress } from '@tv/data/playback';
import { preferences } from '@tv/data/preferences';
import { useSkipSegments } from '@tv/data/skips';
import { chooseAudioLanguage, wantedAudio } from '@tv/data/tracks';
import { useQuery } from '@tv/data/use-query';
import { noteInput, sinceInput } from '@tv/navigation/activity';
import { audioDetail, audioSummary, pickAudio } from '@tv/player/audio';
import { resolutionLabel } from '@tv/player/describe';
import { entryKey, holdProbing, streamFinder } from '@tv/player/finder';
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
import { SubtitleStyleChoices } from './SubtitleStyle';
import { SubtitleText } from './SubtitleText';
import { isSwipe, startsAtEdge, swipeMoves, swipeTarget } from './swipe-seek';
import { asVideoElement, PhoneVideoElement } from './video-element';

const CONTROLS_HIDE_MS = motion.controlsHide;
const DOUBLE_TAP_MS = 280;
const SKIP_S = 10;
/** The next episode's streams are looked up this long before the end. */
const PREFETCH_NEXT_S = 120;
/** The Skip intro pill's height, and how far up it sits while the controls show the seek bar. */
const SKIP_PILL_H = 40;
const SKIP_RAISED = 112;
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
  const { t } = useTranslation();
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
    void progress
      .load()
      .catch(() => undefined)
      .then(async () => {
        if (cancelled) return;
        const start = route.startAt ?? progress.resumeAt(videoId) ?? 0;
        setResumedAt(start);
        const entry = route.stream ?? (await finder.choose(route.binge));
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

  const subtitles = useSubtitles(titleType, videoId, metaId, state.entry, session, state);
  useScrobble(
    session,
    state,
    { type: titleType, metaId, videoId },
    finder.runtimeSeconds,
    finder.knownRuntimeSeconds,
  );

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
  useEffect(() => {
    if (!next) return;
    if (ended || (state.duration > 0 && state.duration - state.position <= PREFETCH_NEXT_S)) {
      streamFinder(titleType, next.id).start();
    }
  }, [next, ended, state.duration, state.position, titleType]);

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
  const held = panel !== null || waiting || problem || scrubbing;
  const inStretch = offersNext && inLastStretch(state.position, state.duration, state.rate);
  const counting = inStretch && !dismissed && !held;
  const count = ended
    ? (afterEnd ?? UP_NEXT_AFTER_END_S)
    : (secondsToEnd(state.position, state.duration, state.rate) ?? 0);
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
      if (counting || (ended && decision === 'hold')) {
        setDismissed(true);
        return true;
      }
      return false;
    });
    return () => subscription.remove();
  }, [panel, counting, ended, decision]);

  // Taps: one shows or hides the controls; two on a side skip ten seconds.
  const lastTap = useRef<{ at: number; side: 'left' | 'right' } | null>(null);
  const tapTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const skip = useCallback(
    (seconds: number) => {
      if (!session) return;
      const origin = session.trustedPosition() ?? session.get().position;
      session.seek(origin + seconds);
    },
    [session],
  );
  const onSurfaceTap = (x: number, width: number) => {
    noteInput();
    const side = x < width / 2 ? 'left' : 'right';
    const now = Date.now();
    if (
      lastTap.current &&
      now - lastTap.current.at < DOUBLE_TAP_MS &&
      lastTap.current.side === side
    ) {
      clearTimeout(tapTimer.current);
      lastTap.current = null;
      skip(side === 'left' ? -SKIP_S : SKIP_S);
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
  // fails, with a panel open, or in picture-in-picture.
  const [swipe, setSwipe] = useState<{ origin: number; target: number } | null>(null);
  // Where a finger on the seek bar is, and where the video was as it went down, for the same
  // scene preview.
  const [barAt, setBarAt] = useState<number | null>(null);
  const [barFrom, setBarFrom] = useState(0);
  // Where the finger went down, in the page.
  const touchStart = useRef({ x: 0, y: 0 });
  const swipeAllowed = !!session && !waiting && !problem && !pip && !state.live && panel === null;
  const swipeLands = (origin: number, pageX: number) =>
    swipeTarget(origin, pageX - touchStart.current.x, surfaceWidth.current, state.duration);
  const endSwipe = (pageX: number | null) => {
    const from = swipe;
    setSwipe(null);
    setScrubbing(false);
    if (!from || pageX === null || !session) return;
    const target = swipeLands(from.origin, pageX);
    if (!swipeMoves(from.origin, target)) return;
    session.seek(target);
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
  // It only offers; it never skips by itself. Never over a clip, a broadcast or sports, and never
  // in picture-in-picture, where the window is too small to tap it.
  const skips = useSkipSegments(titleType, videoId, !sportsEvent);
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
    !!skipping &&
    !waiting &&
    !problem &&
    !pip &&
    panel === null &&
    !scrubbing &&
    (controls || skipFresh);
  const skipSegment = () => {
    if (!session || !skipping) return;
    noteInput();
    session.seek(skipping.end);
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
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={(event) => onSurfaceTap(event.nativeEvent.locationX, surfaceWidth.current)}
          accessibilityLabel={controls ? undefined : t('phone.playLabel')}
        />
      </View>

      <SubtitleText
        cues={subtitles.cues}
        offset={subtitles.offset}
        clock={clock}
        raised={controls}
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
            <Text style={styles.problemTitle}>
              {t(nothing ? 'player.problem.nothingTitle' : 'player.problem.failedTitle')}
            </Text>
            <Text style={styles.problemText}>
              {nothing
                ? t('player.problem.nothing')
                : t(`player.problem.${state.error?.kind ?? 'other'}`)}
            </Text>
            {finderState.failed.length > 0 ? (
              <Text style={styles.problemText}>
                {t('player.problem.addonsFailed', { count: finderState.failed.length })}
              </Text>
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
                  skip(-SKIP_S);
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
                  skip(SKIP_S);
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
                position={state.position}
                duration={state.duration}
                onSeek={(seconds) => {
                  poke();
                  session?.seek(seconds);
                }}
                onScrubbing={setScrubbing}
                onScrubAt={(seconds) => {
                  if (seconds !== null && barAt === null) setBarFrom(state.position);
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
                            {counting
                              ? t('phone.nextIn', { seconds: count })
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

      {previewAt !== null && !problem && !pip ? (
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

      {!controls &&
      !problem &&
      !pip &&
      ((counting && playing) || (ended && decision === 'hold')) &&
      next ? (
        <View style={[styles.upNext, { right: Math.max(insets.right, space.xl) }]}>
          <Text style={styles.upNextTitle}>{t('phone.upNext')}</Text>
          <Text style={styles.upNextLine} numberOfLines={1}>
            {episodeLabel(next) ?? next.title}
          </Text>
          <View style={styles.upNextButtons}>
            <Button
              kind="primary"
              label={`${t('phone.playNow')} (${count})`}
              onPress={() => playEpisode(next)}
            />
            <Button label={t('phone.keepWatching')} onPress={() => setDismissed(true)} />
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
        <View style={styles.columns}>
          {state.audio.length > 0 ? (
            <PanelColumn title={t('phone.audio')}>
              <ScrollView>
                {state.audio.map((track) => {
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
                })}
              </ScrollView>
            </PanelColumn>
          ) : null}
          <PanelColumn title={t('phone.subtitles')}>
            <ScrollView>
              <PanelOption
                label={t('phone.subtitlesOff')}
                selected={subtitles.choice === null}
                onPress={() => chooseSubtitle(null)}
              />
              {subtitles.tracks.map((track) => (
                <PanelOption
                  key={`track-${track.id}`}
                  label={languageName(track.lang) || track.label || t('common.unknown')}
                  detail={t('phone.embeddedSubtitles')}
                  selected={subtitles.choice?.kind === 'track' && subtitles.choice.id === track.id}
                  onPress={() => chooseSubtitle({ kind: 'track', id: track.id })}
                />
              ))}
              {subtitles.options.map((option) => {
                const status = subtitles.statusOf({ kind: 'file', key: option.key });
                return (
                  <PanelOption
                    key={`file-${option.key}`}
                    label={languageName(option.lang) || option.lang}
                    detail={[
                      t('phone.fromAddon', { addon: option.source }),
                      status === 'loading' ? t('common.loading') : '',
                      status === 'failed' ? t('player.subtitlesFailed') : '',
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                    selected={
                      subtitles.choice?.kind === 'file' && subtitles.choice.key === option.key
                    }
                    onPress={() => chooseSubtitle({ kind: 'file', key: option.key })}
                  />
                );
              })}
              {subtitles.pending > 0 ? (
                <Text style={styles.sheetNote}>{t('common.loading')}</Text>
              ) : null}
              <PanelOption
                label={t('player.style')}
                detail={t('phone.styleFor')}
                onPress={() => setPanel('style')}
              />
            </ScrollView>
          </PanelColumn>
        </View>
      </SidePanel>

      <SidePanel
        visible={panel === 'style'}
        title={t('player.style')}
        onClose={() => setPanel('tracks')}
      >
        <SubtitleStyleChoices />
      </SidePanel>

      <SidePanel visible={panel === 'more'} title={t('phone.more')} onClose={() => setPanel(null)}>
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
      </SidePanel>

      <SidePanel
        visible={panel === 'quality'}
        title={t('player.quality')}
        onClose={() => setPanel(null)}
      >
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
      </SidePanel>

      <SidePanel
        visible={panel === 'streams'}
        title={t('phone.sources')}
        onClose={() => setPanel(null)}
      >
        <StreamList
          finder={finder}
          {...(state.entry ? { playingKey: entryKey(state.entry) } : {})}
          onPick={pickStream}
        />
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
  pillText: { ...type.meta, fontWeight: '700', color: colors.text },
  columns: { flex: 1, flexDirection: 'row', gap: 18 },
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
