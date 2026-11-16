import type { Subtitle } from '@bannertv/protocol';
import { releaseFeatures } from '../../subtitles/versions';
import { languageOfSubdl } from './languages';
import { SUBDL_DOWNLOADS, SUBDL_PREFER_UNPACK, type SubdlAsk } from './request';

/**
 * SubDL's answer, read leniently: a row that is not what BannerTV can use is
 * dropped and never throws. Its files are listed like any addon's, with the
 * release names SubDL gives for each (`releases`), so release matching,
 * lining up and files that agree treat them as any other file.
 */

/** A SubDL file, as the player lists it: its language as our key, never a link with the key. */
export interface SubdlFile extends Subtitle {
  /** The releases SubDL says the file was made for, trimmed, at most 20. */
  releases: string[];
}

export type SubdlFailure =
  'refused' | 'limit' | 'busy' | 'challenge' | 'server' | 'network' | 'timeout' | 'invalid';

export type SubdlOutcome = { files: SubdlFile[] } | { failure: SubdlFailure };

export const SUBDL_MAX_FILES = 60;
const MAX_RELEASES = 20;
const FILM_FILES_PER_ROW = 3;

type Fields = { [field: string]: unknown };

const isObject = (value: unknown): value is Fields =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

const count = (value: unknown): number => {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
};

/** The error's code and words, lower case, wherever SubDL put them. */
function errorOf(body: unknown): { code: string; words: string } {
  if (!isObject(body)) return { code: '', words: '' };
  const error = body.error;
  const code = isObject(error) ? text(error.code) : text(error);
  const words = [text(body.message), isObject(error) ? text(error.message) : text(error)]
    .join(' ')
    .toLowerCase();
  return { code: code.toLowerCase(), words };
}

const LIMIT_CODES = ['daily_limit', 'api_download_limit_exceeded', 'quota_exceeded'];

/** What SubDL's answer means: files, none, or why there are none this time. */
export function classifySubdlAnswer(status: number, body: unknown, ask: SubdlAsk): SubdlOutcome {
  if (status === 200 && isObject(body) && Array.isArray(body.subtitles)) {
    return { files: parseSubdlFiles(body, ask) };
  }
  const { code, words } = errorOf(body);
  // "Can't find …": SubDL has nothing for the title, which is an answer.
  if (
    isObject(body) &&
    body.status === false &&
    (words.indexOf("can't find") !== -1 || words.indexOf('can’t find') !== -1)
  ) {
    return { files: [] };
  }
  if (status === 401) return { failure: 'refused' };
  if (status === 403) {
    if (!isObject(body)) return { failure: 'challenge' };
    if (
      code === 'not_authorized' ||
      code === 'unauthorized' ||
      words.indexOf('key') !== -1 ||
      words.indexOf('authori') !== -1
    ) {
      return { failure: 'refused' };
    }
    return { failure: 'server' };
  }
  if (status === 402) return { failure: 'limit' };
  if (status === 429) {
    return { failure: LIMIT_CODES.indexOf(code) !== -1 ? 'limit' : 'busy' };
  }
  if (status === 200) return { failure: 'invalid' };
  return { failure: 'server' };
}

const ROW_PATH = /^\/subtitle\/[\w./-]+$/;
const STEM = /\/([\w-]{1,48})\.zip$/;
const FILE_PATH = /^\/subtitle\/\d+\/(\d+)$/;
const SUBTITLE_NAME = /\.(srt|ass|ssa|vtt)$/i;
const ABSOLUTE = /^https:\/\/dl\.subdl\.com(\/[^?#]*)$/i;

function rowPath(url: unknown): string | undefined {
  if (typeof url !== 'string') return undefined;
  const absolute = ABSOLUTE.exec(url);
  const path = absolute ? absolute[1]! : url;
  return ROW_PATH.test(path) ? path : undefined;
}

function isJunk(row: Fields): boolean {
  if (row.ai_translated === true) return true;
  const release = text(row.release_name);
  const comment = text(row.comment);
  if ([release, text(row.name), comment].some((name) => /\btrailer\b/i.test(name))) return true;
  return [release, comment].some((name) => /(machine|auto|google)[ -]?translat/i.test(name));
}

function cleanReleases(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    const name = typeof item === 'string' ? item.trim() : '';
    if (name === '' || out.indexOf(name) !== -1) continue;
    out.push(name);
    if (out.length === MAX_RELEASES) break;
  }
  return out;
}

function fpsOf(value: unknown): number | undefined {
  const fps = Number(value);
  return Number.isFinite(fps) && fps >= 10 && fps <= 120 ? fps : undefined;
}

const stripExtension = (name: string) => name.replace(/\.[a-z0-9]{1,4}$/i, '');
const baseName = (name: string) => name.slice(name.lastIndexOf('/') + 1);

interface RowFacts {
  pack: boolean;
  /** The row is for one episode, the one asked. */
  single: boolean;
}

/** Whether a row can be for the episode asked, and what kind of row it is; null drops it. */
function episodeFacts(row: Fields, ask: SubdlAsk): RowFacts | null {
  const season = count(row.season);
  if (season > 0 && season !== ask.season) return null;
  const from = count(row.episode_from);
  const end = count(row.episode_end);
  const range = from > 0 && end > 0 && from !== end;
  if (range) {
    const low = Math.min(from, end);
    const high = Math.max(from, end);
    if (ask.episode! < low || ask.episode! > high) return null;
    return { pack: true, single: false };
  }
  if (row.full_season === true) return { pack: true, single: false };
  // A row for one episode: another episode's is dropped.
  const one = from > 0 ? from : count(row.episode);
  if (one > 0 && one !== ask.episode) return null;
  return { pack: false, single: one === ask.episode };
}

interface UnpackEntry {
  name: string;
  path: string;
  fileId: string;
  release: string;
  episode: number;
}

function unpackEntries(row: Fields): UnpackEntry[] {
  if (!Array.isArray(row.unpack_files)) return [];
  const out: UnpackEntry[] = [];
  for (const item of row.unpack_files) {
    if (!isObject(item)) continue;
    const name = text(item.name);
    const path = text(item.url);
    const found = FILE_PATH.exec(path);
    if (!found || !SUBTITLE_NAME.test(name)) continue;
    const own = count(item.file_n_id);
    out.push({
      name,
      path,
      fileId: own > 0 ? String(own) : found[1]!,
      release: text(item.release_name).trim(),
      episode: count(item.episode),
    });
  }
  return out;
}

/** How surely an unpacked file is for the episode asked: 4 best; 0 drops it. */
function episodeRank(entry: UnpackEntry, ask: SubdlAsk): number {
  const named = releaseFeatures(baseName(entry.name));
  let name: 'says' | 'other' | 'nothing' = 'nothing';
  if (named.episodes) {
    const sameSeason = named.season === undefined || named.season === ask.season;
    name = sameSeason && named.episodes.indexOf(ask.episode!) !== -1 ? 'says' : 'other';
  } else if (named.season !== undefined && named.season !== ask.season) {
    name = 'other';
  }
  const server = entry.episode === 0 ? 'nothing' : entry.episode === ask.episode ? 'says' : 'other';
  // A name for another episode is never used, whatever the server says; nor a contradiction.
  if (name === 'other' || server === 'other') return 0;
  if (name === 'says' && server === 'says') return 4;
  if (name === 'says') return 3;
  if (server === 'says') return 2;
  return 0;
}

/** The files in SubDL's answer that BannerTV can use, in SubDL's order. */
export function parseSubdlFiles(body: unknown, ask: SubdlAsk): SubdlFile[] {
  if (!isObject(body) || !Array.isArray(body.subtitles)) return [];
  const forEpisode = ask.episode !== undefined && ask.season !== undefined;
  const files: SubdlFile[] = [];
  for (const row of body.subtitles) {
    try {
      if (!isObject(row)) continue;
      const path = rowPath(row.url);
      const stem = path ? STEM.exec(path) : null;
      if (!path || !stem) continue;
      const lang = languageOfSubdl(text(row.language));
      if (lang === undefined) continue;
      if (isJunk(row)) continue;
      const facts = forEpisode ? episodeFacts(row, ask) : { pack: false, single: false };
      if (!facts) continue;
      const releases = cleanReleases(row.releases);
      const label =
        text(row.release_name).trim() ||
        text(row.name)
          .trim()
          .replace(/\.zip$/i, '');
      const fps = fpsOf(row.fps);
      const base = {
        lang,
        releases,
        ...(fps !== undefined && { fps }),
      };
      const entries = SUBDL_PREFER_UNPACK ? unpackEntries(row) : [];
      if (entries.length > 0) {
        if (!forEpisode) {
          for (const entry of entries.slice(0, FILM_FILES_PER_ROW)) {
            files.push({
              ...base,
              id: `${stem[1]}-${entry.fileId}`,
              url: SUBDL_DOWNLOADS + entry.path,
              label: entry.release || stripExtension(baseName(entry.name)),
            });
          }
          continue;
        }
        let best: UnpackEntry | undefined;
        let bestRank = 0;
        for (const entry of entries) {
          const rank = episodeRank(entry, ask);
          if (rank > bestRank) {
            best = entry;
            bestRank = rank;
          }
        }
        // A pack with no file for the episode lists nothing.
        if (!best) continue;
        files.push({
          ...base,
          id: `${stem[1]}-${best.fileId}`,
          url: SUBDL_DOWNLOADS + best.path,
          label: best.release || stripExtension(baseName(best.name)),
          season: ask.season!,
          episode: ask.episode!,
        });
        continue;
      }
      files.push({
        ...base,
        id: stem[1]!,
        url:
          SUBDL_DOWNLOADS +
          path +
          (forEpisode && facts.pack ? `#s${ask.season}e${ask.episode}` : ''),
        ...(label !== '' && { label }),
        ...(forEpisode && { season: ask.season! }),
        ...(forEpisode && facts.single && { episode: ask.episode! }),
      });
    } catch {
      // A row this build cannot read is left out.
    }
  }
  const seen = new Set<string>();
  const unique = files.filter((file) => {
    if (seen.has(file.url)) return false;
    seen.add(file.url);
    return true;
  });
  return unique.slice(0, SUBDL_MAX_FILES);
}
