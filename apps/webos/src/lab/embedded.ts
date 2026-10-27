import { isWebOS, lunaCall, lunaSubscribe } from '../platform/webos';

/**
 * The Phase 2 spike on embedded tracks: webOS 22 lists none of an MKV's
 * subtitles in `textTracks` (ADR 0001), but its media pipeline has its own
 * Luna API, keyed by the video element's `mediaId`. Lampa, Stremio and Nuvio
 * call it; LG does not document it, and on webOS 25 selecting a text track
 * has frozen HLS playback. This runs the calls those apps make against the
 * video the lab is playing and notes what the TV answers, including whether
 * the clock keeps moving after each call.
 */

const MEDIA = 'luna://com.webos.media';
const MEDIA_ID_WAIT_MS = 10000;
const SOURCE_INFO_WAIT_MS = 8000;
/** How long the clock is watched after each call; a frozen picture shows up as no movement. */
const WATCH_MS = 5000;

type Note = (line: string) => void;

interface ProgramInfo {
  numSubtitleTracks?: number;
  subtitleType?: string;
  subtitleTrackInfo?: Array<{ language?: string; type?: string }>;
  numAudioTracks?: number;
  audioTrackInfo?: Array<{ language?: string; codec?: string; channels?: number }>;
}

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

function mediaIdOf(video: HTMLVideoElement): string | null {
  const raw = (video as HTMLVideoElement & { mediaId?: unknown }).mediaId;
  const id = typeof raw === 'string' ? raw.trim() : '';
  return id && id !== '<invalid mediaId>' ? id : null;
}

/** Runs the spike on the playing video. The returned function stops it and its subscription. */
export function runEmbeddedTracksTest(video: HTMLVideoElement, note: Note): () => void {
  let stopped = false;
  let unsubscribe = () => undefined as void;

  const call = async (method: string, params: Record<string, unknown>) => {
    try {
      await lunaCall(`${MEDIA}/${method}`, params, 3000);
      note(
        `${method} ${JSON.stringify(params.type ?? params.enable ?? '')} ${params.index ?? ''}: ok`,
      );
      return true;
    } catch (error) {
      note(`${method}: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  };

  const watch = async (label: string) => {
    const from = video.currentTime;
    await wait(WATCH_MS);
    const moved = video.currentTime - from;
    const error = video.error ? ` error ${video.error.code}` : '';
    note(`${label}: clock moved ${moved.toFixed(1)} s${video.paused ? ' (paused)' : ''}${error}`);
  };

  const run = async () => {
    if (!isWebOS()) {
      note('Embedded tracks test: only runs on the TV');
      return;
    }
    const started = Date.now();
    let mediaId = mediaIdOf(video);
    while (!mediaId && !stopped && Date.now() - started < MEDIA_ID_WAIT_MS) {
      await wait(300);
      mediaId = mediaIdOf(video);
    }
    if (stopped) return;
    if (!mediaId) {
      note('No mediaId: play the MKV first');
      return;
    }
    note(`mediaId after ${Date.now() - started} ms`);

    let program: ProgramInfo | null = null;
    unsubscribe = lunaSubscribe(`${MEDIA}/subscribe`, { mediaId }, (message) => {
      const info = message.sourceInfo as { programInfo?: ProgramInfo[] } | undefined;
      if (info && !program) {
        program = info.programInfo?.[0] ?? {};
        const subtitles = (program.subtitleTrackInfo ?? []).map((t) => t.language || '?');
        const audio = (program.audioTrackInfo ?? []).map(
          (t) => `${t.language || '?'} ${t.codec ?? ''}`,
        );
        note(
          `sourceInfo: ${program.numSubtitleTracks ?? 0} subtitles (${program.subtitleType ?? '?'}: ${subtitles.join(', ')}), ${program.numAudioTracks ?? 0} audio (${audio.join(', ')})`,
        );
      }
      if (message.trackSelected) note(`trackSelected ${JSON.stringify(message.trackSelected)}`);
      if (message.error) note(`pipeline error ${JSON.stringify(message.error)}`);
      if (message.returnValue === false) note(`subscribe refused: ${String(message.errorText)}`);
    });
    const waitedFrom = Date.now();
    while (!program && !stopped && Date.now() - waitedFrom < SOURCE_INFO_WAIT_MS) await wait(250);
    if (stopped) return;
    if (!program) note('No sourceInfo within 8 s; trying the calls anyway');
    await watch('after subscribe');

    const count = Math.min((program as ProgramInfo | null)?.numSubtitleTracks ?? 2, 2);
    if (!(await call('setSubtitleEnable', { mediaId, enable: true }))) return;
    await wait(500);
    for (let index = 0; index < count && !stopped; index++) {
      await call('selectTrack', { mediaId, type: 'text', index });
      await watch(`after text ${index}`);
    }
    if (stopped) return;
    await call('setSubtitleEnable', { mediaId, enable: false });
    await watch('after subtitles off');
    if (stopped) return;
    await call('selectTrack', { mediaId, type: 'audio', index: 1 });
    await watch('after audio 1');
    unsubscribe();
    await call('unsubscribe', { mediaId });
    note('Embedded tracks test done');
  };

  void run().catch((error: unknown) => note(`Embedded tracks test failed: ${String(error)}`));
  return () => {
    stopped = true;
    unsubscribe();
  };
}
