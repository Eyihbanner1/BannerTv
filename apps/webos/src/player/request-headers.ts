import { streamRequestHeaders } from '@bannertv/core';
import type { Stream } from '@bannertv/protocol';

/** How many links' headers are kept: far more than the streams of the few videos in play. */
export const MAX_LINKS = 500;

// In memory only, never logged or saved: links can carry account keys.
const byLink = new Map<string, Record<string, string>>();

/**
 * Notes the request headers a stream's addon asks for, by its link, so the
 * player can send them when it opens that link. Streams without any are
 * forgotten, so a link listed again without headers opens without them.
 */
export function noteRequestHeaders(stream: Stream): void {
  if (stream.source.kind !== 'url') return;
  const url = stream.source.url;
  const headers = streamRequestHeaders(stream);
  byLink.delete(url);
  if (!headers) return;
  byLink.set(url, headers);
  if (byLink.size > MAX_LINKS) byLink.delete(byLink.keys().next().value!);
}

/** The headers to send with a link, as its addon asked, or undefined. */
export function requestHeadersFor(url: string): Record<string, string> | undefined {
  return byLink.get(url);
}
