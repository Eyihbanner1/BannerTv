import { parseStream, type Stream } from '@bannertv/protocol';
import { describe, expect, it } from 'vitest';
import { assessStream, SEVERE_WARNINGS, streamRequestHeaders } from './assess';
import { describeStream } from './facts';
import fixture from './fixtures/streams.json';
import type { StreamFacts, StreamWarning, TvCapabilities } from './types';

const UNKNOWN: TvCapabilities = {
  webOS: null,
  uhd: null,
  hdr10: null,
  dolbyVision: null,
  hevc: null,
  av1: null,
  dts: null,
  truehd: null,
};

const CAPABLE: TvCapabilities = {
  webOS: 23,
  uhd: true,
  hdr10: true,
  dolbyVision: true,
  hevc: true,
  av1: true,
  dts: true,
  truehd: true,
};

const NOTHING: TvCapabilities = {
  webOS: 4,
  uhd: false,
  hdr10: false,
  dolbyVision: false,
  hevc: false,
  av1: false,
  dts: false,
  truehd: false,
};

/** The dev TV: a 2022 4K HDR set without Dolby Vision, DTS or TrueHD. */
const LG_2022: TvCapabilities = {
  ...CAPABLE,
  webOS: 22,
  dolbyVision: false,
  dts: false,
  truehd: false,
};

function facts(overrides: Partial<StreamFacts> = {}): StreamFacts {
  return { hdr: [], audio: [], languages: [], ...overrides };
}

const PLAIN = parseStream({ url: 'https://cdn.example.org/film.mkv' })!;

function warnings(f: Partial<StreamFacts>, tv: TvCapabilities): StreamWarning[] {
  return assessStream(PLAIN, facts(f), tv).warnings;
}

/** Facts that would warn about everything on a TV that can do nothing. */
const WORST = facts({
  resolution: '2160p',
  hdr: ['DV'],
  videoCodec: 'HEVC',
  audio: ['Atmos', 'TrueHD', 'DTS-HD MA'],
  mainAudio: 'TrueHD',
  container: 'avi',
  releaseSource: 'CAM',
  cached: false,
});

describe('assessStream actions', () => {
  it('plays links in BannerTV', () => {
    expect(assessStream(PLAIN, facts(), UNKNOWN).action).toEqual({ kind: 'play' });
  });

  it('cannot play links that need request headers', () => {
    const stream = parseStream({
      url: 'https://cdn.example.net/hls/master.m3u8',
      behaviorHints: { notWebReady: true, proxyHeaders: { request: { Referer: 'https://x/' } } },
    })!;
    expect(assessStream(stream, facts(), UNKNOWN).action).toEqual({
      kind: 'unavailable',
      reason: 'proxy-headers',
    });
  });

  it("plays links that need request headers on a TV whose player sends them (Android's)", () => {
    const stream = parseStream({
      url: 'https://cdn.example.net/hls/master.m3u8',
      behaviorHints: { proxyHeaders: { request: { Referer: 'https://x/' } } },
    })!;
    expect(assessStream(stream, facts(), { ...UNKNOWN, requestHeaders: true }).action).toEqual({
      kind: 'play',
    });
    expect(assessStream(stream, facts(), { ...CAPABLE, requestHeaders: false }).action).toEqual({
      kind: 'unavailable',
      reason: 'proxy-headers',
    });
  });

  it('still plays links whose proxy headers are only for the response', () => {
    const stream = parseStream({
      url: 'https://cdn.example.net/film.mp4',
      behaviorHints: { proxyHeaders: { response: { 'Content-Type': 'video/mp4' } } },
    })!;
    expect(assessStream(stream, facts(), UNKNOWN).action).toEqual({ kind: 'play' });
  });

  it('hands YouTube and web links to other apps', () => {
    const youtube = parseStream({ ytId: 'dQw4w9WgXcQ' })!;
    const external = parseStream({ externalUrl: 'https://www.netflix.com/title/80100172' })!;
    expect(assessStream(youtube, facts(), UNKNOWN).action).toEqual({ kind: 'youtube' });
    expect(assessStream(external, facts(), UNKNOWN).action).toEqual({ kind: 'external' });
  });

  it('cannot play torrents without a streaming server', () => {
    const torrent = parseStream({ infoHash: 'e4f5d7a2f3dd6b7b1826bd77e316b6b5ba31eb72' })!;
    expect(assessStream(torrent, facts(), UNKNOWN).action).toEqual({
      kind: 'unavailable',
      reason: 'torrent',
    });
  });

  it("never plays an addon's message posing as a stream", () => {
    const unavailable = parseStream({
      name: 'Sports Streams',
      description: 'Streams temporarily unavailable - try again shortly',
      url: 'https://premium.example.org/unavailable',
      // Even with headers this player can send: there is still no video.
      behaviorHints: { proxyHeaders: { request: { Referer: 'https://site.example/' } } },
    })!;
    const notice = { kind: 'unavailable', reason: 'notice' };
    expect(assessStream(unavailable, describeStream(unavailable), UNKNOWN).action).toEqual(notice);
    expect(
      assessStream(unavailable, describeStream(unavailable), { ...UNKNOWN, requestHeaders: true })
        .action,
    ).toEqual(notice);
    // The same words on a stream with a picture size are a real stream's.
    expect(
      assessStream(unavailable, facts({ resolution: '720p' }), { ...UNKNOWN, requestHeaders: true })
        .action,
    ).toEqual({ kind: 'play' });
  });
});

describe('streamRequestHeaders', () => {
  const withHeaders = (request: Record<string, unknown>) =>
    parseStream({
      url: 'https://cdn.example.net/live.m3u8',
      behaviorHints: { proxyHeaders: { request } },
    })!;

  it('gives the headers an addon asks to be sent with the link', () => {
    expect(
      streamRequestHeaders(
        withHeaders({ Referer: 'https://site.example/', 'User-Agent': 'Mozilla/5.0 (X11)' }),
      ),
    ).toEqual({ Referer: 'https://site.example/', 'User-Agent': 'Mozilla/5.0 (X11)' });
  });

  it('leaves out names HTTP does not allow, line breaks, and headers the player sets', () => {
    expect(
      streamRequestHeaders(
        withHeaders({
          Origin: 'https://site.example',
          'Bad Name': 'x',
          'X-Split': 'a\r\nInjected: yes',
          Range: 'bytes=0-',
          host: 'other.example',
        }),
      ),
    ).toEqual({ Origin: 'https://site.example' });
  });

  it('gives none when the addon asks for none, or only for response headers', () => {
    expect(streamRequestHeaders(PLAIN)).toBeUndefined();
    expect(streamRequestHeaders(withHeaders({ Range: 'bytes=0-' }))).toBeUndefined();
    const responseOnly = parseStream({
      url: 'https://cdn.example.net/film.mp4',
      behaviorHints: { proxyHeaders: { response: { 'Content-Type': 'video/mp4' } } },
    })!;
    expect(streamRequestHeaders(responseOnly)).toBeUndefined();
  });
});

describe('assessStream warnings', () => {
  it('never warns about what the TV might do when its capabilities are unknown', () => {
    // Only the warnings that do not depend on the TV remain.
    expect(assessStream(PLAIN, WORST, UNKNOWN).warnings).toEqual([
      'uncached',
      'old-container',
      'cam',
    ]);
  });

  it('gives no TV warnings to a TV that can do everything', () => {
    expect(assessStream(PLAIN, WORST, CAPABLE).warnings).toEqual([
      'uncached',
      'old-container',
      'cam',
    ]);
  });

  it('lists every warning, most serious first, on a TV that can do nothing', () => {
    expect(assessStream(PLAIN, WORST, NOTHING).warnings).toEqual([
      'uncached',
      'uhd-on-hd-tv',
      'hevc',
      'dolby-vision-only',
      'truehd',
      'dts',
      'hdr-on-sdr-tv',
      'old-container',
      'cam',
    ]);
  });

  it('warns about AV1 and HEVC only when the TV lacks the decoder', () => {
    expect(warnings({ videoCodec: 'AV1' }, { ...CAPABLE, av1: false })).toEqual(['av1']);
    expect(warnings({ videoCodec: 'AV1' }, { ...CAPABLE, hevc: false })).toEqual([]);
    expect(warnings({ videoCodec: 'HEVC' }, { ...CAPABLE, hevc: false })).toEqual(['hevc']);
    expect(warnings({ videoCodec: 'H.264' }, NOTHING)).toEqual([]);
  });

  it('warns about 4K only on an HD TV', () => {
    expect(warnings({ resolution: '2160p' }, { ...CAPABLE, uhd: false })).toEqual(['uhd-on-hd-tv']);
    expect(warnings({ resolution: '1080p' }, { ...CAPABLE, uhd: false })).toEqual([]);
  });

  it('tells Dolby Vision with an HDR10 base from Dolby Vision alone', () => {
    const noDv = { ...CAPABLE, dolbyVision: false };
    expect(warnings({ hdr: ['DV', 'HDR10'] }, noDv)).toEqual(['dolby-vision-as-hdr10']);
    expect(warnings({ hdr: ['DV', 'HDR'] }, noDv)).toEqual(['dolby-vision-as-hdr10']);
    expect(warnings({ hdr: ['DV', 'HDR10+'] }, noDv)).toEqual(['dolby-vision-as-hdr10']);
    expect(warnings({ hdr: ['DV'] }, noDv)).toEqual(['dolby-vision-only']);
    expect(warnings({ hdr: ['DV'] }, CAPABLE)).toEqual([]);
  });

  it('warns about HDR on an SDR TV, unless the TV shows the Dolby Vision itself', () => {
    expect(warnings({ hdr: ['HDR10'] }, { ...CAPABLE, hdr10: false })).toEqual(['hdr-on-sdr-tv']);
    expect(warnings({ hdr: ['DV', 'HDR10'] }, { ...CAPABLE, hdr10: false })).toEqual([]);
    expect(warnings({ hdr: [] }, { ...CAPABLE, hdr10: false })).toEqual([]);
  });

  it('warns about TrueHD when it is the track the TV plays first', () => {
    const noTrueHd = { ...CAPABLE, truehd: false };
    expect(warnings({ audio: ['Atmos', 'TrueHD'], mainAudio: 'TrueHD' }, noTrueHd)).toEqual([
      'truehd',
    ]);
    // TrueHD listed, but the release names DD+ first: that track plays.
    expect(warnings({ audio: ['TrueHD', 'DD+'], mainAudio: 'DD+' }, noTrueHd)).toEqual([]);
    // Facts built without a main track fall back to the best format listed.
    expect(warnings({ audio: ['Atmos', 'TrueHD', 'DD'] }, noTrueHd)).toEqual(['truehd']);
    expect(warnings({ audio: ['Atmos', 'DD+'] }, noTrueHd)).toEqual([]);
  });

  it('warns about any DTS on a TV without DTS', () => {
    const noDts = { ...CAPABLE, dts: false };
    for (const format of ['DTS:X', 'DTS-HD MA', 'DTS-HD', 'DTS'] as const) {
      expect(warnings({ audio: [format] }, noDts)).toEqual(['dts']);
    }
    expect(warnings({ audio: ['DTS', 'DD'], mainAudio: 'DD' }, noDts)).toEqual(['dts']);
    expect(warnings({ audio: ['DD+'] }, noDts)).toEqual([]);
  });

  it('warns about AVI, cinema recordings and uncached links on any TV', () => {
    expect(warnings({ container: 'avi' }, UNKNOWN)).toEqual(['old-container']);
    expect(warnings({ container: 'mkv' }, UNKNOWN)).toEqual([]);
    for (const source of ['CAM', 'TS', 'TC', 'SCR'] as const) {
      expect(warnings({ releaseSource: source }, UNKNOWN)).toEqual(['cam']);
    }
    expect(warnings({ releaseSource: 'DVD' }, UNKNOWN)).toEqual([]);
    expect(warnings({ cached: false }, UNKNOWN)).toEqual(['uncached']);
    expect(warnings({ cached: true }, UNKNOWN)).toEqual([]);
  });

  it('counts as severe only what usually means no picture, no sound or no start', () => {
    expect([...SEVERE_WARNINGS].sort()).toEqual(
      ['av1', 'dolby-vision-only', 'dts', 'hevc', 'truehd', 'uhd-on-hd-tv', 'uncached'].sort(),
    );
  });
});

describe('assessStream on the addon fixture', () => {
  const streams = new Map<string, Stream>();
  for (const raw of (fixture as unknown as { streams: Array<{ _fixture: { id: string } }> })
    .streams) {
    const stream = parseStream(raw);
    if (stream) streams.set(raw._fixture.id, stream);
  }
  function assess(id: string, tv: TvCapabilities) {
    const stream = streams.get(id)!;
    return assessStream(stream, describeStream(stream), tv);
  }

  it('warns the 2022 TV about what it cannot do', () => {
    expect(assess('torrentio-rd-cached-4k-dv-hdr', LG_2022)).toEqual({
      action: { kind: 'play' },
      // No sound comes before a different look.
      warnings: ['truehd', 'dolby-vision-as-hdr10'],
    });
    expect(assess('torrentio-ad-download-4k-dovi-dtsx', LG_2022)).toEqual({
      action: { kind: 'play' },
      warnings: ['uncached', 'dts', 'dolby-vision-as-hdr10'],
    });
    expect(assess('mediafusion-v2-rd-cached-4k-default', LG_2022).warnings).toEqual([
      'dolby-vision-as-hdr10',
    ]);
    expect(assess('torrentio-p2p-4k-dv-remux', LG_2022)).toEqual({
      action: { kind: 'unavailable', reason: 'torrent' },
      warnings: ['dolby-vision-only', 'truehd'],
    });
    expect(assess('torrentio-tb-cached-1080p-web-atmos', LG_2022).warnings).toEqual([]);
    expect(assess('hls-with-proxy-headers', LG_2022).action).toEqual({
      kind: 'unavailable',
      reason: 'proxy-headers',
    });
  });

  it('gives no TV warnings anywhere when nothing is known about the TV', () => {
    const tvWarnings = new Set<StreamWarning>(['uncached', 'old-container', 'cam']);
    streams.forEach((stream) => {
      const { warnings: found } = assessStream(stream, describeStream(stream), UNKNOWN);
      expect(found.filter((warning) => !tvWarnings.has(warning))).toEqual([]);
    });
  });
});
