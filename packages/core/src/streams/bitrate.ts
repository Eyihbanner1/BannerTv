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
 * HLS and DASH streams.
 */
export function estimateBitrate(
  facts: Pick<StreamFacts, 'sizeBytes'>,
  runtimeSeconds: number | undefined,
): number | undefined {
  const size = facts.sizeBytes;
  if (size === undefined || !(size > 0) || runtimeSeconds === undefined || !(runtimeSeconds > 0)) {
    return undefined;
  }
  return (size * 8) / runtimeSeconds;
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
