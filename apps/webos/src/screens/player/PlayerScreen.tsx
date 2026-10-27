import {
  findBingeStream,
  languageKey,
  nextVideo,
  parseRuntime,
  qualityChoices,
  type StreamEntry,
} from '@bannertv/core';
import type { MetaPreview } from '@bannertv/protocol';
import { setFocus, useFocusable } from '@noriginmedia/norigin-spatial-navigation';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { back, replace } from '../../app/router';
import { useScreenFocus } from '../../app/use-screen-focus';
import { Artwork } from '../../components/Artwork';
import { Menu } from '../../components/Menu';
import { addonClient, addonCollection } from '../../data/addons';
import { progress } from '../../data/playback';
import { preferences, setPreference } from '../../data/preferences';
import { useQuery } from '../../data/use-query';
import { KeyCode } from '../../navigation/keys';
import { useBack } from '../../navigation/use-back';
import { resolutionLabel, streamBadges } from '../../player/describe';
import type { EngineTrack } from '../../player/engines/types';
import { entryKey, holdProbing, streamFinder } from '../../player/finder';
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
import { useSubtitles } from './use-subtitles';
import styles from './PlayerScreen.module.css';

/** Controls hide after this long without a key press, while playing. */
const CONTROLS_HIDE_MS = 5000;
/** A scrub lands this long after the last Left or Right. */
const SCRUB_COMMIT_MS = 800;
/** Presses closer together than this count as one held scrub, which speeds up. */
const SCRUB_REPEAT_MS = 600;
/** Fast forward and rewind keys, in seconds. */
const FORWARD_S = 30;
const REWIND_S = 10;
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
}

const noop = () => () => undefined;
const initial = () => INITIAL_SESSION_STATE;

function scrubStep(presses: number): number {
  if (presses > 12) return 60;
  if (presses > 4) return 30;
  return 10;
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
 * Remote: OK pauses and shows the controls; Left and Right scrub; Up and Down
 * show the controls; Back hides them, then leaves. Play, Pause, Stop, Fast
 * forward and Rewind work at any time, and Blue opens audio and subtitles.
 */
export function PlayerScreen(props: PlayerScreenProps) {
  const { type, metaId, videoId, preview } = props;
  const { t } = useTranslation();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  const finder = useMemo(() => streamFinder(type, videoId), [type, videoId]);
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
  const [scrubTo, setScrubTo] = useState<number | null>(null);
  const scrub = useRef<{ target: number; presses: number; at: number; timer: number } | null>(null);
  const hideTimer = useRef<number | undefined>(undefined);
  const [upNextDismissed, setUpNextDismissed] = useState(false);

  const metaQuery = useMemo(
    () => (type === 'movie' ? null : addonClient.meta(type, metaId)),
    [type, metaId],
  );
  const meta = useQuery(metaQuery).data;
  const item = meta ?? preview;
  const episode = meta?.videos.find((v) => v.id === videoId);
  const next = useMemo(
    () => (meta ? nextVideo(meta, videoId, Date.now()) : undefined),
    [meta, videoId],
  );
  // Up Next: the last 30 seconds of an episode, or its end.
  const remaining = state.duration > 0 ? state.duration - state.position : Infinity;
  const showUpNext =
    !!next &&
    !upNextDismissed &&
    !panel &&
    (state.status === 'ended' || (remaining <= UP_NEXT_BEFORE_END_S && state.status === 'playing'));
  // While the Up Next card is open, the controls stay and focus stays on the card.
  const upNextOpen = useRef(showUpNext);
  useEffect(() => {
    upNextOpen.current = showUpNext;
  });

  const subtitles = useSubtitles(type, videoId, state.entry, session, state);

  // The running time tells a heavy file from a long one, for auto-play's ranking.
  const runtime = item?.runtime;
  useEffect(() => finder.setRuntime(parseRuntime(runtime)), [finder, runtime]);

  // Open: free the decoder from any link test, then pick and start a stream.
  useEffect(() => {
    const element = videoRef.current;
    if (!element) return;
    setVideo(element);
    const releaseProbing = holdProbing();
    const created = createPlaybackSession({
      video: element,
      type,
      metaId,
      videoId,
      finder,
      autoFailover: !props.chosen,
      remember: !props.lab,
    });
    setSession(created);
    if (!props.lab) finder.start();
    let cancelled = false;
    void progress
      .load()
      .catch(() => undefined)
      .then(async () => {
        if (cancelled) return;
        const start = props.startAt ?? (props.lab ? 0 : progress.resumeAt(videoId)) ?? 0;
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
    const wanted = preferences.get().audioLanguage;
    if (!wanted) return;
    const match = state.audio.find((track) => languageKey(track.lang) === languageKey(wanted));
    if (match && !match.active) session.selectAudio(match.id);
  }, [session, state.entry, state.audio]);

  // Controls.
  function armHide() {
    clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      if (session?.get().status === 'playing' && !upNextOpen.current) hide();
    }, CONTROLS_HIDE_MS);
  }
  function show(focusKey?: string) {
    setControls(true);
    if (focusKey) void setFocus(focusKey);
    armHide();
  }
  function hide() {
    clearTimeout(hideTimer.current);
    setControls(false);
    void setFocus('player-surface');
  }
  useEffect(() => () => clearTimeout(hideTimer.current), []);
  // Paused, buffering, failed or offering the next episode: the controls stay up.
  useEffect(() => {
    if (controls && !panel && !showUpNext && state.status === 'playing') armHide();
    else clearTimeout(hideTimer.current);
    // armHide only reads refs and the session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controls, panel, state.status, showUpNext]);

  function scrubBy(direction: -1 | 1) {
    if (!session || state.duration <= 0) return;
    const now = Date.now();
    const current = scrub.current;
    const presses = current && now - current.at < SCRUB_REPEAT_MS ? current.presses + 1 : 1;
    const from = current ? current.target : (session.trustedPosition() ?? state.position);
    const target = Math.max(0, Math.min(state.duration - 1, from + direction * scrubStep(presses)));
    if (current) clearTimeout(current.timer);
    const timer = window.setTimeout(() => {
      scrub.current = null;
      setScrubTo(null);
      session.seek(target);
    }, SCRUB_COMMIT_MS);
    scrub.current = { target, presses, at: now, timer };
    setScrubTo(target);
    if (!controls) show('player-seek');
    else armHide();
  }
  function cancelScrub(): boolean {
    if (!scrub.current) return false;
    clearTimeout(scrub.current.timer);
    scrub.current = null;
    setScrubTo(null);
    return true;
  }
  useEffect(() => () => void cancelScrub(), []);

  function seekBy(seconds: number) {
    if (!session) return;
    session.seek((session.trustedPosition() ?? state.position) + seconds);
    show();
  }

  function openPanel(which: Panel, from: string) {
    setPanelFrom(from);
    setPanel(which);
  }

  // The surface holds focus while the controls are hidden, and turns keys into player actions.
  const surface = useFocusable<object, HTMLDivElement>({
    focusKey: 'player-surface',
    onArrowPress: (direction) => {
      if (direction === 'left' || direction === 'right') scrubBy(direction === 'left' ? -1 : 1);
      else show('player-play');
      return false;
    },
    onEnterPress: () => {
      session?.togglePlay();
      show('player-play');
    },
  });
  useScreenFocus('player-surface');

  // Transport keys work everywhere in the player, panels included.
  const onKey = useRef<(event: KeyboardEvent) => void>(() => undefined);
  onKey.current = (event) => {
    if (controls && !panel) armHide();
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
        seekBy(FORWARD_S);
        break;
      case KeyCode.Rewind:
        seekBy(-REWIND_S);
        break;
      case KeyCode.Blue:
        if (!panel) openPanel('tracks', controls ? 'player-tracks-button' : 'player-surface');
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
    if (controls) {
      hide();
      return true;
    }
    return false;
  });

  // The Magic Remote pointer brings the controls up, like a mouse over a web player.
  const onPointer = () => {
    if (!controls) show();
    else armHide();
  };

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

  // When a film ends, or the viewer turned Up Next away, go back to the title's page.
  useEffect(() => {
    if (state.status === 'ended' && (!next || upNextDismissed)) back();
  }, [state.status, next, upNextDismissed]);

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
  const waiting = !nothing && (state.status === 'idle' || state.status === 'loading');
  const problem = nothing || state.status === 'failed';
  // One note at a time, the most useful first, so they never sit on top of each other.
  let toast: string | undefined;
  if (state.steppedDown) toast = t('player.steppingDown');
  else if (state.failedOver) toast = t('player.tryingAnother');
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
      onPress: () => openPanel('tracks', 'player-tracks-button'),
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
          startAt: session?.trustedPosition() ?? state.position,
        }),
    });
  }
  if (resumedAt > 0) {
    buttons.push({
      focusKey: 'player-restart',
      label: t('player.startOver'),
      onPress: () => session?.seek(0),
    });
  }
  if (next) {
    buttons.push({
      focusKey: 'player-next',
      label: t('player.nextEpisode'),
      onPress: playNextEpisode,
    });
  }

  const chooseAudio = (track: EngineTrack) => {
    session?.selectAudio(track.id);
    if (track.lang) setPreference('audioLanguage', track.lang);
  };

  return (
    <section className={styles.player} aria-label={title} onMouseMove={onPointer}>
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
      {state.status === 'buffering' && <div className={styles.spinner} role="status" />}
      {toast && <p className={styles.toast}>{toast}</p>}

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
          returnFocusKey={panelFrom}
          onAudio={chooseAudio}
          onStyle={() => setPanel('style')}
          onClose={() => setPanel(null)}
        />
      )}
      {panel === 'style' && (
        <SubtitleStylePanel returnFocusKey={panelFrom} onClose={() => setPanel(null)} />
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
              session.play(choice.entry, session.trustedPosition() ?? state.position, {
                chosen: true,
              });
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
              startAt: session?.trustedPosition() ?? resumedAt,
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
              session?.play(state.entry, session.trustedPosition() ?? resumedAt);
            }
          }}
          onBack={back}
        />
      )}
    </section>
  );
}
