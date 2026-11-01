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
  type StreamEntry,
  UP_NEXT_AFTER_END_S,
} from '@bannertv/core';
import type { MetaDetail, MetaPreview, Video } from '@bannertv/protocol';
import { phonePlayer, pictureShown } from '@phone/player/phone-host';
import { asVideoElement, PhoneVideoElement } from '@phone/player/video-element';
import { Artwork } from '@phone/ui/Artwork';
import { addonClient, addonNames } from '@tv/data/addons';
import { playedVideos, progress } from '@tv/data/playback';
import { preferences, setSubtitleStyle, type SubtitleStyle } from '@tv/data/preferences';
import { chooseAudioLanguage, wantedAudio } from '@tv/data/tracks';
import { useQuery } from '@tv/data/use-query';
import { noteInput, sinceInput } from '@tv/navigation/activity';
import { audioDetail, audioSummary, pickAudio } from '@tv/player/audio';
import { resolutionLabel, streamRowText } from '@tv/player/describe';
import { entryKey, holdProbing, isHeavy, listOrder, streamFinder } from '@tv/player/finder';
import { formatClock } from '@tv/player/media';
import {
  createPlaybackSession,
  INITIAL_SESSION_STATE,
  type PlaybackSession,
} from '@tv/player/session';
import { autoplaysSinceInput, countAutoplay } from '@tv/player/sleep';
import { type SubtitleChoice, useSubtitles } from '@tv/screens/player/use-subtitles';
import { useScrobble } from '@tv/screens/player/use-scrobble';
import { VideoView } from 'expo-video';
import { LinearGradient } from 'expo-linear-gradient';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  AppState,
  BackHandler,
  StyleSheet,
  Text,
  useTVEventHandler,
  View,
} from 'react-native';
import { goBack, openPlayer, type PlayerRoute } from '../nav/routes';
import { remoteKey } from '../nav/remote';
import { Button } from '../ui/Button';
import { RoundButton } from '../ui/RoundButton';
import { Sheet, SheetColumn, SheetNote, SheetOption } from '../ui/Sheet';
import { tvArt } from '../ui/Tile';
import { useNow } from '../ui/use-now';
import { color, controls as sizes, layout, motion, px, spacing, type } from '../ui/theme';
import { endsAt, seekTarget } from './clock';
import { ProgressBar } from './ProgressBar';
import { SubtitleText } from './SubtitleText';

/** The next episode's streams are looked up this long before the end. */
const PREFETCH_NEXT_S = 120;
/** A run of left and right presses on the bar is sent as one seek once the presses stop. */
const SEEK_SETTLE_MS = 600;
/** The streams the More sheet lists; All streams on the title has every one. */
const MORE_STREAMS = 12;
const noop = () => () => undefined;
const SUBTITLE_SIZES: readonly SubtitleStyle['size'][] = ['small', 'medium', 'large', 'huge'];
const SUBTITLE_COLOURS: readonly SubtitleStyle['colour'][] = ['white', 'yellow', 'cyan', 'green'];

type Panel = 'tracks' | 'more' | null;

function episodeLabel(video: Video | undefined): string | undefined {
  if (!video || video.season === undefined || video.episode === undefined) return undefined;
  return `S${video.season}:E${video.episode}${video.title ? ` · ${video.title}` : ''}`;
}

/**
 * The player: the picture, and calm controls over a scrim at the bottom only. Android's player
 * draws the picture (expo-video, through the phone app's bridge); the shared session picks the
 * stream, fails over, saves the place and scrobbles, as on the LG and the phone.
 */
export function PlayerScreen({ route, active }: { route: PlayerRoute; active: boolean }) {
  const { type: titleType, metaId, videoId } = route;
  const { t } = useTranslation();
  const element = useMemo(() => new PhoneVideoElement(), []);
  const finder = useMemo(() => streamFinder(titleType, videoId), [titleType, videoId]);
  const [session, setSession] = useState<PlaybackSession | null>(null);
  const [nothing, setNothing] = useState(false);
  const [resumedAt, setResumedAt] = useState(0);
  const [openedAt] = useState(() => Date.now());
  const state = useSyncExternalStore(
    session ? session.subscribe : noop,
    session ? session.get : () => INITIAL_SESSION_STATE,
  );
  const finderState = useSyncExternalStore(finder.subscribe, finder.get);
  const shown = useSyncExternalStore(pictureShown.subscribe, pictureShown.get);
  const prefs = useSyncExternalStore(preferences.subscribe, preferences.get);

  const metaQuery = useMemo(
    () => (titleType === 'movie' ? null : addonClient.meta(titleType, metaId)),
    [titleType, metaId],
  );
  const meta: MetaDetail | undefined = useQuery(metaQuery).data;
  const item: MetaPreview | undefined = meta ?? route.preview;
  useEffect(() => finder.setRuntime(parseRuntime(item?.runtime)), [finder, item?.runtime]);

  // One session per video, made and destroyed with the screen, as on the phone and the LG.
  useEffect(() => {
    const releaseProbing = holdProbing();
    const created = createPlaybackSession({
      video: asVideoElement(element),
      type: titleType,
      metaId,
      videoId,
      finder,
      autoFailover: !route.chosen,
      remember: true,
      continueRow: true,
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
    };
    // One session per mounted player: each route is its own screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const waiting = !nothing && (state.status === 'idle' || state.status === 'loading');
  const problem = nothing || state.status === 'failed';
  const buffering = state.status === 'buffering';
  const playing = state.status === 'playing' || buffering;
  const ended = state.status === 'ended';

  // Controls: up on any key, gone again after a while of playing untouched.
  const [controlsUp, setControlsUp] = useState(true);
  const [panel, setPanel] = useState<Panel>(null);
  const [barFocused, setBarFocused] = useState(false);
  const [pokes, setPokes] = useState(0);
  const poke = useCallback(() => {
    noteInput();
    setControlsUp(true);
    setPokes((count) => count + 1);
  }, []);
  useEffect(() => {
    if (!controlsUp || state.status !== 'playing' || panel !== null) return;
    const timer = setTimeout(() => setControlsUp(false), motion.controlsHide);
    return () => clearTimeout(timer);
  }, [controlsUp, state.status, panel, pokes]);
  if (problem && panel !== null) setPanel(null);

  // Hiding the app pauses and saves.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'background' && session) {
        session.pause();
        session.saveProgress();
      }
    });
    return () => subscription.remove();
  }, [session]);

  const subtitles = useSubtitles(titleType, videoId, metaId, state.entry, session, state);
  useScrobble(session, state, { type: titleType, metaId, videoId }, finder.runtimeSeconds);

  // The language the viewer chose before, once per stream and engine.
  const audioDecided = useRef('');
  useEffect(() => {
    if (!session || !state.entry || state.audio.length < 2) return;
    const key = `${entryKey(state.entry)}|${state.engine ?? ''}`;
    if (audioDecided.current === key) return;
    audioDecided.current = key;
    const wanted = wantedAudio(metaId);
    if (!wanted) return;
    const match = pickAudio(state.audio, wanted, true);
    if (match && !match.active) session.selectAudio(match.id);
  }, [session, state.entry, state.engine, state.audio, metaId]);

  // The Continue Watching card: name, artwork and episode (the session saves the position).
  const recorded = useRef('');
  useEffect(() => {
    if (state.status !== 'playing' || state.live || !item) return;
    const card = playedCard(item, videoId, meta, { metaId, type: titleType });
    const key = [videoId, meta ? 'meta' : '', card.season, card.episode, card.next?.videoId].join(
      '|',
    );
    if (recorded.current === key) return;
    recorded.current = key;
    playedVideos.record(card);
  }, [state.status, state.live, item, meta, videoId, metaId, titleType]);

  // The next episode.
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

  // Up Next and the end of a video, decided by core's endAction as on the LG and the phone.
  const [dismissed, setDismissed] = useState(false);
  const [askAtEnd, setAskAtEnd] = useState<boolean | null>(null);
  const [afterEnd, setAfterEnd] = useState<number | null>(null);
  const [countSeen, setCountSeen] = useState(false);
  const held = panel !== null || waiting || problem;
  const inStretch = offersNext && inLastStretch(state.position, state.duration, state.rate);
  const counting = inStretch && !dismissed && !held;
  const count = ended
    ? (afterEnd ?? UP_NEXT_AFTER_END_S)
    : (secondsToEnd(state.position, state.duration, state.rate) ?? 0);
  if (dismissed && !waiting && !ended && rearms(state.position, state.duration, state.rate)) {
    setDismissed(false);
  }
  const seen = counting && playing && !controlsUp ? true : !counting && !ended ? false : countSeen;
  if (seen !== countSeen) setCountSeen(seen);
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

  // Back closes a sheet first, then Up Next, then leaves (the app's own Back).
  useEffect(() => {
    if (!active) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      noteInput();
      if (panel !== null) {
        setPanel(null);
        return true;
      }
      if (counting || (ended && decision === 'hold')) {
        setDismissed(true);
        return true;
      }
      session?.saveProgress();
      return false;
    });
    return () => subscription.remove();
  }, [active, panel, counting, ended, decision, session]);

  // Seeking: a run of presses moves a target along the bar, sent once the presses stop.
  const [seekTo, setSeekTo] = useState<number | null>(null);
  const seekTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(seekTimer.current), []);
  const nudge = useCallback(
    (step: number) => {
      if (!session || state.live) return;
      const from = seekTo ?? session.trustedPosition() ?? session.get().position;
      const target = seekTarget(from, step, state.duration);
      setSeekTo(target);
      clearTimeout(seekTimer.current);
      seekTimer.current = setTimeout(() => {
        session.seek(target);
        setSeekTo(null);
      }, SEEK_SETTLE_MS);
    },
    [session, seekTo, state.live, state.duration],
  );

  useTVEventHandler((event) => {
    if (!active) return;
    const press = remoteKey(event);
    if (!press || panel !== null) return;
    const { key } = press;
    if (key === 'playPause' || key === 'play' || key === 'pause') {
      poke();
      if (key === 'playPause') session?.togglePlay();
      else if (key === 'play') session?.resume();
      else session?.pause();
      return;
    }
    if (key === 'rewind' || key === 'fastForward') {
      poke();
      nudge(key === 'rewind' ? -sizes.seekStep : sizes.seekStep);
      return;
    }
    const wasHidden = !controlsUp;
    poke();
    // With the controls away, left and right seek straight away, as on every TV player.
    if ((wasHidden || barFocused) && (key === 'left' || key === 'right')) {
      nudge(key === 'left' ? -sizes.seekStep : sizes.seekStep);
    }
  });

  // Quality, as on the LG: at each resolution, the stream closest to what plays.
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
  const pickQuality = (value: string) => {
    setPanel(null);
    if (value === currentQuality) return;
    const choice = choices.find((c) => (c.resolution ?? 'other') === value);
    if (!session || !choice) return;
    session.play(choice.entry, session.carryOn(), {
      chosen: true,
      paused: state.status === 'paused',
    });
  };
  const streams = useMemo(
    () =>
      listOrder(finderState.entries, prefs.allStreamsOrder, finder.runtimeSeconds()).slice(
        0,
        MORE_STREAMS,
      ),
    [finderState.entries, prefs.allStreamsOrder, finder],
  );
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
  const chooseSubtitle = (choice: SubtitleChoice) => subtitles.choose(choice);

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

  const clock = useCallback(() => element.currentTime, [element]);
  const now = useNow(15_000);
  const title = item?.name ?? '';
  const subtitle = episodeLabel(current);
  const names = addonNames();
  const source = state.entry ? names.get(state.entry.addonId) : undefined;
  const ends = endsAt(state.position, state.duration, state.rate, now);
  const toast = (() => {
    if (state.steppedDown && waiting) return t('player.steppingDown');
    if (state.failedOver && waiting) return t('player.tryingAnother');
    if (state.struggling && buffering) return t('player.keepsBufferingPlain');
    if (subtitles.failed && !waiting) return t('player.subtitlesFailed');
    return undefined;
  })();
  const backdrop = item?.background ?? item?.poster;
  const showControls = controlsUp && !problem && panel === null && !waiting;

  return (
    <View style={styles.screen}>
      {shown ? (
        <VideoView
          player={phonePlayer()}
          style={StyleSheet.absoluteFill}
          contentFit="contain"
          nativeControls={false}
          allowsPictureInPicture={false}
        />
      ) : null}

      <SubtitleText
        cues={subtitles.cues}
        offset={subtitles.offset}
        clock={clock}
        look={prefs.subtitleStyle}
        raised={showControls}
      />

      {waiting || problem ? (
        <View style={StyleSheet.absoluteFill}>
          {backdrop ? (
            <Artwork
              src={tvArt(backdrop)}
              retrySrc={backdrop}
              seed={metaId}
              style={StyleSheet.absoluteFill}
            />
          ) : null}
          <View style={[StyleSheet.absoluteFill, styles.dim]} />
        </View>
      ) : null}

      {waiting ? (
        <View style={styles.centre} pointerEvents="none">
          <ActivityIndicator color={color.focus} size="large" />
          <Text style={styles.waitTitle}>{title}</Text>
          {subtitle ? <Text style={styles.waitLine}>{subtitle}</Text> : null}
          <Text style={styles.waitLine}>{toast ?? t('tv.findingStream')}</Text>
        </View>
      ) : null}

      {buffering ? (
        <View style={styles.centre} pointerEvents="none">
          <ActivityIndicator color={color.focus} size="large" />
        </View>
      ) : null}

      {problem ? (
        <View style={styles.centre}>
          <View style={styles.dialog}>
            <Text style={styles.dialogTitle}>
              {t(nothing ? 'player.problem.nothingTitle' : 'player.problem.failedTitle')}
            </Text>
            <Text style={styles.dialogText}>
              {nothing
                ? t('player.problem.nothing')
                : t(`player.problem.${state.error?.kind ?? 'other'}`)}
            </Text>
            {finderState.failed.length > 0 ? (
              <Text style={styles.dialogText}>
                {t('player.problem.addonsFailed', { count: finderState.failed.length })}
              </Text>
            ) : null}
            <View style={styles.dialogButtons}>
              {!nothing && session?.hasNext() ? (
                <Button
                  kind="primary"
                  label={t('player.problem.tryAnother')}
                  onPress={() => session.playNext()}
                  preferred={active}
                />
              ) : null}
              <Button
                label={t('common.tryAgain')}
                onPress={tryAgain}
                {...(nothing || !session?.hasNext() ? { preferred: active } : {})}
              />
              <Button label={t('player.problem.back')} onPress={() => goBack()} />
            </View>
          </View>
        </View>
      ) : null}

      {showControls ? (
        <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
          <LinearGradient
            colors={['rgba(5,3,10,0)', color.playerScrim, 'rgba(5,3,10,0.9)']}
            locations={[0, 0.5, 1]}
            style={styles.scrim}
            pointerEvents="none"
          />
          <LinearGradient
            colors={['rgba(5,3,10,0.7)', 'rgba(5,3,10,0)']}
            style={styles.topScrim}
            pointerEvents="none"
          />
          <View style={styles.top} pointerEvents="none">
            <View style={styles.titles}>
              <Text style={styles.title} numberOfLines={1}>
                {title}
              </Text>
              {subtitle || source ? (
                <Text style={styles.subtitle} numberOfLines={1}>
                  {[subtitle, source].filter(Boolean).join('  ·  ')}
                </Text>
              ) : null}
            </View>
            {state.live ? (
              <Text style={styles.live}>{t('player.live')}</Text>
            ) : ends !== null ? (
              <Text style={styles.ends}>{t('player.endsAt', { time: formatClock(ends) })}</Text>
            ) : null}
          </View>
          <View style={styles.bottom}>
            {!state.live ? (
              <ProgressBar
                position={state.position}
                duration={state.duration}
                target={seekTo}
                label={t('player.seek')}
                onFocus={() => setBarFocused(true)}
                onBlur={() => setBarFocused(false)}
              />
            ) : null}
            <View style={styles.buttons}>
              <RoundButton
                icon="subtitles"
                label={t('player.audioAndSubtitles')}
                onPress={() => setPanel('tracks')}
              />
              <RoundButton
                icon={playing ? 'pause' : 'play'}
                label={t(playing ? 'player.pause' : 'player.play')}
                onPress={() => {
                  poke();
                  session?.togglePlay();
                }}
                bright
                preferred={active && showControls}
              />
              {offersNext && next ? (
                <RoundButton
                  icon="next"
                  label={
                    counting ? t('player.nextIn', { seconds: count }) : t('player.nextEpisode')
                  }
                  onPress={() => playEpisode(next)}
                />
              ) : null}
              <RoundButton icon="more" label={t('tv.more')} onPress={() => setPanel('more')} />
            </View>
          </View>
        </View>
      ) : null}

      {!showControls &&
      !problem &&
      panel === null &&
      ((counting && playing) || (ended && decision === 'hold')) &&
      next ? (
        <View style={styles.upNext}>
          <Text style={styles.upNextTitle}>{t('player.upNext')}</Text>
          <Text style={styles.upNextLine} numberOfLines={1}>
            {episodeLabel(next) ?? next.title}
          </Text>
          <View style={styles.dialogButtons}>
            <Button
              kind="primary"
              label={t('player.playNextIn', { seconds: count })}
              onPress={() => playEpisode(next)}
              preferred={active}
            />
            <Button label={t('player.keepWatching')} onPress={() => setDismissed(true)} />
          </View>
        </View>
      ) : null}

      {ended && decision === 'ask' && next ? (
        <View style={styles.centre}>
          <View style={styles.dialog}>
            <Text style={styles.dialogTitle}>{t('player.stillWatching.title')}</Text>
            <Text style={styles.dialogText}>{t('player.stillWatching.message', { title })}</Text>
            <View style={styles.dialogButtons}>
              <Button
                kind="primary"
                label={t('player.stillWatching.play')}
                onPress={() => {
                  noteInput();
                  playEpisode(next);
                }}
                preferred={active}
              />
              <Button label={t('player.stillWatching.stop')} onPress={() => goBack()} />
            </View>
          </View>
        </View>
      ) : null}

      {toast && !waiting && !problem ? (
        <View style={styles.toast} pointerEvents="none">
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      ) : null}

      {panel === 'tracks' ? (
        <Sheet>
          <SheetColumn title={t('player.audio')}>
            {state.audio.length === 0 ? <SheetNote>{t('player.noAudioChoice')}</SheetNote> : null}
            {state.audio.map((track) => {
              const detail = audioDetail(track);
              return (
                <SheetOption
                  key={track.id}
                  label={audioSummary(track)}
                  {...(detail ? { detail } : {})}
                  selected={track.active}
                  {...(track.active ? { preferred: true } : {})}
                  onPress={() => {
                    session?.selectAudio(track.id);
                    if (track.lang) chooseAudioLanguage(metaId, track.lang);
                  }}
                />
              );
            })}
          </SheetColumn>
          <SheetColumn title={t('player.subtitles')}>
            <SheetOption
              label={t('player.subtitlesOff')}
              selected={subtitles.choice === null}
              {...(state.audio.length === 0 ? { preferred: true } : {})}
              onPress={() => chooseSubtitle(null)}
            />
            {subtitles.tracks.map((track) => (
              <SheetOption
                key={`track-${track.id}`}
                label={languageName(track.lang) || track.label || t('common.unknown')}
                detail={t('player.inTheStream')}
                selected={subtitles.choice?.kind === 'track' && subtitles.choice.id === track.id}
                onPress={() => chooseSubtitle({ kind: 'track', id: track.id })}
              />
            ))}
            {subtitles.options.map((option) => {
              const status = subtitles.statusOf({ kind: 'file', key: option.key });
              return (
                <SheetOption
                  key={`file-${option.key}`}
                  label={languageName(option.lang) || option.lang}
                  detail={[
                    option.source,
                    status === 'loading' ? t('common.loading') : '',
                    status === 'failed' ? t('player.versionFailed') : '',
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
              <SheetNote>{t('player.stillAsking', { count: subtitles.pending })}</SheetNote>
            ) : null}
          </SheetColumn>
          <SheetColumn title={t('player.style')}>
            {SUBTITLE_SIZES.map((size) => (
              <SheetOption
                key={`size-${size}`}
                label={t(`player.styleValue.size.${size}`)}
                detail={t('player.styleField.size')}
                selected={prefs.subtitleStyle.size === size}
                onPress={() => setSubtitleStyle('size', size)}
              />
            ))}
            {SUBTITLE_COLOURS.map((colour) => (
              <SheetOption
                key={`colour-${colour}`}
                label={t(`player.styleValue.colour.${colour}`)}
                detail={t('player.styleField.colour')}
                selected={prefs.subtitleStyle.colour === colour}
                onPress={() => setSubtitleStyle('colour', colour)}
              />
            ))}
            <SheetNote>{t('player.styleKept')}</SheetNote>
          </SheetColumn>
        </Sheet>
      ) : null}

      {panel === 'more' ? (
        <Sheet>
          <SheetColumn title={t('player.quality')}>
            {choices.length <= 1 ? (
              <SheetNote>
                {choices.length === 1
                  ? t('player.onlyQuality', {
                      quality: resolutionLabel(choices[0]?.resolution) ?? t('player.otherQuality'),
                    })
                  : t('player.noOtherQuality')}
              </SheetNote>
            ) : null}
            {choices.map((choice) => {
              const value = choice.resolution ?? 'other';
              return (
                <SheetOption
                  key={value}
                  label={resolutionLabel(choice.resolution) ?? t('player.otherQuality')}
                  selected={value === currentQuality}
                  {...(value === currentQuality ? { preferred: true } : {})}
                  onPress={() => pickQuality(value)}
                />
              );
            })}
          </SheetColumn>
          <SheetColumn title={t('player.sources')}>
            {streams.map((entry) => {
              const text = streamRowText(t, entry, {
                heavy: isHeavy(entry, finder.runtimeSeconds()),
              });
              return (
                <SheetOption
                  key={entryKey(entry)}
                  label={text.title}
                  detail={[names.get(entry.addonId), ...text.badges].filter(Boolean).join(' · ')}
                  selected={!!state.entry && entryKey(entry) === entryKey(state.entry)}
                  onPress={() => pickStream(entry)}
                />
              );
            })}
          </SheetColumn>
        </Sheet>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.playerBg },
  dim: { backgroundColor: 'rgba(5,3,10,0.72)' },
  centre: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  waitTitle: { ...type.heading, color: color.text, marginTop: spacing.lg },
  waitLine: { ...type.body, color: color.textSoft },
  scrim: { position: 'absolute', left: 0, right: 0, bottom: 0, height: sizes.scrim * 1.4 },
  topScrim: { position: 'absolute', left: 0, right: 0, top: 0, height: px(220) },
  top: {
    position: 'absolute',
    top: px(60),
    left: layout.heroLeft,
    right: layout.heroLeft,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.xl,
  },
  titles: { flex: 1, gap: px(4) },
  title: { ...type.heading, color: color.text },
  subtitle: { ...type.meta, color: color.textSoft },
  ends: { ...type.meta, color: color.textSoft },
  live: {
    ...type.meta,
    color: color.text,
    backgroundColor: '#C62828',
    paddingHorizontal: spacing.sm,
  },
  bottom: {
    position: 'absolute',
    left: layout.heroLeft,
    right: layout.heroLeft,
    bottom: px(56),
    gap: spacing.lg,
  },
  buttons: { flexDirection: 'row', justifyContent: 'center', gap: spacing.xl },
  dialog: {
    width: px(1000),
    padding: spacing.xxl,
    borderRadius: px(32),
    backgroundColor: color.sheet,
    gap: spacing.md,
  },
  dialogTitle: { ...type.heading, color: color.text },
  dialogText: { ...type.body, color: color.textMuted },
  dialogButtons: { flexDirection: 'row', gap: spacing.lg, marginTop: spacing.md },
  upNext: {
    position: 'absolute',
    right: layout.heroLeft,
    bottom: px(80),
    width: px(720),
    padding: spacing.xl,
    borderRadius: px(24),
    backgroundColor: color.sheet,
    gap: spacing.sm,
  },
  upNextTitle: { ...type.meta, color: color.accent },
  upNextLine: { ...type.rowTitle, color: color.text },
  toast: {
    position: 'absolute',
    top: px(60),
    alignSelf: 'center',
    backgroundColor: color.sheet,
    borderRadius: px(16),
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
  },
  toastText: { ...type.label, color: color.text },
});
