import { describe, expect, it } from 'vitest';
import { parseStream, parseStreamResponse } from './stream';
import { parseSubtitlesResponse } from './subtitles';

describe('parseStream', () => {
  it('reads a debrid stream with its hints, keeping one fact per line', () => {
    const stream = parseStream({
      name: '[RD+] Torrentio\n4k DV | HDR',
      title:
        'The.Movie.2023.2160p.WEB-DL.DV.HDR.DDP5.1.Atmos.H.265\n👤 52 💾 18.2 GB ⚙️ ThePirateBay',
      url: 'https://torrentio.strem.fun/realdebrid/KEY/abc/null/0/The.Movie.mkv',
      behaviorHints: {
        bingeGroup: 'torrentio|4k|DV|HDR',
        filename: 'The.Movie.2023.2160p.mkv',
        videoSize: '19541815296',
        countryWhitelist: ['GBR', 'usa'],
        notWebReady: true,
      },
    });
    expect(stream).toEqual({
      source: {
        kind: 'url',
        url: 'https://torrentio.strem.fun/realdebrid/KEY/abc/null/0/The.Movie.mkv',
      },
      name: '[RD+] Torrentio\n4k DV | HDR',
      description:
        'The.Movie.2023.2160p.WEB-DL.DV.HDR.DDP5.1.Atmos.H.265\n👤 52 💾 18.2 GB ⚙️ ThePirateBay',
      subtitles: [],
      behaviorHints: {
        bingeGroup: 'torrentio|4k|DV|HDR',
        filename: 'The.Movie.2023.2160p.mkv',
        videoSize: 19541815296,
        countryWhitelist: ['gbr', 'usa'],
        notWebReady: true,
      },
    });
  });

  it('prefers description over the legacy title, and drops HTML', () => {
    expect(
      parseStream({
        url: 'https://a.example/v.mp4',
        title: 'Old',
        description: '<b>New</b>\r\nLine',
      })?.description,
    ).toBe('New\nLine');
  });

  it('picks the source like stremio-core: url, ytId, infoHash, then externalUrl', () => {
    expect(parseStream({ ytId: 'abc', externalUrl: 'https://x.example' })?.source).toEqual({
      kind: 'youtube',
      ytId: 'abc',
    });
    expect(
      parseStream({
        infoHash: 'ABCDEF0123456789ABCDEF0123456789ABCDEF01',
        fileIdx: 2,
        sources: ['tracker:udp://tracker.example:80', 'dht:abc'],
      })?.source,
    ).toEqual({
      kind: 'torrent',
      infoHash: 'abcdef0123456789abcdef0123456789abcdef01',
      fileIdx: 2,
      trackers: ['tracker:udp://tracker.example:80', 'dht:abc'],
    });
    expect(parseStream({ externalUrl: 'https://www.example.com/watch' })?.source).toEqual({
      kind: 'external',
      url: 'https://www.example.com/watch',
    });
  });

  it('drops streams it cannot play from any source', () => {
    expect(parseStream({ rarUrls: [{ url: 'https://x/a.rar' }] })).toBeUndefined();
    expect(parseStream({ url: 'javascript:alert(1)' })).toBeUndefined();
    expect(parseStream({ infoHash: 'not-a-hash' })).toBeUndefined();
    expect(parseStream('a string')).toBeUndefined();
  });

  it('keeps proxy headers only when there are some', () => {
    const withHeaders = parseStream({
      url: 'https://a.example/v.m3u8',
      behaviorHints: { proxyHeaders: { request: { Referer: 'https://a.example/', Bad: 3 } } },
    });
    expect(withHeaders?.behaviorHints.proxyHeaders).toEqual({
      request: { Referer: 'https://a.example/', Bad: '3' },
      response: {},
    });
    const empty = parseStream({
      url: 'https://a.example/v.m3u8',
      behaviorHints: { proxyHeaders: { request: {} } },
    });
    expect(empty?.behaviorHints.proxyHeaders).toBeUndefined();
  });

  it('reads subtitles that come with the stream', () => {
    const stream = parseStream({
      url: 'https://a.example/v.mp4',
      subtitles: [
        { id: '1', url: 'https://a.example/en.srt', lang: 'eng' },
        { url: 'https://a.example/fr.srt', lang: 'fre' },
        { id: '1', url: 'https://a.example/dup.srt', lang: 'eng' },
        { id: '3', url: 'ftp://a.example/x.srt', lang: 'eng' },
      ],
    });
    expect(stream?.subtitles).toEqual([
      { id: '1', url: 'https://a.example/en.srt', lang: 'eng' },
      { id: 'https://a.example/fr.srt', url: 'https://a.example/fr.srt', lang: 'fre' },
    ]);
  });
});

describe('parseStreamResponse', () => {
  it('counts the streams it drops, never failing the whole answer', () => {
    const response = parseStreamResponse({
      streams: [{ url: 'https://a.example/1.mp4' }, { nzbUrl: 'https://x' }, null],
      cacheMaxAge: 3600,
    });
    expect(response.streams).toHaveLength(1);
    expect(response.dropped).toBe(2);
    expect(response.cache).toEqual({ cacheMaxAge: 3600 });
  });

  it('refuses an answer without a streams list', () => {
    expect(() => parseStreamResponse({ error: 'nope' })).toThrow('no streams list');
  });
});

describe('parseSubtitlesResponse', () => {
  it('reads an OpenSubtitles v3 answer', () => {
    const response = parseSubtitlesResponse({
      subtitles: [
        {
          id: '8732',
          url: 'https://subs5.strem.io/en/download/file/1',
          lang: 'eng',
          SubEncoding: 'CP1252',
        },
        { id: '8733', url: 'https://subs5.strem.io/en/download/file/2' },
        { id: '8734', lang: 'fre' },
      ],
    });
    expect(response.subtitles).toEqual([
      { id: '8732', url: 'https://subs5.strem.io/en/download/file/1', lang: 'eng' },
      { id: '8733', url: 'https://subs5.strem.io/en/download/file/2', lang: 'und' },
    ]);
    expect(response.dropped).toBe(1);
  });

  it('keeps the first copy of a repeated id and counts the repeat as dropped', () => {
    const response = parseSubtitlesResponse({
      subtitles: [
        { id: '1', url: 'https://a.example/en.srt', lang: 'eng' },
        { id: '2', url: 'https://a.example/fr.srt', lang: 'fre' },
        { id: '1', url: 'https://a.example/en-again.srt', lang: 'eng' },
        { url: 'https://a.example/de.srt', lang: 'ger' },
        { id: 'https://a.example/de.srt', url: 'https://a.example/de-2.srt', lang: 'ger' },
      ],
    });
    expect(response.subtitles.map((s) => s.url)).toEqual([
      'https://a.example/en.srt',
      'https://a.example/fr.srt',
      'https://a.example/de.srt',
    ]);
    expect(response.dropped).toBe(2);
  });
});
