import { asRecord, readHttpUrl, readNumber, readString } from './lenient';
import { ProtocolError } from './manifest';
import { readCacheHints } from './meta';
import type { Subtitle, SubtitlesResponse } from './types';

/** A name: trimmed, and not empty or a bare file extension (".srt", "srt"). */
function readName(value: unknown): string | undefined {
  const text = readString(value);
  return text === undefined || /^\.?(?:srt|vtt|ass|ssa|sub|smi|txt)$/i.test(text)
    ? undefined
    : text;
}

/** A whole number above 0, such as a season or an episode; OpenSubtitles sends 0 for a film. */
function readCount(value: unknown): number | undefined {
  const number = readNumber(value);
  return number !== undefined && number > 0 && number % 1 === 0 && number < 1e5
    ? number
    : undefined;
}

/**
 * Reads one subtitle. Needs an http(s) URL; a missing id falls back to the
 * URL. The name is the addon's label or title, else the file's name
 * (OpenSubtitles v3 sends `subtitleFileName` and no label); OpenSubtitles'
 * `movieReleaseName` is kept as a second name, for matching only. `m: "h"`
 * says OpenSubtitles found the file by the video's hash. Values of the wrong
 * shape are left out.
 */
export function parseSubtitle(value: unknown): Subtitle | undefined {
  const record = asRecord(value);
  const url = record && readHttpUrl(record.url);
  if (!record || url === undefined) return undefined;
  const subtitle: Subtitle = {
    id: readString(record.id) ?? url,
    url,
    lang: readString(record.lang) ?? 'und',
  };
  const label =
    readName(record.label) ?? readName(record.title) ?? readName(record.subtitleFileName);
  if (label !== undefined) subtitle.label = label;
  const releaseName = readName(record.movieReleaseName);
  if (releaseName !== undefined && releaseName !== label) subtitle.releaseName = releaseName;
  if (record.m === 'h') subtitle.hashMatch = true;
  const fpsMilli = readNumber(record.fpsMilli);
  if (fpsMilli !== undefined && fpsMilli > 0 && fpsMilli < 1e6) subtitle.fps = fpsMilli / 1000;
  const season = readCount(record.season);
  if (season !== undefined) subtitle.season = season;
  const episode = readCount(record.episode);
  if (episode !== undefined) subtitle.episode = episode;
  return subtitle;
}

/** `{ subtitles: [...] }`. Bad items are dropped and counted, never the whole response. */
export function parseSubtitlesResponse(value: unknown): SubtitlesResponse {
  const record = asRecord(value);
  if (!record || !Array.isArray(record.subtitles)) {
    throw new ProtocolError('The subtitles response has no subtitles list');
  }
  const subtitles: Subtitle[] = [];
  const seen = new Set<string>();
  let dropped = 0;
  for (const item of record.subtitles) {
    const subtitle = parseSubtitle(item);
    if (subtitle && !seen.has(subtitle.id)) {
      seen.add(subtitle.id);
      subtitles.push(subtitle);
    } else dropped++;
  }
  return { subtitles, dropped, cache: readCacheHints(record) };
}
