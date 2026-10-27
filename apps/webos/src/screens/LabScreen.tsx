import { pause, resume } from '@noriginmedia/norigin-spatial-navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useScreenFocus } from '../app/use-screen-focus';
import { Button } from '../components/Button';
import { Pressable } from '../components/Pressable';
import {
  buildMediaOptionType,
  describeMediaError,
  formatTime,
  guessMimeType,
  listTracks,
  type MediaTrackListLike,
  selectAudioTrack,
  selectTextTrack,
  type TrackInfo,
  trackName,
} from '../lab/media';
import { LAB_SOURCES, type LabSource } from '../lab/sources';
import { KeyCode } from '../navigation/keys';
import { useBack } from '../navigation/use-back';
import styles from './LabScreen.module.css';

/** Where the start-position test (spike 3) asks playback to begin. */
const START_SECONDS = 30;
const START_MODES = ['beginning', 'mediaOption', 'seek'] as const;
type StartMode = (typeof START_MODES)[number];

const MEDIA_EVENTS = [
  'loadstart',
  'loadedmetadata',
  'loadeddata',
  'canplay',
  'playing',
  'waiting',
  'stalled',
  'seeked',
  'ended',
  'error',
] as const;

type TrackedVideo = HTMLVideoElement & {
  audioTracks?: MediaTrackListLike;
  videoTracks?: MediaTrackListLike;
};

interface Snapshot {
  state: string;
  time: string;
  size: string;
  /** Null when the engine reports no frames at all, which means it doesn't count them. */
  frames: { dropped: number; total: number } | null;
  audio: TrackInfo[] | null;
  text: TrackInfo[];
  error: string;
}

const EMPTY: Snapshot = {
  state: 'idle',
  time: '',
  size: '',
  frames: null,
  audio: null,
  text: [],
  error: '',
};

function snapshot(video: TrackedVideo): Snapshot {
  const quality = video.getVideoPlaybackQuality?.();
  return {
    state: video.error
      ? 'error'
      : video.paused
        ? video.readyState > 0
          ? 'paused'
          : 'idle'
        : 'playing',
    time: `${formatTime(video.currentTime)} / ${formatTime(video.duration)}`,
    size: video.videoWidth ? `${video.videoWidth} x ${video.videoHeight}` : '',
    frames:
      quality && quality.totalVideoFrames > 0
        ? { dropped: quality.droppedVideoFrames, total: quality.totalVideoFrames }
        : null,
    audio: video.audioTracks
      ? listTracks(video.audioTracks, (track) => track.enabled === true)
      : null,
    text: listTracks(video.textTracks, (track) => track.mode === 'showing'),
    error: video.error
      ? `${describeMediaError(video.error.code)} ${video.error.message ?? ''}`
      : '',
  };
}

/**
 * Phase 0 spikes 2 and 3 on the TV: which audio and subtitle tracks webOS
 * exposes for direct-play files, and whether a mediaOption start position
 * works. Everything it sees is written on screen and to the console.
 */
export function LabScreen() {
  const { t } = useTranslation();
  const videoRef = useRef<TrackedVideo>(null);
  // Where the current load should seek once its metadata arrives. Every load
  // sets it, so a load that failed before seeking can't leak into the next.
  const seekOnLoad = useRef<number | null>(null);
  const [current, setCurrent] = useState<LabSource | null>(null);
  const [startMode, setStartMode] = useState<StartMode>('beginning');
  const [startedAt, setStartedAt] = useState('');
  const [info, setInfo] = useState<Snapshot>(EMPTY);
  const [log, setLog] = useState<string[]>([]);
  const [fullscreen, setFullscreen] = useState(false);

  useScreenFocus('lab-start-mode');

  const note = useCallback((line: string) => {
    const video = videoRef.current;
    const at = video ? formatTime(video.currentTime) : '';
    console.info(`[BannerTV lab] ${at} ${line}`);
    setLog((lines) => [`${at} ${line}`, ...lines].slice(0, 7));
  }, []);

  // Media events, track list changes and a twice-a-second refresh of the panel.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let firstPlaying = true;
    const refresh = () => setInfo(snapshot(video));
    const onEvent = (event: Event) => {
      if (event.type === 'loadstart') firstPlaying = true;
      if (event.type === 'loadedmetadata' && seekOnLoad.current !== null) {
        video.currentTime = seekOnLoad.current;
        seekOnLoad.current = null;
      }
      if (event.type === 'playing' && firstPlaying) {
        firstPlaying = false;
        setStartedAt(`${video.currentTime.toFixed(1)} s`);
      }
      note(event.type === 'error' ? `error: ${snapshot(video).error}` : event.type);
      refresh();
    };
    const onTracks = (event: Event) => {
      note(`tracks: ${event.type}`);
      refresh();
    };
    MEDIA_EVENTS.forEach((type) => video.addEventListener(type, onEvent));
    const trackLists = [video.audioTracks, video.textTracks];
    trackLists.forEach((list) => {
      list?.addEventListener?.('addtrack', onTracks);
      list?.addEventListener?.('change', onTracks);
    });
    const timer = window.setInterval(refresh, 500);
    return () => {
      window.clearInterval(timer);
      MEDIA_EVENTS.forEach((type) => video.removeEventListener(type, onEvent));
      trackLists.forEach((list) => {
        list?.removeEventListener?.('addtrack', onTracks);
        list?.removeEventListener?.('change', onTracks);
      });
      // Release the hardware decoder when leaving the lab.
      video.pause();
      video.removeAttribute('src');
      while (video.firstChild) video.removeChild(video.firstChild);
      video.load();
    };
  }, [note]);

  // Remote transport keys, and seeking while full screen.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const video = videoRef.current;
      if (!video) return;
      if (event.keyCode === KeyCode.Play) void video.play();
      else if (event.keyCode === KeyCode.Pause) video.pause();
      else if (event.keyCode === KeyCode.Stop) video.pause();
      else if (fullscreen && event.keyCode === KeyCode.Left) video.currentTime -= 10;
      else if (fullscreen && event.keyCode === KeyCode.Right) video.currentTime += 10;
      else if (fullscreen && event.keyCode === KeyCode.Ok) {
        if (video.paused) void video.play();
        else video.pause();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fullscreen]);

  const play = (source: LabSource) => {
    const video = videoRef.current;
    if (!video) return;
    setCurrent(source);
    setStartedAt('');
    setLog([]);
    seekOnLoad.current = startMode === 'seek' ? START_SECONDS : null;
    video.pause();
    video.removeAttribute('src');
    while (video.firstChild) video.removeChild(video.firstChild);

    if (startMode === 'mediaOption') {
      let mime = guessMimeType(source.url);
      if (!video.canPlayType(mime)) {
        note(`${mime} not recognised, using video/mp4 in the type`);
        mime = 'video/mp4';
      }
      const element = document.createElement('source');
      element.src = source.url;
      element.type = buildMediaOptionType(mime, START_SECONDS * 1000);
      video.appendChild(element);
    } else {
      video.src = source.url;
    }
    note(`load ${source.label} (${startMode})`);
    video.load();
    video.play().catch((error: unknown) => note(`play() rejected: ${String(error)}`));
  };

  const chooseAudio = (index: number) => {
    const list = videoRef.current?.audioTracks;
    if (!list) return;
    selectAudioTrack(list, index);
    note(`audio track ${index + 1} enabled`);
  };

  const chooseText = (index: number | null) => {
    const list = videoRef.current?.textTracks;
    if (!list) return;
    selectTextTrack(list, index);
    note(index === null ? 'subtitles off' : `subtitle track ${index + 1} showing`);
  };

  const enterFullscreen = () => {
    setFullscreen(true);
    pause();
  };

  useBack(
    'overlay',
    () => {
      setFullscreen(false);
      resume();
      return true;
    },
    fullscreen,
  );

  const startLabel = t(`lab.start.${startMode}`, { seconds: START_SECONDS });

  return (
    <div className={styles.screen}>
      <h1 className={styles.title}>{t('settings.lab')}</h1>

      <div className={styles.controls}>
        <Button
          block
          focusKey="lab-start-mode"
          label={startLabel}
          onPress={() =>
            setStartMode(START_MODES[(START_MODES.indexOf(startMode) + 1) % START_MODES.length]!)
          }
        />
        {LAB_SOURCES.map((source, index) => (
          <Pressable
            key={source.url}
            focusKey={`lab-source-${index}`}
            label={source.label}
            className={
              source === current ? `${styles.source} ${styles.sourceActive}` : styles.source
            }
            focusedClassName={styles.sourceFocused}
            onPress={() => play(source)}
          >
            <span className={styles.sourceLabel}>{source.label}</span>
            {source.note && <span className={styles.sourceNote}>{source.note}</span>}
          </Pressable>
        ))}
        <Button
          block
          focusKey="lab-fullscreen"
          label={t('lab.fullscreen')}
          onPress={enterFullscreen}
        />
      </div>

      <div className={styles.stage}>
        <video
          ref={videoRef}
          className={fullscreen ? `${styles.video} ${styles.fullscreen}` : styles.video}
        />

        <div className={styles.chips}>
          <span className={styles.chipsLabel}>{t('lab.audio')}</span>
          {info.audio === null ? (
            <span className={styles.muted}>{t('lab.noAudioTracksApi')}</span>
          ) : (
            info.audio.map((track) => (
              <Chip
                key={track.index}
                focusKey={`lab-audio-${track.index}`}
                active={track.active}
                onPress={() => chooseAudio(track.index)}
              >
                {trackName(track)}
              </Chip>
            ))
          )}
        </div>
        <div className={styles.chips}>
          <span className={styles.chipsLabel}>{t('lab.subtitles')}</span>
          <Chip
            focusKey="lab-text-off"
            active={!info.text.some((track) => track.active)}
            onPress={() => chooseText(null)}
          >
            {t('lab.off')}
          </Chip>
          {info.text.map((track) => (
            <Chip
              key={track.index}
              focusKey={`lab-text-${track.index}`}
              active={track.active}
              onPress={() => chooseText(track.index)}
            >
              {trackName(track)}
            </Chip>
          ))}
        </div>

        <div className={styles.panels}>
          <div className={styles.panel}>
            <div>{t('lab.state', { state: info.state, time: info.time })}</div>
            <div>
              {t('lab.video', {
                size: info.size || '—',
                frames: info.frames
                  ? t('lab.frames', info.frames)
                  : info.state === 'idle'
                    ? '—'
                    : t('lab.framesNotReported'),
              })}
            </div>
            <div>{t('lab.startedAt', { at: startedAt || '—' })}</div>
            <div>
              {t('lab.trackCounts', {
                audio: info.audio === null ? t('common.notAvailable') : info.audio.length,
                text: info.text.length,
              })}
            </div>
            {info.error && <div>{t('lab.error', { error: info.error })}</div>}
          </div>
          <div className={`${styles.panel} ${styles.muted}`}>
            {log.map((line, index) => (
              <div key={index}>{line}</div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function Chip({
  focusKey,
  active,
  onPress,
  children,
}: {
  focusKey: string;
  active: boolean;
  onPress: () => void;
  children: string;
}) {
  return (
    <Pressable
      focusKey={focusKey}
      label={children}
      className={active ? `${styles.chip} ${styles.chipActive}` : styles.chip}
      focusedClassName={styles.chipFocused}
      onPress={onPress}
    >
      {children}
    </Pressable>
  );
}
