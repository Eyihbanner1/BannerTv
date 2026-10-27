import { SEVERE_WARNINGS } from './assess';
import type {
  OrderOptions,
  QualityChoice,
  ReleaseSource,
  Resolution,
  StreamEntry,
  StreamOrder,
  TvCapabilities,
} from './types';

/** Highest first, as the Quality menu lists them. */
const RESOLUTIONS: readonly Resolution[] = [
  '2160p',
  '1440p',
  '1080p',
  '720p',
  '576p',
  '480p',
  '360p',
];

/**
 * Higher is better. A release whose source is unknown ranks between HDTV and
 * DVD: it is usually a direct link or a small addon that does not say, and
 * rarely a disc rip.
 */
const SOURCE_RANK: Readonly<Record<ReleaseSource, number>> = {
  REMUX: 10,
  BluRay: 9,
  'WEB-DL': 8,
  WEBRip: 7,
  HDTV: 6,
  DVD: 4,
  SCR: 3,
  TC: 2,
  TS: 1,
  CAM: 0,
};
const UNKNOWN_SOURCE_RANK = 5;

/** For 'fast', lower is better: 1080p starts quickly and looks fine, then 720p, then 4K, then the rest. */
function fastResolutionRank(resolution: Resolution | undefined): number {
  return resolution === '1080p' ? 0 : resolution === '720p' ? 1 : resolution === '2160p' ? 2 : 3;
}

function isSevere(entry: StreamEntry): boolean {
  for (const warning of entry.assessment.warnings) {
    if (SEVERE_WARNINGS.has(warning)) return true;
  }
  return false;
}

function isCinema(entry: StreamEntry): boolean {
  return entry.assessment.warnings.indexOf('cam') >= 0;
}

/**
 * Every order starts here: streams BannerTV plays, those with a severe
 * warning below them, then YouTube and web links, then streams that cannot
 * play here at all.
 */
function tier(entry: StreamEntry): number {
  switch (entry.assessment.action.kind) {
    case 'play':
      return isSevere(entry) ? 1 : 0;
    case 'youtube':
    case 'external':
      return 2;
    case 'unavailable':
      return 3;
  }
}

/** Higher is better: cached, then unknown, then a link that has to download first. */
function cacheRank(entry: StreamEntry): number {
  return entry.facts.cached === true ? 2 : entry.facts.cached === false ? 0 : 1;
}

/** Higher is better. 4K counts as 1080p on a TV that cannot show it. */
function resolutionRank(entry: StreamEntry, tv: TvCapabilities): number {
  const resolution = entry.facts.resolution;
  if (resolution === undefined) return 0;
  const index = RESOLUTIONS.indexOf(resolution);
  const capped = tv.uhd === false ? Math.max(index, RESOLUTIONS.indexOf('1080p')) : index;
  return RESOLUTIONS.length - capped;
}

/**
 * Higher is better. HDR only counts on a TV known to show it, and Dolby
 * Vision only on a TV known to have it; LG TVs show HDR10+ as HDR10.
 */
function hdrRank(entry: StreamEntry, tv: TvCapabilities): number {
  const hdr = entry.facts.hdr;
  if (hdr.indexOf('DV') >= 0 && tv.dolbyVision === true) return 2;
  if (tv.hdr10 === true && hdr.some((format) => format !== 'DV')) return 1;
  return 0;
}

function sourceRank(entry: StreamEntry): number {
  const source = entry.facts.releaseSource;
  return source === undefined ? UNKNOWN_SOURCE_RANK : SOURCE_RANK[source];
}

function scorer(options: OrderOptions): (addonId: string) => number {
  const read = options.addonScore;
  if (!read) return () => 0.5;
  const scores = new Map<string, number>();
  return (addonId) => {
    let score = scores.get(addonId);
    if (score === undefined) {
      const value = read(addonId);
      score = typeof value === 'number' && isFinite(value) ? Math.min(1, Math.max(0, value)) : 0.5;
      scores.set(addonId, score);
    }
    return score;
  };
}

/** Sort keys, compared left to right, lowest first. */
type Key = number[];

function keyFor(
  entry: StreamEntry,
  order: StreamOrder,
  tv: TvCapabilities,
  score: (addonId: string) => number,
): Key {
  const head = tier(entry);
  if (order === 'addon') return [head, entry.addonRank, entry.rank];
  if (order === 'fast') {
    const size = entry.facts.sizeBytes;
    return [
      head,
      -cacheRank(entry),
      fastResolutionRank(entry.facts.resolution),
      size === undefined ? 1 : 0,
      size ?? 0,
      -score(entry.addonId),
      entry.addonRank,
      entry.rank,
    ];
  }
  // A camcorder copy at 1080p is a worse picture than any 720p release, so
  // cinema recordings rank below everything else that plays as well.
  return [
    head,
    isCinema(entry) ? 1 : 0,
    -resolutionRank(entry, tv),
    -cacheRank(entry),
    -hdrRank(entry, tv),
    -sourceRank(entry),
    -score(entry.addonId),
    -(entry.facts.seeders ?? -1),
    entry.addonRank,
    entry.rank,
  ];
}

function compareKeys(a: Key, b: Key): number {
  for (let i = 0; i < a.length; i++) {
    const difference = a[i]! - b[i]!;
    if (difference !== 0) return difference;
  }
  return 0;
}

/**
 * The streams in the chosen order. Streams that cannot play here go last in
 * every order, and streams with a warning that usually means no picture or
 * no sound go below those without. Sorting is stable, so equal streams keep
 * the addons' own order.
 */
export function orderStreams(
  entries: readonly StreamEntry[],
  order: StreamOrder,
  tv: TvCapabilities,
  options: OrderOptions = {},
): StreamEntry[] {
  const score = scorer(options);
  const keyed = entries.map((entry, index) => ({
    entry,
    index,
    key: keyFor(entry, order, tv, score),
  }));
  // Chromium 68 sorts more than 10 items unstably, so ties fall back to the
  // original position.
  keyed.sort((a, b) => compareKeys(a.key, b.key) || a.index - b.index);
  return keyed.map((item) => item.entry);
}

/**
 * What auto-play may try, best first: streams BannerTV's own player can
 * play, without a warning that usually means no picture or no sound unless
 * nothing else is left.
 *
 * Within each of those two groups cinema recordings go last. A recording
 * plays, so it comes before a stream that probably shows nothing or stays
 * silent; those stay at the very end as a last resort for failover.
 */
export function playableCandidates(
  entries: readonly StreamEntry[],
  order: Exclude<StreamOrder, 'addon'>,
  tv: TvCapabilities,
  options: OrderOptions = {},
): StreamEntry[] {
  const playable = entries.filter((entry) => entry.assessment.action.kind === 'play');
  const groups: StreamEntry[][] = [[], [], [], []];
  for (const entry of orderStreams(playable, order, tv, options)) {
    groups[(isSevere(entry) ? 2 : 0) + (isCinema(entry) ? 1 : 0)]!.push(entry);
  }
  return groups[0]!.concat(groups[1]!, groups[2]!, groups[3]!);
}

/**
 * The player's Quality menu: for each resolution among the candidates, the
 * first candidate at it, highest resolution first; unknown resolutions last.
 *
 * At each resolution the first candidate without a severe warning is
 * preferred. A resolution offered only by streams with a severe warning (4K
 * on an HD TV, say) is left out while any other resolution has a stream
 * without one: picking it would most likely leave the viewer with no picture
 * or no sound. When every stream has one, all resolutions stay.
 */
export function qualityChoices(candidates: readonly StreamEntry[]): QualityChoice[] {
  const best = new Map<Resolution | undefined, StreamEntry>();
  const fallback = new Map<Resolution | undefined, StreamEntry>();
  for (const entry of candidates) {
    const resolution = entry.facts.resolution;
    const into = isSevere(entry) ? fallback : best;
    if (!into.has(resolution)) into.set(resolution, entry);
  }
  const choices: QualityChoice[] = [];
  for (const resolution of [...RESOLUTIONS, undefined]) {
    const entry = best.get(resolution) ?? (best.size === 0 ? fallback.get(resolution) : undefined);
    if (entry) choices.push({ resolution, entry });
  }
  return choices;
}
