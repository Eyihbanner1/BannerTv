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
  rearms,
  secondsToEnd,
  type StreamEntry,
  UP_NEXT_AFTER_END_S,
} from '@bannertv/core';
import type { MetaDetail, MetaPreview, Video } from '@bannertv/protocol';
import { addonClient } from '@tv/data/addons';
import { playedVideos, progress } from '@tv/data/playback';
import { preferences } from '@tv/data/preferences';
import { chooseAudioLanguage, wantedAudio } from '@tv/data/tracks';
import { useQuery } from '@tv/data/use-query';
import { noteInput, sinceInput } from '@tv/navigation/activity';
import { audioDetail, audioSummary, pickAudio } from '@tv/player/audio';
import { entryKey, holdProbing, streamFinder } from '@tv/player/finder';
import {
  createPlaybackSession,
  INITIAL_SESSION_STATE,
  type PlaybackSession,
} from '@tv/player/session';
import { autoplaysSinceInput, countAutoplay } from '@tv/player/sleep';
import { type SubtitleChoice, useSubtitles } from '@tv/screens/player/use-subtitles';
import { useScrobble } from '@tv/screens/player/use-scrobble';
import { StatusBar } from 'expo-status-bar';
import { VideoView } from 'expo-video';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  AppState,
  BackHandler,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { goBack, openPlayer, type PlayerRoute } from '../nav/routes';
import { reportScreen } from '../runtime/whereabouts';
import { Artwork } from '../ui/Artwork';
import { Button } from '../ui/Button';
import { Icon } from '../ui/icons';
import { Sheet, SheetOption } from '../ui/Sheet';
import { StreamList } from '../ui/StreamList';
import { colors, radius, space, type } from '../ui/theme';
import { phoneArt } from '../ui/Tile';
import { holdLandscape } from './orientation';
import { phonePlayer, pictureShown } from './phone-host';
import { SeekBar } from './SeekBar';
import { SubtitleText } from './SubtitleText';
import { asVideoElement, PhoneVideoElement } from './video-element';

const CONTROLS_HIDE_MS = 4000;
const DOUBLE_TAP_MS = 280;
const SKIP_S = 10;
/** The next episode's streams are looked up this long before the end. */
const PREFETCH_NEXT_S = 120;
const noop = () => () => undefined;

type Panel = 'tracks' | 'streams' | null;

function episodeLabel(video: Video | undefined): string | undefined {
  if (!video || video.season === undefined || video.episode === undefined) return undefined;
  return `S${video.season}:E${video.episode}${video.title ? ` · ${video.title}` : ''}`;
}

export function PlayerScreen({ route }: { route: PlayerRoute }) {
  const { type: titleType, metaId, videoId } = route;
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const element = useMemo(() => new PhoneVideoElement(), []);
  const finder = useMemo(() => streamFinder(titleType, videoId), [titleType, videoId]);
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
  const prefs = useSyncExternalStore(preferences.subscribe, preferences.get);

  // The title's full record, for the episode list and the Continue Watching card.
  const metaQuery = useMemo(
    () => (titleType === 'movie' ? null : addonClient.meta(titleType, metaId)),
    [titleType, metaId],
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
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const poke = useCallback(() => {
    noteInput();
    setControls(true);
  }, []);
  useEffect(() => {
    clearTimeout(hideTimer.current);
    if (controls && state.status === 'playing' && panel === null && !scrubbing) {
      hideTimer.current = setTimeout(() => setControls(false), CONTROLS_HIDE_MS);
    }
    return () => clearTimeout(hideTimer.current);
  }, [controls, state.status, panel, scrubbing, state.position]);
  if (problem && panel !== null) setPanel(null);

  // The app going to the background pauses and saves, as hiding the TV app does.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'background' && session) {
        session.pause();
        session.saveProgress();
      } else if (next === 'active') {
        setControls(true);
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

  const clock = useCallback(() => element.currentTime, [element]);
  const title = item?.name ?? '';
  const subtitle = episodeLabel(current);
  const toast = (() => {
    if (state.steppedDown && waiting) return t('player.steppingDown');
    if (state.failedOver && waiting) return t('player.tryingAnother');
    if (state.struggling && buffering) return t('player.keepsBufferingStreams');
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
          player={phonePlayer()}
          style={styles.video}
          contentFit="contain"
          nativeControls={false}
          allowsPictureInPicture={false}
        />
      ) : null}

      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={(event) => onSurfaceTap(event.nativeEvent.locationX, surfaceWidth.current)}
        accessibilityLabel={controls ? undefined : t('phone.playLabel')}
      />

      <SubtitleText
        cues={subtitles.cues}
        offset={subtitles.offset}
        clock={clock}
        raised={controls}
      />

      {waiting || problem ? (
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

      {waiting ? (
        <View style={styles.centre} pointerEvents="none">
          <ActivityIndicator color={colors.prismTop} size="large" />
          <Text style={styles.waitTitle}>{title}</Text>
          {subtitle ? <Text style={styles.waitLine}>{subtitle}</Text> : null}
          <Text style={styles.waitLine}>{toast ?? t('phone.findingStream')}</Text>
        </View>
      ) : null}

      {buffering ? (
        <View style={styles.centre} pointerEvents="none">
          <ActivityIndicator color={colors.prismTop} size="large" />
        </View>
      ) : null}

      {problem ? (
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

      {controls && !problem ? (
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
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel={t('phone.leavePlayer')}
            >
              <Icon name="back" size={28} />
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
          </View>

          {!waiting ? (
            <View style={styles.middle} pointerEvents="box-none">
              <Pressable
                onPress={() => {
                  poke();
                  skip(-SKIP_S);
                }}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel={t('phone.back10')}
              >
                <Icon name="replay10" size={40} />
              </Pressable>
              <Pressable
                onPress={() => {
                  poke();
                  session?.togglePlay();
                }}
                style={styles.playButton}
                accessibilityRole="button"
                accessibilityLabel={t(playing ? 'phone.pauseLabel' : 'phone.playLabel')}
              >
                <Icon name={playing ? 'pause' : 'play'} size={44} />
              </Pressable>
              <Pressable
                onPress={() => {
                  poke();
                  skip(SKIP_S);
                }}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel={t('phone.forward10')}
              >
                <Icon name="forward10" size={40} />
              </Pressable>
            </View>
          ) : (
            <View style={styles.middle} pointerEvents="none" />
          )}

          <View style={[styles.bottom, { paddingBottom: Math.max(insets.bottom, space.m) }]}>
            {!state.live ? (
              <SeekBar
                position={state.position}
                duration={state.duration}
                onSeek={(seconds) => {
                  poke();
                  session?.seek(seconds);
                }}
                onScrubbing={setScrubbing}
              />
            ) : null}
            <View style={styles.buttons}>
              <Button
                kind="quiet"
                icon="subtitles"
                label={t('phone.audioAndSubtitles')}
                onPress={() => setPanel('tracks')}
                disabled={waiting}
              />
              <Button
                kind="quiet"
                icon="layers"
                label={t('phone.sources')}
                onPress={() => setPanel('streams')}
              />
              {offersNext && next ? (
                <Button
                  kind="quiet"
                  icon="next"
                  label={counting ? t('phone.nextIn', { seconds: count }) : t('phone.nextEpisode')}
                  onPress={() => playEpisode(next)}
                />
              ) : null}
            </View>
          </View>
        </View>
      ) : null}

      {!controls &&
      !problem &&
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

      {ended && decision === 'ask' && next ? (
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

      {toast && !waiting ? (
        <View style={styles.toast} pointerEvents="none">
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      ) : null}

      <Sheet
        visible={panel === 'tracks'}
        title={t('phone.audioAndSubtitles')}
        onClose={() => setPanel(null)}
      >
        {state.audio.length > 0 ? (
          <Text style={styles.sheetHeading}>{t('phone.audio')}</Text>
        ) : null}
        {state.audio.map((track) => {
          const detail = audioDetail(track);
          return (
            <SheetOption
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
        <Text style={styles.sheetHeading}>{t('phone.subtitles')}</Text>
        <SheetOption
          label={t('phone.subtitlesOff')}
          selected={subtitles.choice === null}
          onPress={() => chooseSubtitle(null)}
        />
        {subtitles.tracks.map((track) => (
          <SheetOption
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
            <SheetOption
              key={`file-${option.key}`}
              label={languageName(option.lang) || option.lang}
              detail={[
                t('phone.fromAddon', { addon: option.source }),
                status === 'loading' ? t('common.loading') : '',
                status === 'failed' ? t('player.subtitlesFailed') : '',
              ]
                .filter(Boolean)
                .join(' · ')}
              selected={subtitles.choice?.kind === 'file' && subtitles.choice.key === option.key}
              onPress={() => chooseSubtitle({ kind: 'file', key: option.key })}
            />
          );
        })}
        {subtitles.pending > 0 ? <Text style={styles.sheetNote}>{t('common.loading')}</Text> : null}
      </Sheet>

      <Sheet
        visible={panel === 'streams'}
        title={t('phone.sources')}
        onClose={() => setPanel(null)}
        scroll={false}
      >
        <View style={styles.streams}>
          <StreamList
            finder={finder}
            {...(state.entry ? { playingKey: entryKey(state.entry) } : {})}
            onPick={pickStream}
          />
        </View>
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  // Sized as well as placed: the web build draws a <video>, which keeps its own size otherwise.
  video: { position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' },
  screen: { flex: 1, backgroundColor: '#000' },
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
  controls: { backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'space-between' },
  top: { flexDirection: 'row', alignItems: 'center', gap: space.l, paddingTop: space.l },
  titles: { flex: 1 },
  title: { ...type.heading, color: colors.text },
  subtitle: { ...type.small, color: colors.textMuted },
  live: {
    ...type.label,
    color: colors.text,
    backgroundColor: '#D7263D',
    paddingHorizontal: space.s,
    borderRadius: radius.s,
    overflow: 'hidden',
  },
  middle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 56 },
  playButton: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(106,59,240,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bottom: { gap: space.xs },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: space.s },
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
  sheetHeading: {
    ...type.label,
    color: colors.accent,
    paddingHorizontal: space.l,
    paddingTop: space.m,
    paddingBottom: space.xs,
  },
  sheetNote: { ...type.small, color: colors.textMuted, padding: space.l },
  streams: { height: 420 },
});
