import {
  asRecord,
  type JsonRecord,
  readBoolean,
  readHttpUrl,
  readList,
  readNumber,
  readPlainText,
  readString,
  readStringList,
} from './lenient';
import { ProtocolError } from './manifest';
import { readCacheHints } from './meta';
import { parseSubtitle } from './subtitles';
import type { ProxyHeaders, Stream, StreamResponse, StreamSource, Subtitle } from './types';

const INFO_HASH = /^[0-9a-f]{40}$/i;

function readSource(record: JsonRecord): StreamSource | undefined {
  const url = readHttpUrl(record.url);
  if (url !== undefined) return { kind: 'url', url };
  const ytId = readString(record.ytId);
  if (ytId !== undefined) return { kind: 'youtube', ytId };
  const infoHash = readString(record.infoHash);
  if (infoHash !== undefined && INFO_HASH.test(infoHash)) {
    const source: StreamSource = {
      kind: 'torrent',
      infoHash: infoHash.toLowerCase(),
      // `sources` lists trackers and DHT nodes, e.g. "tracker:udp://…" or "dht:…".
      trackers: readStringList(record.sources),
    };
    const fileIdx = readNumber(record.fileIdx);
    if (fileIdx !== undefined && fileIdx >= 0) source.fileIdx = Math.floor(fileIdx);
    return source;
  }
  const externalUrl = readHttpUrl(record.externalUrl);
  if (externalUrl !== undefined) return { kind: 'external', url: externalUrl };
  return undefined;
}

function readHeaders(value: unknown): Record<string, string> {
  const headers: Record<string, string> = {};
  const record = asRecord(value);
  if (!record) return headers;
  for (const name of Object.keys(record)) {
    const text = readString(record[name]);
    if (text !== undefined && name.trim() !== '') headers[name.trim()] = text;
  }
  return headers;
}

function readProxyHeaders(value: unknown): ProxyHeaders | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const headers = { request: readHeaders(record.request), response: readHeaders(record.response) };
  return Object.keys(headers.request).length > 0 || Object.keys(headers.response).length > 0
    ? headers
    : undefined;
}

/** The name and description keep their line breaks: addons put one fact per line. */
function readLines(value: unknown): string | undefined {
  const text = readString(value);
  if (text === undefined) return undefined;
  const lines = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => readPlainText(line) ?? '')
    .filter((line) => line !== '');
  return lines.length > 0 ? lines.join('\n') : undefined;
}

/**
 * Reads one stream. Returns undefined for a stream with no source BannerTV
 * knows, such as archive-only (rarUrls) or Usenet (nzbUrl) streams.
 */
export function parseStream(value: unknown): Stream | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const source = readSource(record);
  if (!source) return undefined;

  const subtitles: Subtitle[] = [];
  const seen = new Set<string>();
  for (const item of readList(record.subtitles)) {
    const subtitle = parseSubtitle(item);
    if (subtitle && !seen.has(subtitle.id)) {
      seen.add(subtitle.id);
      subtitles.push(subtitle);
    }
  }

  const hints = asRecord(record.behaviorHints) ?? {};
  const stream: Stream = {
    source,
    subtitles,
    behaviorHints: { notWebReady: readBoolean(hints.notWebReady) },
  };
  const name = readLines(record.name);
  if (name !== undefined) stream.name = name;
  const description = readLines(record.description) ?? readLines(record.title);
  if (description !== undefined) stream.description = description;

  const bingeGroup = readString(hints.bingeGroup);
  if (bingeGroup !== undefined) stream.behaviorHints.bingeGroup = bingeGroup;
  if (Array.isArray(hints.countryWhitelist)) {
    stream.behaviorHints.countryWhitelist = readStringList(hints.countryWhitelist).map((code) =>
      code.toLowerCase(),
    );
  }
  const proxyHeaders = readProxyHeaders(hints.proxyHeaders);
  if (proxyHeaders !== undefined) stream.behaviorHints.proxyHeaders = proxyHeaders;
  const filename = readString(hints.filename);
  if (filename !== undefined) stream.behaviorHints.filename = filename;
  const videoHash = readString(hints.videoHash);
  if (videoHash !== undefined) stream.behaviorHints.videoHash = videoHash;
  const videoSize = readNumber(hints.videoSize);
  if (videoSize !== undefined && videoSize >= 1)
    stream.behaviorHints.videoSize = Math.floor(videoSize);
  return stream;
}

/** `{ streams: [...] }`. Unreadable streams are dropped and counted, never the whole response. */
export function parseStreamResponse(value: unknown): StreamResponse {
  const record = asRecord(value);
  if (!record || !Array.isArray(record.streams)) {
    throw new ProtocolError('The stream response has no streams list');
  }
  const streams: Stream[] = [];
  let dropped = 0;
  for (const item of record.streams) {
    const stream = parseStream(item);
    if (stream) streams.push(stream);
    else dropped++;
  }
  return { streams, dropped, cache: readCacheHints(record) };
}
