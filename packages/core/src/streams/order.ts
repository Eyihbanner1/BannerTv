import { languageKey } from '../subtitles/languages';
import { SEVERE_WARNINGS } from './assess';
import { estimateBitrate, isTooSmall } from './bitrate';
import type {
  OrderOptions,
  QualityChoice,
  QualityReference,
  ReleaseSource,
  Resolution,
  StreamEntry,
  StreamFacts,
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

function isSevere(entry: Pick<StreamEntry, 'assessment'>): boolean {
  for (const warning of entry.assessment.warnings) {
    if (SEVERE_WARNINGS.has(warning)) return true;
  }
  return false;
}

function isCinema(entry: StreamEntry): boolean {
  return entry.assessment.warnings.indexOf('cam') >= 0;
}

/**
 * Lower is likelier to play well: no warning that matters, a cinema
 * recording, a severe warning, then both.
 */
function playGroup(entry: StreamEntry): number {
  return (isSevere(entry) ? 2 : 0) + (isCinema(entry) ? 1 : 0);
}

/**
 * Every order starts here: 0 for streams BannerTV plays, 1 for those with a
 * severe warning, 2 for YouTube and web links, 3 for streams that cannot play
 * here at all. A list that keeps its rows in place as more addons answer
 * keeps them within their tier.
 */
export function streamTier(entry: Pick<StreamEntry, 'assessment'>): number {
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
 * Vision only on a TV known to have it; LG TVs show HDR10+ as HDR10. On a TV
 * known to lack HDR an HDR stream looks washed out, so SDR fits it better.
 */
function hdrRank(entry: StreamEntry, tv: TvCapabilities): number {
  const hdr = entry.facts.hdr;
  if (hdr.length === 0) return 0;
  if (hdr.indexOf('DV') >= 0 && tv.dolbyVision === true) return 2;
  if (tv.hdr10 === false) return -1;
  return tv.hdr10 === true && hdr.some((format) => format !== 'DV') ? 1 : 0;
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

/**
 * Above 0 for a stream estimated to need more data than the connection is
 * expected to give, so it would keep stopping to buffer: 1 up to twice the
 * limit, 2 up to four times, and so on. 0 otherwise or when unknown.
 */
function heavy(entry: StreamEntry, options: OrderOptions): number {
  if (options.maxBitrate === undefined) return 0;
  const bitrate = estimateBitrate(entry.facts, options.runtimeSeconds);
  if (bitrate === undefined || bitrate <= options.maxBitrate) return 0;
  // Graded by how far over, so when every stream is too heavy the lightest still comes first.
  return 1 + Math.floor(Math.log2(bitrate / options.maxBitrate));
}

/** Sort keys, compared left to right, lowest first. */
type Key = number[];

function keyFor(
  entry: StreamEntry,
  order: StreamOrder,
  tv: TvCapabilities,
  score: (addonId: string) => number,
  options: OrderOptions,
  wanted: readonly string[],
): Key {
  const head = streamTier(entry);
  if (order === 'addon') return [head, entry.addonRank, entry.rank];
  // A dub the viewer can't follow is worse than any picture, so the language
  // comes straight after how likely a stream is to play.
  const language = languageRank(entry.facts, wanted);
  if (order === 'fast') {
    const size = entry.facts.sizeBytes;
    return [
      head,
      language,
      heavy(entry, options),
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
  // cinema recordings rank below everything else that plays as well. A
  // picture that keeps stopping to buffer is worse than a smaller one that
  // plays, so streams too heavy for the connection come next.
  return [
    head,
    isCinema(entry) ? 1 : 0,
    language,
    heavy(entry, options),
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
  const wanted = wantedLanguages(options.audioLanguage);
  const keyed = entries.map((entry, index) => ({
    entry,
    index,
    key: keyFor(entry, order, tv, score, options, wanted),
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
    groups[playGroup(entry)]!.push(entry);
  }
  return groups[0]!.concat(groups[1]!, groups[2]!, groups[3]!);
}

// How well a stream's audio fits the language heard now, lower is better.
/** It names a language heard now, or neither it nor what plays names one. */
const SAME_LANGUAGE = 0;
/**
 * It names several languages, says nothing while English plays, or names
 * English while what plays says nothing.
 */
const LIKELY_SAME = 1;
/** It says nothing while a language other than English plays. */
const UNSTATED = 2;
/** It names only other languages: a dub. */
const OTHER_LANGUAGES = 3;

/** An ISO 639-1 code, as stream facts name languages. */
const LANGUAGE_CODE = /^[a-z]{2}$/;

/** The audio languages a stream names, without "multi". */
function spoken(facts: StreamFacts): string[] {
  return facts.languages.filter((code) => code !== 'multi');
}

/** An audio language as an engine or a profile names it ("eng", "es-MX"), as ISO 639-1, or none. */
function wantedLanguages(language: string | undefined): string[] {
  const code = language ? languageKey(language).split('-')[0]! : '';
  return LANGUAGE_CODE.test(code) ? [code] : [];
}

/** The languages heard now: the playing track's, else those the playing stream names. */
function heardLanguages(reference: QualityReference | undefined): string[] {
  if (!reference) return [];
  const track = wantedLanguages(reference.audioLanguage);
  return track.length > 0 ? track : spoken(reference.entry.facts);
}

/**
 * From SAME_LANGUAGE to OTHER_LANGUAGES. English is often not stated
 * (Torrentio flags only other languages), so a stream that says nothing
 * probably has the film's own language.
 */
function languageFit(facts: StreamFacts, heard: readonly string[]): number {
  const named = spoken(facts);
  const multi = facts.languages.indexOf('multi') >= 0;
  if (heard.length === 0) {
    if (named.length === 0) return SAME_LANGUAGE;
    return multi || named.indexOf('en') >= 0 ? LIKELY_SAME : OTHER_LANGUAGES;
  }
  for (const code of heard) {
    if (named.indexOf(code) >= 0) return SAME_LANGUAGE;
  }
  if (multi) return LIKELY_SAME;
  if (named.length === 0) return heard.indexOf('en') >= 0 ? LIKELY_SAME : UNSTATED;
  return OTHER_LANGUAGES;
}

/**
 * For the first ranking, lower is better: the language wanted or probably so
 * (a stream that says nothing counts as the film's own language), then one
 * that says nothing while a language other than English is wanted, then a
 * dub in other languages only.
 */
function languageRank(facts: StreamFacts, wanted: readonly string[]): number {
  const fit = languageFit(facts, wanted);
  return fit === OTHER_LANGUAGES ? 2 : fit === UNSTATED ? 1 : 0;
}

/**
 * The audio languages a stream names when it names only others than the one
 * heard now, for a note such as "Spanish audio". Without what plays now, the
 * languages it names when none is English and it is not MULTi or Dual.
 * Undefined otherwise.
 */
export function otherLanguages(
  facts: StreamFacts,
  reference?: QualityReference,
): string[] | undefined {
  return languageFit(facts, heardLanguages(reference)) === OTHER_LANGUAGES
    ? spoken(facts)
    : undefined;
}

/** Releases from one family share their timing, so the subtitles set for one fit the other. */
const SOURCE_FAMILY: Readonly<Record<ReleaseSource, string>> = {
  REMUX: 'disc',
  BluRay: 'disc',
  'WEB-DL': 'web',
  WEBRip: 'web',
  HDTV: 'tv',
  DVD: 'dvd',
  SCR: 'cinema',
  TC: 'cinema',
  TS: 'cinema',
  CAM: 'cinema',
};

/** Most addons put the resolution in the binge group ("torrentio|1080p|FLUX"), so it is left out. */
const BINGE_RESOLUTION = /(?:^|[^a-z0-9])(?:\d{3,4}[pi]|4k|uhd|fhd|hd|sd)(?![a-z0-9])/g;
const HAS_WORD = /[a-z0-9]/;

function bingeFamily(entry: StreamEntry): string | undefined {
  const group = entry.stream.behaviorHints.bingeGroup;
  if (!group) return undefined;
  const family = group.toLowerCase().replace(BINGE_RESOLUTION, '|');
  return HAS_WORD.test(family) ? family : undefined;
}

/** What makes two streams the same release, or releases of one kind. */
interface Release {
  binge?: string;
  group?: string;
  family?: string;
}

function releaseOf(entry: StreamEntry): Release {
  const source = entry.facts.releaseSource;
  return {
    binge: bingeFamily(entry),
    group: entry.facts.releaseGroup,
    family: source === undefined ? undefined : SOURCE_FAMILY[source],
  };
}

function same(a: string | undefined, b: string | undefined): boolean {
  return a !== undefined && a === b;
}

/** A sample, trailer or file far too small for the length playing. What plays now never is one. */
function isClip(entry: StreamEntry, reference: QualityReference | undefined): boolean {
  if (reference && entry.stream === reference.entry.stream) return false;
  return entry.facts.sample === true || isTooSmall(entry.facts, reference?.lengthSeconds);
}

/**
 * How close a stream is to what plays now, after how likely it is to play:
 * the language heard, never heavier or less cached for it, then the same
 * release, then the same family of source.
 */
function closeness(
  entry: StreamEntry,
  playing: Release,
  heard: readonly string[],
  options: OrderOptions,
): Key {
  const release = releaseOf(entry);
  const sameRelease = same(release.binge, playing.binge) || same(release.group, playing.group);
  return [
    languageFit(entry.facts, heard),
    heavy(entry, options),
    -cacheRank(entry),
    sameRelease ? 0 : 1,
    same(release.family, playing.family) ? 0 : 1,
  ];
}

/**
 * The player's Quality menu: for each resolution among the candidates, the
 * first candidate at it, highest resolution first; unknown resolutions last.
 *
 * At each resolution the first candidate without a severe warning is
 * preferred, and one that is not a cinema recording before one that is. A
 * resolution offered only by streams with a severe warning (4K on an HD TV,
 * say) is left out while any other resolution has a stream without one:
 * picking it would most likely leave the viewer with no picture or no sound.
 * Likewise a resolution offered only by cinema recordings is left out while
 * another has a proper release, as the menu shows nothing but the resolution
 * and "4K" should not lead to a camcorder copy. When every stream has such a
 * warning, the resolutions of the likeliest to play stay.
 *
 * Given what plays now, each resolution offers the stream closest to it
 * instead of the first: the language heard, then light enough and cached,
 * then the same release and the same family of source. Samples, trailers and
 * files far too small for the length playing are left out, and a choice
 * that names only other languages says which. `options` are those the
 * candidates were ranked with. Without what plays now, samples are still
 * left out and nothing else changes.
 */
export function qualityChoices(
  candidates: readonly StreamEntry[],
  reference?: QualityReference,
  options: OrderOptions = {},
): QualityChoice[] {
  const heard = heardLanguages(reference);
  const playing = reference ? releaseOf(reference.entry) : undefined;
  const best = new Map<Resolution | undefined, { entry: StreamEntry; key: Key }>();
  let floor = Infinity;
  candidates.forEach((entry, index) => {
    if (isClip(entry, reference)) return;
    const group = playGroup(entry);
    // One pass, the index last: no sort, so nothing leans on Chromium 68's unstable one.
    const key = playing
      ? [group, ...closeness(entry, playing, heard, options), index]
      : [group, index];
    const known = best.get(entry.facts.resolution);
    if (!known || compareKeys(key, known.key) < 0) best.set(entry.facts.resolution, { entry, key });
    floor = Math.min(floor, group);
  });
  const choices: QualityChoice[] = [];
  for (const resolution of [...RESOLUTIONS, undefined]) {
    const found = best.get(resolution);
    if (!found || found.key[0] !== floor) continue;
    const choice: QualityChoice = { resolution, entry: found.entry };
    if (playing && found.key[1] === OTHER_LANGUAGES) {
      choice.otherLanguages = spoken(found.entry.facts);
    }
    choices.push(choice);
  }
  return choices;
}

/**
 * The stream an automatic switch, such as the step-down after buffering,
 * should take from `ordered`, which is best first. Never a clip, nor a
 * stream that names only other languages than the one heard now: a switch
 * the viewer did not ask for must not change what they hear. Among the rest
 * the likeliest to play well, then one in the language heard or probably
 * so, then the order given. Undefined when none is left.
 */
export function closestCandidate(
  ordered: readonly StreamEntry[],
  reference: QualityReference,
): StreamEntry | undefined {
  const heard = heardLanguages(reference);
  let best: StreamEntry | undefined;
  let bestKey: Key = [];
  for (let index = 0; index < ordered.length; index++) {
    const entry = ordered[index]!;
    if (isClip(entry, reference)) continue;
    const fit = languageFit(entry.facts, heard);
    if (fit === OTHER_LANGUAGES) continue;
    const key = [playGroup(entry), fit === UNSTATED ? 1 : 0, index];
    if (best === undefined || compareKeys(key, bestKey) < 0) {
      best = entry;
      bestKey = key;
    }
  }
  return best;
}

/**
 * The stream to offer for hearing `language` instead ("English audio: switch
 * stream"): one that names it, is MULTi or Dual, or says nothing while the
 * language is English (Torrentio flags only other languages). Never what
 * plays now, nor a clip. The likeliest to play well first, then one that
 * names the language, then light enough and cached, then the same release
 * and family of source as what plays, then the order given. Undefined when
 * none fits.
 */
export function streamInLanguage(
  ordered: readonly StreamEntry[],
  reference: QualityReference,
  language: string,
  options: OrderOptions = {},
): StreamEntry | undefined {
  const wanted = wantedLanguages(language);
  if (wanted.length === 0) return undefined;
  const playing = releaseOf(reference.entry);
  let best: StreamEntry | undefined;
  let bestKey: Key = [];
  for (let index = 0; index < ordered.length; index++) {
    const entry = ordered[index]!;
    if (entry.stream === reference.entry.stream || isClip(entry, reference)) continue;
    const fit = languageFit(entry.facts, wanted);
    if (fit > LIKELY_SAME) continue;
    const release = releaseOf(entry);
    const sameRelease = same(release.binge, playing.binge) || same(release.group, playing.group);
    const key = [
      playGroup(entry),
      fit,
      heavy(entry, options),
      -cacheRank(entry),
      sameRelease ? 0 : 1,
      same(release.family, playing.family) ? 0 : 1,
      index,
    ];
    if (best === undefined || compareKeys(key, bestKey) < 0) {
      best = entry;
      bestKey = key;
    }
  }
  return best;
}

/** Whether a stream names only audio languages other than `language`: a dub, for that viewer. */
export function namesOnlyOthers(facts: StreamFacts, language: string): boolean {
  return languageFit(facts, wantedLanguages(language)) === OTHER_LANGUAGES;
}
