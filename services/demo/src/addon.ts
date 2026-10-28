/**
 * The addon's answers, built from films.json. Pure functions of the films and
 * the origin the Worker runs on, so the tests can check them against the TV
 * app's own parser and stream ranker.
 *
 * What the app needs from them (see docs/DEMO_ADDON.md for the sources):
 * - Ids use our own prefix, so Cinemeta and OpenSubtitles are never asked
 *   about these films, and nothing else fills in their artwork. Every item
 *   carries its poster, backdrop, title logo and description, because the
 *   Home hero shows catalog data only.
 * - The catalog takes no genre or skip extras: a genre list would take over
 *   Cinemeta's genre rows on Home. Search is answered, so the films are found
 *   by name.
 * - One adaptive HLS stream per film plus an identical backup, which the
 *   player falls back to if the first stalls. The stream `name` is never shown
 *   in BannerTV, so the credit goes on the description's first line.
 * - The ranker reads words in the description: no "TS", "HD" on its own,
 *   sizes or other words it would take for a quality fact.
 */
import data from '../films.json';

export interface Film {
  slug: string;
  name: string;
  logoLines: string[];
  year: number;
  durationSeconds: number;
  genres: string[];
  director: string[];
  cast: string[];
  description: string;
  credit: string;
  licence: { name: string; url: string };
  website: string;
  source: { fps: number; urls: string[] };
  media: number;
  art: { background: number | null; poster: number | null; posterFocus: number };
}

export const FILMS: readonly Film[] = data.films;

export const ADDON_ID = 'com.bannertv.demo';
export const ADDON_VERSION = '1.0.0';
export const ADDON_NAME = 'BannerTV Demo';
export const ID_PREFIX = 'bannertv:';
export const CATALOG_ID = 'blender';
export const CATALOG_NAME = 'Blender open movies';

/** Seconds, read by the app from the JSON body (it ignores HTTP caching). */
const CACHE_HINTS = { cacheMaxAge: 21600, staleRevalidate: 604800, staleError: 2592000 };

/** The subtitle check tracks prepare-media.mjs writes for every film (scripts/lib/captions.mjs). */
export const CAPTION_TRACKS = [
  { lang: 'eng', file: 'eng.vtt' },
  { lang: 'kor', file: 'kor.vtt' },
] as const;

export function filmId(film: Film): string {
  return ID_PREFIX + film.slug;
}

export function findFilm(id: string): Film | undefined {
  return FILMS.find((film) => filmId(film) === id);
}

function mediaBase(origin: string, film: Film): string {
  return `${origin}/media/${film.slug}/v${film.media}`;
}

function artBase(origin: string, film: Film): string {
  return `${origin}/art/${film.slug}`;
}

export function manifest(origin: string) {
  return {
    id: ADDON_ID,
    version: ADDON_VERSION,
    name: ADDON_NAME,
    description:
      'Creative Commons films from the Blender Foundation, to try BannerTV with. Served by BannerTV, with no request logs.',
    logo: `${origin}/art/addon.png`,
    types: ['movie'],
    idPrefixes: [ID_PREFIX],
    resources: ['catalog', 'meta', 'stream'],
    catalogs: [{ type: 'movie', id: CATALOG_ID, name: CATALOG_NAME, extra: [{ name: 'search' }] }],
    behaviorHints: { adult: false, p2p: false, configurable: false, configurationRequired: false },
  };
}

function runtime(film: Film): string {
  return `${Math.max(1, Math.round(film.durationSeconds / 60))} min`;
}

export function preview(origin: string, film: Film) {
  const art = artBase(origin, film);
  return {
    id: filmId(film),
    type: 'movie',
    name: film.name,
    poster: `${art}/poster.jpg`,
    posterShape: 'poster',
    background: `${art}/background.jpg`,
    logo: `${art}/logo.png`,
    description: film.description,
    releaseInfo: String(film.year),
    runtime: runtime(film),
    genres: film.genres,
  };
}

/** The credit as one sentence, for Details and the credits page. */
export function creditSentence(film: Film): string {
  return `${film.credit}. Licensed under ${film.licence.name}; re-encoded for streaming by BannerTV.`;
}

export function meta(origin: string, film: Film) {
  return {
    ...preview(origin, film),
    // Details shows six lines; the hero, which uses the catalog item, three.
    description: `${film.description} ${creditSentence(film)}`,
    director: film.director,
    ...(film.cast.length > 0 ? { cast: film.cast } : {}),
    website: film.website,
  };
}

/** Lower case without accents, for matching search text. */
function fold(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/**
 * The catalog, or the films matching a search. Every word typed must appear
 * in the title, director, genres or year.
 */
export function catalog(origin: string, extra: Record<string, string>) {
  let films = [...FILMS];
  const search = extra.search?.trim();
  if (search !== undefined) {
    const words = fold(search).split(/\s+/).filter(Boolean);
    films = films.filter((film) => {
      const text = fold([film.name, ...film.director, ...film.genres, String(film.year)].join(' '));
      return words.length > 0 && words.every((word) => text.includes(word));
    });
  }
  const skip = Number(extra.skip ?? 0);
  if (Number.isFinite(skip) && skip > 0) films = films.slice(skip);
  return { metas: films.map((film) => preview(origin, film)), ...CACHE_HINTS };
}

export const STREAM_NAME = `${ADDON_NAME}\nAuto · up to 1080p`;

function stream(origin: string, film: Film, backup: boolean) {
  const base = mediaBase(origin, film);
  return {
    url: `${base}/master.m3u8${backup ? '?b=1' : ''}`,
    name: STREAM_NAME,
    description: [
      `${film.name} (${film.year}) · ${film.licence.name} · © Blender Foundation`,
      'Adaptive HLS · 1080p · H.264 · AAC 2.0',
      ...(backup ? ['Backup copy'] : []),
    ].join('\n'),
    subtitles: CAPTION_TRACKS.map((track) => ({
      id: `${film.slug}-${track.lang}`,
      url: `${base}/subs/${track.file}`,
      lang: track.lang,
    })),
    behaviorHints: { bingeGroup: 'bannertv-demo-hls' },
  };
}

export function streams(origin: string, film: Film | undefined) {
  return { streams: film ? [stream(origin, film, false), stream(origin, film, true)] : [] };
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

/** The page a person sees at the addon's address: what it is, and the films' credits. */
export function creditsPage(origin: string): string {
  const items = FILMS.map(
    (film) => `<li><h2>${escapeHtml(film.name)} (${film.year})</h2>
<p>Directed by ${escapeHtml(film.director.join(', '))}. ${escapeHtml(film.credit)}.</p>
<p>Licence: <a href="${escapeHtml(film.licence.url)}">${escapeHtml(film.licence.name)}</a>. Original: <a href="${escapeHtml(film.website)}">${escapeHtml(film.website)}</a>.</p></li>`,
  ).join('\n');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>BannerTV Demo</title>
<style>body{font:17px/1.5 system-ui,sans-serif;max-width:44rem;margin:2rem auto;padding:0 1rem;color:#1b1430}h1{font-size:1.6rem}h2{font-size:1.1rem;margin:1.4rem 0 .2rem}ul{padding:0;list-style:none}a{color:#4b23c8}code{background:#f1edff;padding:0 .3em}</style>
</head><body>
<h1>BannerTV Demo</h1>
<p>A <a href="https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/protocol.md">Stremio-protocol</a> addon with a few Creative Commons films from the Blender Foundation, so BannerTV has something to play from the moment it is installed. Its address is <code>${escapeHtml(origin)}/manifest.json</code>.</p>
<p>The films are shown unchanged apart from being re-encoded for streaming at several sizes and fitted to a 16:9 frame. Title artwork is set by BannerTV in Urbanist. The Blender Foundation does not endorse BannerTV. This service keeps no request logs.</p>
<ul>
${items}
</ul>
</body></html>
`;
}
