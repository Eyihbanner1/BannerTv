import { type Cue, parseCueMarkup } from '@bannertv/core';
import type Hls from 'hls.js';
import type { CuesParsedData, ErrorData, MediaPlaylist } from 'hls.js';
import { resetVideo } from './native';
import { type Engine, type EngineFactory, type EngineTrack, PlaybackError } from './types';
import { loadVendorScript } from './vendor';

declare global {
  interface Window {
    Hls?: typeof Hls;
  }
}

/** hls.js's advice: rebuild the media pipeline after a decode failure, but not in a loop. */
const MEDIA_RECOVERIES = 2;
const MEDIA_RECOVERY_GAP_MS = 5000;
const CODEC_ERRORS = [
  'manifestIncompatibleCodecsError',
  'bufferAddCodecError',
  'bufferIncompatibleCodecsError',
];

function loadHls(): Promise<typeof Hls> {
  return loadVendorScript('hls').then(
    () => {
      const Hls = window.Hls;
      if (!Hls || !Hls.isSupported()) {
        throw new PlaybackError('format', 'This TV cannot run hls.js');
      }
      return Hls;
    },
    () => {
      throw new PlaybackError('other', 'The HLS player could not be loaded');
    },
  );
}

function toCue(cue: VTTCue): Cue | undefined {
  const lines = parseCueMarkup(cue.text);
  if (lines.length === 0 || !(cue.endTime > cue.startTime)) return undefined;
  // A cue placed in the top part of the picture stays there.
  const top =
    typeof cue.line === 'number' &&
    (cue.snapToLines ? cue.line >= 0 && cue.line < 4 : cue.line < 30);
  return { start: cue.startTime, end: cue.endTime, lines, top: top || undefined };
}

/** Audio tracks are told apart by language and name: hls.js renumbers ids per group. */
function audioId(track: MediaPlaylist): string {
  return `${track.lang ?? ''}|${track.name}`;
}

/**
 * hls.js over Media Source Extensions, for HLS streams with alternate audio
 * or subtitles that the TV's own player would hide (ADR 0001). Subtitles come
 * out as cues and BannerTV draws them, like addon subtitles.
 */
export const createHlsEngine: EngineFactory = (video, listener) => {
  let hls: Hls | null = null;

  const engine: Engine = {
    name: 'hls.js',

    async load(url, startAt) {
      const Hls = await loadHls();
      engine.destroy();
      const events = Hls.Events;
      // Buffers kept small for TVs with 1.5 GB shared by everything. Not
      // capLevelToPlayerSize: the webOS page is 1920 wide, which would cap 4K.
      const instance = new Hls({
        startPosition: startAt > 0 ? startAt : -1,
        enableWorker: true,
        renderTextTracksNatively: false,
        maxBufferLength: 15,
        maxMaxBufferLength: 30,
        maxBufferSize: 30e6,
        backBufferLength: 10,
      });
      hls = instance;
      let recoveries = 0;
      let recoveredAt = 0;

      instance.on(events.MANIFEST_PARSED, () => {
        video.play().catch(() => undefined);
      });
      const tracksChanged = () => listener.tracks();
      instance.on(events.AUDIO_TRACKS_UPDATED, tracksChanged);
      instance.on(events.AUDIO_TRACK_SWITCHED, tracksChanged);
      instance.on(events.SUBTITLE_TRACKS_UPDATED, tracksChanged);
      instance.on(events.SUBTITLE_TRACK_SWITCH, tracksChanged);
      instance.on(events.CUES_PARSED, (_event: unknown, data: CuesParsedData) => {
        if (data.type !== 'subtitles') return;
        const id = data.subtitleTrack ? data.subtitleTrack.id : instance.subtitleTrack;
        if (id < 0) return;
        const cues = (data.cues as VTTCue[]).map(toCue).filter((cue): cue is Cue => !!cue);
        if (cues.length > 0) listener.cues(String(id), cues);
      });
      instance.on(events.ERROR, (_event: unknown, data: ErrorData) => {
        if (!data.fatal) return;
        const detail = String(data.details);
        if (CODEC_ERRORS.indexOf(detail) !== -1) {
          listener.fatal(new PlaybackError('format', 'The TV cannot decode this stream', detail));
          return;
        }
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          const now = Date.now();
          if (recoveries < MEDIA_RECOVERIES && now - recoveredAt >= MEDIA_RECOVERY_GAP_MS) {
            recoveries++;
            recoveredAt = now;
            instance.recoverMediaError();
            return;
          }
          listener.fatal(new PlaybackError('decode', 'The TV could not decode the stream', detail));
          return;
        }
        // A fatal network error means hls.js has used up its own retries.
        const kind = data.type === Hls.ErrorTypes.NETWORK_ERROR ? 'network' : 'other';
        listener.fatal(new PlaybackError(kind, 'The stream stopped loading', detail));
      });

      instance.attachMedia(video);
      instance.loadSource(url);
    },

    audioTracks() {
      if (!hls) return [];
      const current = hls.audioTracks[hls.audioTrack];
      const active = current ? audioId(current) : '';
      const seen: Record<string, true> = {};
      const tracks: EngineTrack[] = [];
      for (const track of hls.allAudioTracks) {
        const id = audioId(track);
        if (seen[id]) continue;
        seen[id] = true;
        tracks.push({ id, lang: track.lang ?? '', label: track.name, active: id === active });
      }
      return tracks;
    },

    selectAudio(id) {
      if (!hls) return;
      const track = hls.allAudioTracks.find((t) => audioId(t) === id);
      // setAudioOption switches level too when the track lives in another group.
      if (track) {
        hls.setAudioOption({
          lang: track.lang,
          name: track.name,
          characteristics: track.characteristics,
        });
      }
    },

    textTracks() {
      if (!hls) return [];
      const active = hls.subtitleTrack;
      return hls.subtitleTracks.map((track) => ({
        id: String(track.id),
        lang: track.lang ?? '',
        label: track.name,
        active: track.id === active,
      }));
    },

    selectText(id) {
      if (hls) hls.subtitleTrack = id === null ? -1 : Number(id);
    },

    destroy() {
      if (hls) {
        hls.destroy();
        hls = null;
      }
      resetVideo(video);
    },
  };
  return engine;
};
