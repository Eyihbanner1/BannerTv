import type { Stream } from '@bannertv/protocol';
import { describe, expect, it } from 'vitest';
import { MAX_LINKS, noteRequestHeaders, requestHeadersFor } from './request-headers';

function entry(url: string, request?: Record<string, string>): Stream {
  return {
    source: { kind: 'url', url },
    behaviorHints: request ? { proxyHeaders: { request, response: {} } } : {},
  } as unknown as Stream;
}

describe('request headers by link', () => {
  it('gives the headers noted for a link, cleaned, and none for other links', () => {
    noteRequestHeaders(entry('https://a.example/live.m3u8', { Referer: 'https://a/', Range: 'x' }));
    expect(requestHeadersFor('https://a.example/live.m3u8')).toEqual({ Referer: 'https://a/' });
    expect(requestHeadersFor('https://b.example/film.mkv')).toBeUndefined();
  });

  it('forgets the headers when the link is listed again without them', () => {
    noteRequestHeaders(entry('https://c.example/live.m3u8', { Origin: 'https://c' }));
    noteRequestHeaders(entry('https://c.example/live.m3u8'));
    expect(requestHeadersFor('https://c.example/live.m3u8')).toBeUndefined();
  });

  it('keeps only the most recent links', () => {
    noteRequestHeaders(entry('https://first.example/', { Referer: 'r' }));
    for (let i = 0; i < MAX_LINKS; i++)
      noteRequestHeaders(entry(`https://n${i}/`, { Referer: 'r' }));
    expect(requestHeadersFor('https://first.example/')).toBeUndefined();
    expect(requestHeadersFor(`https://n${MAX_LINKS - 1}/`)).toEqual({ Referer: 'r' });
  });
});
