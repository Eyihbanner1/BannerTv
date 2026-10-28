import { isWebOS, LunaError, lunaCall, lunaSubscribe } from '../platform/webos';

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
/** How long a subscription made mid-play waits before the video is opened again. */
const EARLY_SOURCE_INFO_WAIT_MS = 3000;
const SOURCE_INFO_WAIT_MS = 8000;
/** The first messages of each subscription are noted by their keys, to show what the pipeline sends. */
const NOTED_MESSAGES = 4;
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
  const subscriptions: Array<() => void> = [];
  const unsubscribe = () => {
    subscriptions.forEach((undo) => undo());
    subscriptions.length = 0;
  };
  // A stopped run says nothing more: its lines would land in the next run's log.
  const say: Note = (line) => {
    if (!stopped) note(line);
  };

  const call = async (method: string, params: Record<string, unknown>) => {
    try {
      const answer = await lunaCall<Record<string, unknown>>(`${MEDIA}/${method}`, params, 3000);
      // An answer that is not a plain success is noted as it came, for the next look.
      const odd =
        answer.returnValue === true
          ? ''
          : ` (returnValue ${String(answer.returnValue)}, errorCode ${String(answer.errorCode)}, ${String(answer.errorText)})`;
      say(
        `${method} ${JSON.stringify(params.type ?? params.enable ?? '')} ${params.index ?? ''}: ok${odd}`,
      );
      return true;
    } catch (error) {
      const code = error instanceof LunaError ? ` (errorCode ${String(error.errorCode)})` : '';
      say(`${method}: ${error instanceof Error ? error.message : String(error)}${code}`);
      return false;
    }
  };

  const watch = async (label: string) => {
    const from = video.currentTime;
    await wait(WATCH_MS);
    const moved = video.currentTime - from;
    const error = video.error ? ` error ${video.error.code}` : '';
    say(`${label}: clock moved ${moved.toFixed(1)} s${video.paused ? ' (paused)' : ''}${error}`);
  };

  const run = async () => {
    if (!isWebOS()) {
      say('Embedded tracks test: only runs on the TV');
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
      say('No mediaId: play the MKV first');
      return;
    }
    say(`mediaId after ${Date.now() - started} ms`);

    let program: ProgramInfo | null = null;
    const listen = (id: string) => {
      let noted = 0;
      subscriptions.push(
        lunaSubscribe(`${MEDIA}/subscribe`, { mediaId: id }, (message) => {
          if (noted < NOTED_MESSAGES) {
            noted++;
            say(`message: ${Object.keys(message).join(', ')}`);
          }
          const info = message.sourceInfo as { programInfo?: ProgramInfo[] } | undefined;
          if (info && !program) {
            program = info.programInfo?.[0] ?? {};
            const subtitles = (program.subtitleTrackInfo ?? []).map((t) => t.language || '?');
            const audio = (program.audioTrackInfo ?? []).map(
              (t) => `${t.language || '?'} ${t.codec ?? ''}`,
            );
            say(
              `sourceInfo: ${program.numSubtitleTracks ?? 0} subtitles (${program.subtitleType ?? '?'}: ${subtitles.join(', ')}), ${program.numAudioTracks ?? 0} audio (${audio.join(', ')})`,
            );
          }
          if (message.trackSelected) say(`trackSelected ${JSON.stringify(message.trackSelected)}`);
          if (message.error) say(`pipeline error ${JSON.stringify(message.error)}`);
          if (message.returnValue === false) say(`subscribe refused: ${String(message.errorText)}`);
        }),
      );
    };
    const waitForProgram = async (ms: number) => {
      const from = Date.now();
      while (!program && !stopped && Date.now() - from < ms) await wait(250);
    };

    listen(mediaId);
    await waitForProgram(EARLY_SOURCE_INFO_WAIT_MS);
    if (stopped) return;
    if (!program) {
      // The pipeline describes a file once, as it opens it, so the video is
      // opened again with a subscription ready for its new mediaId.
      say('No sourceInfo yet: opening the video again to catch it');
      const at = video.currentTime;
      const before = mediaId;
      const restore = () => {
        video.currentTime = at;
      };
      video.addEventListener('loadedmetadata', restore, { once: true });
      // Stopped before the video opened again: the next video must not jump to this one's time.
      subscriptions.push(() => video.removeEventListener('loadedmetadata', restore));
      video.load();
      void video.play().catch(() => undefined);
      const from = Date.now();
      let reopened = mediaIdOf(video);
      while (
        (!reopened || reopened === before) &&
        !stopped &&
        Date.now() - from < MEDIA_ID_WAIT_MS
      ) {
        await wait(50);
        reopened = mediaIdOf(video);
      }
      if (stopped) return;
      if (reopened && reopened !== before) {
        say(`new mediaId after ${Date.now() - from} ms`);
        mediaId = reopened;
        listen(mediaId);
      } else {
        say('The mediaId did not change');
      }
      await waitForProgram(SOURCE_INFO_WAIT_MS);
      if (stopped) return;
    }
    if (!program) say('No sourceInfo; trying the calls anyway');
    await watch('after subscribe');
    if (stopped) return;

    const count = Math.min((program as ProgramInfo | null)?.numSubtitleTracks ?? 2, 2);
    if (!(await call('setSubtitleEnable', { mediaId, enable: true }))) return;
    await wait(500);
    for (let index = 0; index < count && !stopped; index++) {
      await call('selectTrack', { mediaId, type: 'text', index });
      if (stopped) return;
      await watch(`after text ${index}`);
    }
    if (stopped) return;
    await call('setSubtitleEnable', { mediaId, enable: false });
    await watch('after subtitles off');
    if (stopped) return;
    await call('selectTrack', { mediaId, type: 'audio', index: 1 });
    await watch('after audio 1');
    if (stopped) return;
    unsubscribe();
    await call('unsubscribe', { mediaId });
    say('Embedded tracks test done');
  };

  void run().catch((error: unknown) => say(`Embedded tracks test failed: ${String(error)}`));
  return () => {
    stopped = true;
    unsubscribe();
  };
}
