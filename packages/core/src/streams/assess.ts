import type { Stream } from '@bannertv/protocol';
import type {
  AudioFormat,
  Container,
  StreamAction,
  StreamAssessment,
  StreamFacts,
  StreamWarning,
  TvCapabilities,
} from './types';

/**
 * Warnings that usually mean no picture, no sound or no start, rather than a
 * worse picture. Streams with one sink below those without, and auto-play
 * tries them only when nothing else is left. HDR on an SDR TV, Dolby Vision
 * with an HDR10 base, AVI and cinema recordings still play, so they are not
 * here.
 */
export const SEVERE_WARNINGS: ReadonlySet<StreamWarning> = new Set<StreamWarning>([
  'uncached',
  'uhd-on-hd-tv',
  'hevc',
  'av1',
  'dolby-vision-only',
  'truehd',
  'dts',
]);

const DTS: readonly AudioFormat[] = ['DTS:X', 'DTS-HD MA', 'DTS-HD', 'DTS'];

/**
 * AVI plays on webOS (LG's tables list it, and Jellyfin direct-plays it
 * there), but it has no index the player can seek with until the end of the
 * file has loaded, so seeking stalls on a network stream. MKV, MP4, TS and
 * the streaming formats are what the TV handles well.
 */
const OLD_CONTAINERS: readonly Container[] = ['avi'];

/** Recorded in a cinema: a camcorder, a line-in or a screener copy. */
const CINEMA = ['CAM', 'TS', 'TC', 'SCR'];

function actionFor(stream: Stream): StreamAction {
  switch (stream.source.kind) {
    case 'url': {
      // webOS's <video> cannot send request headers, and Chromium overwrites
      // any passed through mediaOption. Response headers need no help to play.
      const request = stream.behaviorHints.proxyHeaders?.request;
      return request && Object.keys(request).length > 0
        ? { kind: 'unavailable', reason: 'proxy-headers' }
        : { kind: 'play' };
    }
    case 'youtube':
      return { kind: 'youtube' };
    case 'external':
      return { kind: 'external' };
    case 'torrent':
      return { kind: 'unavailable', reason: 'torrent' };
  }
}

/** The track the TV plays first: the first codec named, else the best one listed. */
function mainAudio(facts: StreamFacts): AudioFormat | undefined {
  if (facts.mainAudio) return facts.mainAudio;
  for (const format of facts.audio) if (format !== 'Atmos') return format;
  return undefined;
}

/**
 * What pressing a stream does on this TV, and the warnings to show with it.
 * Only likely failures are warned about; unknown capabilities (null) never
 * produce a warning on their own. Warnings come most serious first.
 */
export function assessStream(
  stream: Stream,
  facts: StreamFacts,
  tv: TvCapabilities,
): StreamAssessment {
  const warnings: StreamWarning[] = [];
  const hdr = facts.hdr;
  const dolbyVision = hdr.indexOf('DV') >= 0;
  // Every other HDR format named is a base layer a TV without Dolby Vision can show.
  const hdrBase = hdr.some((format) => format !== 'DV');

  if (facts.cached === false) warnings.push('uncached');
  if (facts.resolution === '2160p' && tv.uhd === false) warnings.push('uhd-on-hd-tv');
  if (facts.videoCodec === 'HEVC' && tv.hevc === false) warnings.push('hevc');
  if (facts.videoCodec === 'AV1' && tv.av1 === false) warnings.push('av1');
  if (dolbyVision && tv.dolbyVision === false) {
    warnings.push(hdrBase ? 'dolby-vision-as-hdr10' : 'dolby-vision-only');
  }
  // Dolby Vision on a TV that shows it is fine whatever the TV says about HDR10.
  if (hdr.length > 0 && tv.hdr10 === false && !(dolbyVision && tv.dolbyVision === true)) {
    warnings.push('hdr-on-sdr-tv');
  }
  // A TrueHD file usually has its TrueHD track first, which plays silent;
  // a DD+ or AC-3 track named first is what the TV picks.
  if (mainAudio(facts) === 'TrueHD' && tv.truehd === false) warnings.push('truehd');
  if (tv.dts === false && facts.audio.some((format) => DTS.indexOf(format) >= 0)) {
    warnings.push('dts');
  }
  if (facts.container && OLD_CONTAINERS.indexOf(facts.container) >= 0) {
    warnings.push('old-container');
  }
  if (facts.releaseSource && CINEMA.indexOf(facts.releaseSource) >= 0) warnings.push('cam');

  // What stops a picture or sound comes before what only changes the picture.
  const severe = warnings.filter((warning) => SEVERE_WARNINGS.has(warning));
  const mild = warnings.filter((warning) => !SEVERE_WARNINGS.has(warning));
  return { action: actionFor(stream), warnings: severe.concat(mild) };
}
