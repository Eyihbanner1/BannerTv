import { asRecord, readHttpUrl, readString } from './lenient';
import { ProtocolError } from './manifest';
import { readCacheHints } from './meta';
import type { Subtitle, SubtitlesResponse } from './types';

/** Reads one subtitle. Needs an http(s) URL; a missing id falls back to the URL. */
export function parseSubtitle(value: unknown): Subtitle | undefined {
  const record = asRecord(value);
  const url = record && readHttpUrl(record.url);
  if (!record || url === undefined) return undefined;
  const subtitle: Subtitle = {
    id: readString(record.id) ?? url,
    url,
    lang: readString(record.lang) ?? 'und',
  };
  const label = readString(record.label) ?? readString(record.title);
  if (label !== undefined) subtitle.label = label;
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
