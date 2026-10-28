import {
  asRecord,
  type JsonRecord,
  readHttpUrl,
  readIsoDate,
  readList,
  readNumber,
  readPlainText,
  readString,
  readStringList,
} from './lenient';
import { ProtocolError } from './manifest';
import type {
  CacheHints,
  CatalogResponse,
  ContentType,
  MetaDetail,
  MetaLink,
  MetaPreview,
  MetaResponse,
  PosterShape,
  SportHints,
  Video,
} from './types';

function readPosterShape(value: unknown): PosterShape {
  return value === 'square' || value === 'landscape' ? value : 'poster';
}

function addUnique(target: string[], values: readonly string[]): string[] {
  for (const value of values) if (target.indexOf(value) === -1) target.push(value);
  return target;
}

function readLinks(value: unknown): MetaLink[] {
  const links: MetaLink[] = [];
  for (const item of readList(value)) {
    const record = asRecord(item);
    const name = record && readString(record.name);
    const category = record && readString(record.category);
    if (!record || name === undefined || category === undefined) continue;
    const link: MetaLink = { name, category };
    const url = readString(record.url);
    if (url !== undefined) link.url = url;
    links.push(link);
  }
  return links;
}

function linkNames(links: readonly MetaLink[], category: string): string[] {
  const wanted = category.toLowerCase();
  return links.filter((l) => l.category.toLowerCase() === wanted).map((l) => l.name);
}

/** YouTube IDs from `trailers` (legacy) and `trailerStreams`. */
function readTrailers(record: JsonRecord): string[] {
  const ids: string[] = [];
  for (const item of readList(record.trailers)) {
    const trailer = asRecord(item);
    const source = trailer && readString(trailer.source);
    const type = trailer && readString(trailer.type);
    if (source !== undefined && (type === undefined || type === 'Trailer')) {
      addUnique(ids, [source]);
    }
  }
  for (const item of readList(record.trailerStreams)) {
    const stream = asRecord(item);
    const ytId = stream && readString(stream.ytId);
    if (ytId !== undefined) addUnique(ids, [ytId]);
  }
  return ids;
}

function setIfDefined<T extends object, K extends keyof T>(target: T, key: K, value: T[K]): void {
  if (value !== undefined) target[key] = value;
}

/** A team as a name, or as `{ name, logo }`. */
function readTeam(value: unknown): string | undefined {
  return readString(value) ?? readString(asRecord(value)?.name);
}

/** The non-standard fields sports addons add, or undefined when there are none. */
function readSportHints(record: JsonRecord): SportHints | undefined {
  const hints: SportHints = {};
  setIfDefined(
    hints,
    'start',
    readString(record.eventStart) ??
      readString(record.startTime) ??
      readString(record.start_time) ??
      readString(record.kickoff) ??
      readString(record.kickOff),
  );
  setIfDefined(hints, 'home', readTeam(record.team1) ?? readTeam(record.homeTeam));
  setIfDefined(hints, 'away', readTeam(record.team2) ?? readTeam(record.awayTeam));
  if (typeof record.isLive === 'boolean') hints.live = record.isLive;
  setIfDefined(hints, 'category', readString(record.category));
  setIfDefined(
    hints,
    'league',
    readString(record.league) ?? readString(record.competition) ?? readString(record.tournament),
  );
  return Object.keys(hints).length > 0 ? hints : undefined;
}

/**
 * Reads one catalog or meta item. Returns undefined when it has no id or
 * name, so the caller can drop it and keep the rest of the response.
 * `fallbackType` is the type the request was made for, used when the item
 * leaves its own out.
 */
export function parseMetaPreview(
  value: unknown,
  fallbackType?: ContentType,
): MetaPreview | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const id = readString(record.id);
  const name = readString(record.name);
  const type = readString(record.type) ?? fallbackType;
  if (id === undefined || name === undefined || type === undefined) return undefined;

  const links = readLinks(record.links);
  const preview: MetaPreview = {
    id,
    type,
    name,
    posterShape: readPosterShape(record.posterShape),
    genres: addUnique(
      addUnique(readStringList(record.genres), readStringList(record.genre)),
      linkNames(links, 'Genres'),
    ),
    trailers: readTrailers(record),
  };
  setIfDefined(preview, 'poster', readHttpUrl(record.poster));
  setIfDefined(preview, 'background', readHttpUrl(record.background));
  setIfDefined(preview, 'logo', readHttpUrl(record.logo));
  setIfDefined(preview, 'description', readPlainText(record.description));
  setIfDefined(preview, 'releaseInfo', readString(record.releaseInfo) ?? readString(record.year));
  setIfDefined(preview, 'imdbRating', readString(record.imdbRating) ?? linkNames(links, 'imdb')[0]);
  setIfDefined(preview, 'runtime', readString(record.runtime));
  setIfDefined(preview, 'released', readString(record.released));
  setIfDefined(preview, 'sport', readSportHints(record));
  return preview;
}

export function parseVideo(value: unknown): Video | undefined {
  const record = asRecord(value);
  const id = record && readString(record.id);
  if (!record || id === undefined) return undefined;
  const video: Video = { id, title: readString(record.title) ?? readString(record.name) ?? '' };
  setIfDefined(video, 'released', readIsoDate(record.released) ?? readIsoDate(record.firstAired));
  setIfDefined(video, 'season', readNumber(record.season));
  setIfDefined(video, 'episode', readNumber(record.episode) ?? readNumber(record.number));
  setIfDefined(video, 'thumbnail', readHttpUrl(record.thumbnail));
  setIfDefined(
    video,
    'overview',
    readPlainText(record.overview) ?? readPlainText(record.description),
  );
  return video;
}

export function parseMetaDetail(
  value: unknown,
  fallbackType?: ContentType,
): MetaDetail | undefined {
  const preview = parseMetaPreview(value, fallbackType);
  const record = asRecord(value);
  if (!preview || !record) return undefined;

  const links = readLinks(record.links);
  const videos: Video[] = [];
  for (const item of readList(record.videos)) {
    const video = parseVideo(item);
    if (video && !videos.some((v) => v.id === video.id)) videos.push(video);
  }
  const hints = asRecord(record.behaviorHints) ?? {};
  const detail: MetaDetail = {
    ...preview,
    videos,
    cast: addUnique(readStringList(record.cast), linkNames(links, 'Cast')),
    directors: addUnique(readStringList(record.director), linkNames(links, 'Directors')),
    writers: addUnique(readStringList(record.writer), linkNames(links, 'Writers')),
    links,
    behaviorHints: { hasScheduledVideos: hints.hasScheduledVideos === true },
  };
  setIfDefined(detail, 'country', readString(record.country));
  setIfDefined(detail.behaviorHints, 'defaultVideoId', readString(hints.defaultVideoId));
  return detail;
}

export function readCacheHints(record: JsonRecord): CacheHints {
  const hints: CacheHints = {};
  for (const key of ['cacheMaxAge', 'staleRevalidate', 'staleError'] as const) {
    const seconds = readNumber(record[key]);
    if (seconds !== undefined && seconds >= 0) hints[key] = seconds;
  }
  return hints;
}

/** `{ metas: [...] }`. Bad items are dropped and counted, never the whole response. */
export function parseCatalogResponse(value: unknown, type?: ContentType): CatalogResponse {
  const record = asRecord(value);
  if (!record || !Array.isArray(record.metas)) {
    throw new ProtocolError('The catalog response has no metas list');
  }
  const metas: MetaPreview[] = [];
  let dropped = 0;
  for (const item of record.metas) {
    const preview = parseMetaPreview(item, type);
    if (preview && !metas.some((m) => m.id === preview.id)) metas.push(preview);
    else dropped++;
  }
  return { metas, dropped, cache: readCacheHints(record) };
}

/** `{ meta: {...} }`. A null or unreadable meta means this addon does not know the title. */
export function parseMetaResponse(value: unknown, type?: ContentType): MetaResponse {
  const record = asRecord(value);
  if (!record) throw new ProtocolError('The meta response is not a JSON object');
  return { meta: parseMetaDetail(record.meta, type) ?? null, cache: readCacheHints(record) };
}
