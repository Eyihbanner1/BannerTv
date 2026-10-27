import { type Cue, parseCueMarkup } from '@bannertv/core';
import type Hls from 'hls.js';
import type { CuesParsedData, ErrorData, MediaPlaylist } from 'hls.js';
import { isWebOS } from '../../platform/webos';
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
/**
 * Failures that mean the TV cannot take the content, so rebuilding the
 * pipeline would only fail again. hls.js reports E-AC-3 in MPEG-TS as a frag
 * parsing error, and counts append errors other than a full buffer as codec
 * trouble itself.
 */
const FORMAT_ERRORS = [
  'manifestIncompatibleCodecsError',
  'bufferAddCodecError',
  'bufferIncompatibleCodecsError',
  'fragParsingError',
  'bufferAppendError',
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

/** Tracks are told apart by language and name: hls.js renumbers ids within each group. */
function trackId(track: MediaPlaylist): string {
  return `${track.lang ?? ''}|${track.name}`;
}

/**
 * hls.js over Media Source Extensions, for HLS streams with alternate audio
 * or subtitles that the TV's own player would hide (ADR 0001). Subtitles come
 * out as cues and BannerTV draws them, like addon subtitles.
 */
export const createHlsEngine: EngineFactory = (video, listener) => {
  let hls: Hls | null = null;

  function open(HlsClass: typeof Hls, url: string, startAt: number, worker: boolean) {
    const events = HlsClass.Events;
    // Buffer limits in seconds: hls.js never caps by bytes, and when the TV's
    // buffer fills it shortens them itself. Not capLevelToPlayerSize: the
    // webOS page is 1920 wide, which would cap 4K. Not MediaCapabilities on
    // the TV: it misreports there (Shaka turns it off too), and hls.js would
    // drop the 4K, HDR and 5.1 levels on its word.
    const instance = new HlsClass({
      startPosition: startAt > 0 ? startAt : -1,
      enableWorker: worker,
      useMediaCapabilities: !isWebOS(),
      renderTextTracksNatively: false,
      maxBufferLength: 15,
      maxMaxBufferLength: 30,
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
      // Not 'captions': CEA-608 captions inside the video are not offered yet.
      if (data.type !== 'subtitles') return;
      const track = data.subtitleTrack ?? instance.subtitleTracks[instance.subtitleTrack];
      if (!track) return;
      const cues = (data.cues as VTTCue[]).map(toCue).filter((cue): cue is Cue => !!cue);
      if (cues.length > 0) listener.cues(trackId(track), cues);
    });
    instance.on(events.ERROR, (_event: unknown, data: ErrorData) => {
      const detail = String(data.details);
      if (!data.fatal) {
        // A worker that fails after starting is not replaced by hls.js, so the
        // stream would stall: start again from here without one.
        if (detail === 'internalException' && data.event === 'demuxerWorker' && worker) {
          const at = video.currentTime > 0 ? video.currentTime : startAt;
          instance.destroy();
          if (hls === instance) open(HlsClass, url, at, false);
        }
        return;
      }
      if (FORMAT_ERRORS.indexOf(detail) !== -1) {
        listener.fatal(new PlaybackError('format', 'The TV cannot decode this stream', detail));
        return;
      }
      if (data.type === HlsClass.ErrorTypes.MEDIA_ERROR) {
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
      // A fatal network error means hls.js has used up its own retries. Before
      // the first picture the session hands the link to the TV's player
      // instead, which needs no CORS from the segment hosts.
      const kind = data.type === HlsClass.ErrorTypes.NETWORK_ERROR ? 'network' : 'other';
      listener.fatal(new PlaybackError(kind, 'The stream stopped loading', detail));
    });

    instance.attachMedia(video);
    instance.loadSource(url);
  }

  const engine: Engine = {
    name: 'hls.js',

    async load(url, startAt) {
      const Hls = await loadHls();
      engine.destroy();
      open(Hls, url, startAt, true);
    },

    audioTracks() {
      if (!hls) return [];
      const current = hls.audioTracks[hls.audioTrack];
      const active = current ? trackId(current) : '';
      const seen: Record<string, true> = {};
      const tracks: EngineTrack[] = [];
      for (const track of hls.allAudioTracks) {
        const id = trackId(track);
        if (seen[id]) continue;
        seen[id] = true;
        tracks.push({ id, lang: track.lang ?? '', label: track.name, active: id === active });
      }
      return tracks;
    },

    selectAudio(id) {
      if (!hls) return;
      const track = hls.allAudioTracks.find((t) => trackId(t) === id);
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
        id: trackId(track),
        lang: track.lang ?? '',
        label: track.name,
        active: track.id === active,
      }));
    },

    selectText(id) {
      if (!hls) return;
      const track = id === null ? undefined : hls.subtitleTracks.find((t) => trackId(t) === id);
      hls.subtitleTrack = track ? track.id : -1;
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
