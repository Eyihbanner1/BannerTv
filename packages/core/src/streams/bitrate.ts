import type { Resolution, StreamFacts } from './types';

/**
 * The average bitrate assumed to play smoothly on a TV that has not shown
 * otherwise, in bits per second. 4K web releases and Blu-ray encodes sit
 * well under it; 4K disc remuxes (60 to 80 Mbit/s, with peaks far higher)
 * sit over it, and on the test TV one buffered again and again. Many LG TVs
 * have 100 Mbit/s Ethernet and real Wi-Fi rates below that.
 */
export const DEFAULT_MAX_BITRATE = 40e6;

/**
 * Reads a running time such as "155 min", "2h 35min", "2 h" or "95" (minutes)
 * into seconds. Undefined when it says nothing usable.
 */
export function parseRuntime(text: string | undefined): number | undefined {
  if (!text) return undefined;
  const value = text.trim().toLowerCase();
  const hours = /(\d+(?:\.\d+)?)\s*h/.exec(value);
  const minutes = /(\d+)\s*m/.exec(value);
  let seconds = 0;
  if (hours) seconds += parseFloat(hours[1]!) * 3600;
  if (minutes) seconds += parseInt(minutes[1]!, 10) * 60;
  if (!hours && !minutes && /^\d+$/.test(value)) seconds = parseInt(value, 10) * 60;
  return seconds > 0 ? seconds : undefined;
}

/**
 * A stream's average bitrate in bits per second, from its file size and the
 * video's running time. Undefined when either is unknown, as for adaptive
 * HLS and DASH streams, or a live stream's endless length.
 */
export function estimateBitrate(
  facts: Pick<StreamFacts, 'sizeBytes'>,
  runtimeSeconds: number | undefined,
): number | undefined {
  const size = facts.sizeBytes;
  if (
    size === undefined ||
    !(size > 0) ||
    runtimeSeconds === undefined ||
    !(runtimeSeconds > 0) ||
    !isFinite(runtimeSeconds)
  ) {
    return undefined;
  }
  return (size * 8) / runtimeSeconds;
}

/**
 * The lowest average bitrate a whole video can have at each resolution, in
 * bits per second: half or less of the smallest real encodes. A 24-minute
 * 720p x265 episode of 70 MB is about 400 kbit/s, a 45-minute 1080p one of
 * 250 MB about 780 kbit/s, a 2-hour 4K film of 4 GB about 4.8 Mbit/s.
 */
const MIN_BITRATE: Readonly<Record<Resolution, number>> = {
  '2160p': 1e6,
  '1440p': 0.6e6,
  '1080p': 0.3e6,
  '720p': 0.2e6,
  '576p': 0.1e6,
  '480p': 0.1e6,
  '360p': 0.1e6,
};
const MIN_BITRATE_UNKNOWN = 0.1e6;

/**
 * Whether a file is far too small to last `lengthSeconds`, the measured
 * length of the video playing: a sample or trailer, not the video. False
 * when the size or the length is unknown. Never pass an assumed running
 * time, which is long on purpose and would make small encodes look like clips.
 */
export function isTooSmall(
  facts: Pick<StreamFacts, 'sizeBytes' | 'resolution'>,
  lengthSeconds: number | undefined,
): boolean {
  const bitrate = estimateBitrate(facts, lengthSeconds);
  if (bitrate === undefined) return false;
  return bitrate < (facts.resolution ? MIN_BITRATE[facts.resolution] : MIN_BITRATE_UNKNOWN);
}

/**
 * Only a video this long is told from a clip by its length: a short's or a
 * short series' running time can be far off for one episode (an anthology's
 * run from 6 to 17 minutes under one figure).
 */
const MIN_LENGTH_FOR_CLIP_S = 20 * 60;
/** A stream under this long is a clip of a video of 20 minutes or more. */
const MAX_CLIP_S = 5 * 60;

/**
 * Whether a stream, `seconds` long, is a clip of the video it should be,
 * `lengthSeconds` long: under five minutes, for a video of 20 minutes or more.
 * A sample, a trailer, or a debrid service's "not ready yet" clip, whatever
 * its name and size say.
 */
export function isMuchShorter(seconds: number, lengthSeconds: number): boolean {
  return (
    isFinite(lengthSeconds) &&
    lengthSeconds >= MIN_LENGTH_FOR_CLIP_S &&
    seconds > 0 &&
    seconds < MAX_CLIP_S
  );
}

const RESOLUTION_ORDER: readonly Resolution[] = [
  '360p',
  '480p',
  '576p',
  '720p',
  '1080p',
  '1440p',
  '2160p',
];

/** A step down needs at least this much less data, or it would buffer the same way. */
const LIGHTER_SHARE = 0.7;

/**
 * Whether `candidate` needs clearly less data than `current`, which kept
 * buffering. Compared by bitrate when both are known, otherwise by
 * resolution: a 1080p stream is lighter than a 4K one.
 */
export function isLighter(
  candidate: Pick<StreamFacts, 'sizeBytes' | 'resolution'>,
  current: Pick<StreamFacts, 'sizeBytes' | 'resolution'>,
  runtimeSeconds: number | undefined,
): boolean {
  const candidateRate = estimateBitrate(candidate, runtimeSeconds);
  const currentRate = estimateBitrate(current, runtimeSeconds);
  if (candidateRate !== undefined && currentRate !== undefined) {
    return candidateRate <= currentRate * LIGHTER_SHARE;
  }
  const from = current.resolution ? RESOLUTION_ORDER.indexOf(current.resolution) : -1;
  const to = candidate.resolution ? RESOLUTION_ORDER.indexOf(candidate.resolution) : -1;
  return from >= 0 && to >= 0 && to < from;
}
