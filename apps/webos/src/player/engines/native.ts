import { knownCapabilities } from '../../platform/capabilities';
import { isWebOS } from '../../platform/webos';
import {
  buildMediaOptionType,
  guessMimeType,
  listTracks,
  type MediaTrackListLike,
  selectAudioTrack,
} from '../media';
import { type Engine, type EngineFactory, type EngineTrack, PlaybackError } from './types';

type TrackedVideo = HTMLVideoElement & { audioTracks?: MediaTrackListLike };

/** A mediaOption start this far short of the target did not take, and is corrected by seeking. */
const START_SLACK_S = 10;
/** How long after `playing` the webOS clock may still read 0 before it shows the real position. */
const LATE_CLOCK_MS = 1500;
const UHD = { width: 3840, height: 2160 };

function describe(code: number): PlaybackError {
  switch (code) {
    case 2:
      return new PlaybackError('network', 'The stream stopped loading');
    case 3:
      return new PlaybackError('decode', 'The TV could not decode the stream');
    case 4:
      return new PlaybackError('format', 'The TV cannot play this format');
    default:
      return new PlaybackError('other', `Media error ${code}`);
  }
}

/** Empties the element so the hardware decoder is released (docs/PLAN.md, resource hygiene). */
export function resetVideo(video: HTMLVideoElement): void {
  video.pause();
  video.removeAttribute('src');
  while (video.firstChild) video.removeChild(video.firstChild);
  video.load();
}

/**
 * The TV's own player behind a plain `<video>`: the only path with full
 * hardware decoding, HDR and Dolby audio. A resume position goes in the
 * source's mediaOption on webOS, so the TV starts there instead of seeking
 * after load; if the TV ignores it, the engine seeks once playback starts.
 */
export const createNativeEngine: EngineFactory = (video, listener) => {
  const tracked = video as TrackedVideo;
  let cleanup: Array<() => void> = [];

  const on = <K extends keyof HTMLMediaElementEventMap>(
    type: K,
    handler: (event: HTMLMediaElementEventMap[K]) => void,
  ) => {
    video.addEventListener(type, handler);
    cleanup.push(() => video.removeEventListener(type, handler));
  };

  function detach() {
    cleanup.forEach((undo) => undo());
    cleanup = [];
  }

  const engine: Engine = {
    name: 'native',

    load(url, startAt) {
      detach();
      resetVideo(video);
      const mime = guessMimeType(url);
      const resume = startAt > 0 && isWebOS();
      // webOS holds adaptive streams to 1080p unless told the screen is bigger.
      const lift =
        isWebOS() &&
        knownCapabilities().uhd === true &&
        (mime === 'application/vnd.apple.mpegurl' || mime === 'application/dash+xml');
      const useMediaOption = resume || lift;
      if (useMediaOption) {
        const source = document.createElement('source');
        source.src = url;
        // Matroska reads "no" from canPlayType yet plays (ADR 0001); the type only carries the option.
        source.type = buildMediaOptionType(video.canPlayType(mime) ? mime : 'video/mp4', {
          startMs: resume ? startAt * 1000 : undefined,
          maxSize: lift ? UHD : undefined,
        });
        video.appendChild(source);
      } else {
        video.src = url;
      }

      on('error', () => {
        if (video.error) listener.fatal(describe(video.error.code));
      });
      if (startAt > 0 && !resume) {
        on('loadedmetadata', () => {
          if (video.currentTime < startAt - START_SLACK_S) video.currentTime = startAt;
        });
      }
      if (resume) {
        // webOS reads 0 at the first `playing` event and the real position a moment later.
        let checkAt: number | null = null;
        let checked = false;
        const check = () => {
          if (checked) return;
          checked = true;
          if (video.currentTime < startAt - START_SLACK_S) video.currentTime = startAt;
        };
        on('playing', () => {
          if (checkAt === null) checkAt = window.setTimeout(check, LATE_CLOCK_MS);
        });
        on('timeupdate', () => {
          if (checkAt !== null && video.currentTime > 0.5) {
            clearTimeout(checkAt);
            check();
          }
        });
        cleanup.push(() => {
          if (checkAt !== null) clearTimeout(checkAt);
        });
      }
      const lists = tracked.audioTracks;
      if (lists?.addEventListener) {
        const changed = () => listener.tracks();
        lists.addEventListener('addtrack', changed);
        lists.addEventListener('change', changed);
        cleanup.push(() => {
          lists.removeEventListener?.('addtrack', changed);
          lists.removeEventListener?.('change', changed);
        });
      }
      on('loadedmetadata', () => listener.tracks());

      video.load();
      // Failures arrive as the element's error event. A refused play() (autoplay
      // rules off the TV) leaves the video paused, and the player shows Play.
      video.play().catch(() => undefined);
      return Promise.resolve();
    },

    audioTracks(): EngineTrack[] {
      return listTracks(tracked.audioTracks, (track) => track.enabled === true).map((track) => ({
        id: String(track.index),
        lang: track.language,
        label: track.label,
        active: track.active,
      }));
    },

    selectAudio(id) {
      const list = tracked.audioTracks;
      if (list) selectAudioTrack(list, Number(id));
      listener.tracks();
    },

    // webOS lists no embedded subtitles through textTracks (ADR 0001), so none are offered.
    textTracks: () => [],
    selectText: () => undefined,

    destroy() {
      detach();
      resetVideo(video);
    },
  };
  return engine;
};
