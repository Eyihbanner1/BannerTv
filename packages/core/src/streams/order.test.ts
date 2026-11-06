import { parseStream } from '@bannertv/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { assessStream } from './assess';
import { isLighter } from './bitrate';
import {
  closestCandidate,
  namesOnlyOthers,
  orderStreams,
  otherLanguages,
  playableCandidates,
  qualityChoices,
  streamInLanguage,
  streamTier,
} from './order';
import type {
  OrderOptions,
  QualityReference,
  StreamEntry,
  StreamFacts,
  StreamOrder,
  TvCapabilities,
} from './types';

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

/** A 4K HDR10 TV without Dolby Vision. */
const UHD_HDR: TvCapabilities = {
  webOS: 22,
  uhd: true,
  hdr10: true,
  dolbyVision: false,
  hevc: true,
  av1: true,
  dts: true,
  truehd: true,
};
const UHD_DV: TvCapabilities = { ...UHD_HDR, dolbyVision: true };
const UHD_SDR: TvCapabilities = { ...UHD_HDR, hdr10: false };
const HD: TvCapabilities = { ...UHD_HDR, uhd: false, hdr10: false };

type Source = 'url' | 'youtube' | 'external' | 'torrent' | 'proxy';

const RAW: Readonly<Record<Source, Record<string, unknown>>> = {
  url: { url: 'https://cdn.example.org/film.mkv' },
  youtube: { ytId: 'dQw4w9WgXcQ' },
  external: { externalUrl: 'https://example.org/watch' },
  torrent: { infoHash: 'e4f5d7a2f3dd6b7b1826bd77e316b6b5ba31eb72' },
  proxy: {
    url: 'https://cdn.example.org/master.m3u8',
    behaviorHints: { proxyHeaders: { request: { Referer: 'https://example.org/' } } },
  },
};

interface Spec {
  facts?: Partial<StreamFacts>;
  source?: Source;
  addonId?: string;
  addonRank?: number;
  rank?: number;
  bingeGroup?: string;
}

/** An entry labelled by its stream name, assessed for the TV it will be ordered for. */
function entry(label: string, spec: Spec, tv: TvCapabilities): StreamEntry {
  const stream = parseStream({
    ...RAW[spec.source ?? 'url'],
    name: label,
    ...(spec.bingeGroup ? { behaviorHints: { bingeGroup: spec.bingeGroup } } : {}),
  })!;
  const facts: StreamFacts = { hdr: [], audio: [], languages: [], ...spec.facts };
  return {
    stream,
    addonId: spec.addonId ?? 'addon',
    addonRank: spec.addonRank ?? 0,
    rank: spec.rank ?? 0,
    facts,
    assessment: assessStream(stream, facts, tv),
  };
}

/** Entries whose rank is their position, so the addons' own order is the input order. */
function entries(tv: TvCapabilities, specs: Array<[string, Spec?]>): StreamEntry[] {
  return specs.map(([label, spec = {}], rank) => entry(label, { rank, ...spec }, tv));
}

function labels(list: readonly StreamEntry[]): string[] {
  return list.map((item) => item.stream.name ?? '');
}

/** The Quality menu closest to what plays now: resolution, stream name and the other languages named. */
function closest(
  list: readonly StreamEntry[],
  reference: QualityReference,
  options?: OrderOptions,
): Array<[string | undefined, string, string[] | undefined]> {
  return qualityChoices(list, reference, options).map((choice) => [
    choice.resolution,
    choice.entry.stream.name ?? '',
    choice.otherLanguages,
  ]);
}

const ORDERS: StreamOrder[] = ['quality', 'fast', 'addon'];

const stableSort = Array.prototype.sort;

/**
 * Chromium 68 sorts arrays of more than 10 items unstably. Node sorts stably,
 * so this stand-in turns ties around to show code that leans on stability.
 */
function sortUnstably() {
  Array.prototype.sort = function <T>(this: T[], compare?: (a: T, b: T) => number): T[] {
    const reversed = this.slice().reverse();
    stableSort.call(reversed, compare);
    reversed.forEach((item, index) => {
      this[index] = item;
    });
    return this;
  };
}

afterEach(() => {
  Array.prototype.sort = stableSort;
});

describe('orderStreams, in every order', () => {
  const list = entries(UHD_HDR, [
    ['torrent', { source: 'torrent', facts: { resolution: '2160p', cached: true } }],
    ['proxy', { source: 'proxy' }],
    ['external', { source: 'external' }],
    ['youtube', { source: 'youtube' }],
    ['uncached', { facts: { resolution: '2160p', cached: false } }],
    ['plays', { facts: { resolution: '480p' } }],
  ]);

  for (const order of ORDERS) {
    it(`puts what plays first, severe warnings below, other apps next, the rest last (${order})`, () => {
      expect(labels(orderStreams(list, order, UHD_HDR))).toEqual([
        'plays',
        'uncached',
        'external',
        'youtube',
        'torrent',
        'proxy',
      ]);
    });

    it(`is stable when the sort is not, as on Chromium 68 (${order})`, () => {
      sortUnstably();
      const same = entries(
        UHD_HDR,
        Array.from({ length: 30 }, (_, i): [string, Spec] => [
          `s${i}`,
          { facts: { resolution: '1080p', cached: true }, rank: 0 },
        ]),
      );
      expect(labels(orderStreams(same, order, UHD_HDR))).toEqual(labels(same));
    });
  }

  it('leaves the list it was given alone', () => {
    const copy = list.slice();
    orderStreams(list, 'quality', UHD_HDR);
    expect(list).toEqual(copy);
  });
});

describe("orderStreams 'quality'", () => {
  it('puts the highest resolution first, unknown last', () => {
    const list = entries(UHD_HDR, [
      ['720p', { facts: { resolution: '720p' } }],
      ['unknown', {}],
      ['2160p', { facts: { resolution: '2160p' } }],
      ['1080p', { facts: { resolution: '1080p' } }],
    ]);
    expect(labels(orderStreams(list, 'quality', UHD_HDR))).toEqual([
      '2160p',
      '1080p',
      '720p',
      'unknown',
    ]);
  });

  it('counts anything above 1080p as 1080p on an HD TV', () => {
    const specs: Array<[string, Spec]> = [
      ['1440p web', { facts: { resolution: '1440p', releaseSource: 'WEB-DL' } }],
      ['1080p bluray', { facts: { resolution: '1080p', releaseSource: 'BluRay' } }],
    ];
    expect(labels(orderStreams(entries(UHD_HDR, specs), 'quality', UHD_HDR))).toEqual([
      '1440p web',
      '1080p bluray',
    ]);
    expect(labels(orderStreams(entries(HD, specs), 'quality', HD))).toEqual([
      '1080p bluray',
      '1440p web',
    ]);
    // 4K on an HD TV usually shows nothing, so it sinks altogether.
    const fourK = entries(HD, [
      ['2160p', { facts: { resolution: '2160p' } }],
      ['480p', { facts: { resolution: '480p' } }],
    ]);
    expect(labels(orderStreams(fourK, 'quality', HD))).toEqual(['480p', '2160p']);
  });

  it('puts cached links before unknown ones, and uncached ones last', () => {
    const list = entries(UHD_HDR, [
      ['uncached', { facts: { resolution: '1080p', cached: false } }],
      ['unknown', { facts: { resolution: '1080p' } }],
      ['cached', { facts: { resolution: '1080p', cached: true } }],
    ]);
    expect(labels(orderStreams(list, 'quality', UHD_HDR))).toEqual([
      'cached',
      'unknown',
      'uncached',
    ]);
  });

  it('prefers HDR on an HDR TV, and Dolby Vision only on a Dolby Vision TV', () => {
    const specs: Array<[string, Spec]> = [
      ['sdr', { facts: { resolution: '2160p' } }],
      ['hdr10', { facts: { resolution: '2160p', hdr: ['HDR10'] } }],
      ['dv', { facts: { resolution: '2160p', hdr: ['DV', 'HDR10'] } }],
    ];
    expect(labels(orderStreams(entries(UHD_DV, specs), 'quality', UHD_DV))).toEqual([
      'dv',
      'hdr10',
      'sdr',
    ]);
    expect(labels(orderStreams(entries(UHD_HDR, specs), 'quality', UHD_HDR))).toEqual([
      'hdr10',
      'dv',
      'sdr',
    ]);
    expect(labels(orderStreams(entries(UHD_SDR, specs), 'quality', UHD_SDR))).toEqual([
      'sdr',
      'hdr10',
      'dv',
    ]);
    expect(labels(orderStreams(entries(UNKNOWN, specs), 'quality', UNKNOWN))).toEqual([
      'sdr',
      'hdr10',
      'dv',
    ]);
  });

  it('ranks release sources, cinema recordings below every other release', () => {
    const list = entries(UHD_HDR, [
      ['cam 1080p', { facts: { resolution: '1080p', releaseSource: 'CAM' } }],
      ['ts 1080p', { facts: { resolution: '1080p', releaseSource: 'TS' } }],
      ['dvd', { facts: { resolution: '1080p', releaseSource: 'DVD' } }],
      ['unknown', { facts: { resolution: '1080p' } }],
      ['hdtv', { facts: { resolution: '1080p', releaseSource: 'HDTV' } }],
      ['webrip', { facts: { resolution: '1080p', releaseSource: 'WEBRip' } }],
      ['web-dl', { facts: { resolution: '1080p', releaseSource: 'WEB-DL' } }],
      ['bluray', { facts: { resolution: '1080p', releaseSource: 'BluRay' } }],
      ['remux', { facts: { resolution: '1080p', releaseSource: 'REMUX' } }],
      ['bluray 720p', { facts: { resolution: '720p', releaseSource: 'BluRay' } }],
    ]);
    expect(labels(orderStreams(list, 'quality', UHD_HDR))).toEqual([
      'remux',
      'bluray',
      'web-dl',
      'webrip',
      'hdtv',
      'unknown',
      'dvd',
      'bluray 720p',
      'ts 1080p',
      'cam 1080p',
    ]);
  });

  it('breaks ties by how well each addon has played, then seeders, then addon order', () => {
    const list = entries(UHD_HDR, [
      ['flaky', { addonId: 'flaky', facts: { resolution: '1080p' } }],
      ['unscored', { addonId: 'new', facts: { resolution: '1080p' } }],
      ['reliable', { addonId: 'reliable', facts: { resolution: '1080p' } }],
      ['broken score', { addonId: 'nan', facts: { resolution: '1080p' } }],
    ]);
    const scores: Record<string, number> = { flaky: 0.2, reliable: 0.9, nan: NaN };
    const addonScore = (id: string) => scores[id] ?? 0.5;
    expect(labels(orderStreams(list, 'quality', UHD_HDR, { addonScore }))).toEqual([
      'reliable',
      'unscored',
      'broken score',
      'flaky',
    ]);
    // Without scores every addon counts the same.
    expect(labels(orderStreams(list, 'quality', UHD_HDR))).toEqual(labels(list));

    const seeded = entries(UHD_HDR, [
      ['none', { facts: { resolution: '1080p' } }],
      ['five', { facts: { resolution: '1080p', seeders: 5 } }],
      ['later addon', { addonRank: 1, rank: 0, facts: { resolution: '1080p', seeders: 50 } }],
      ['fifty', { addonRank: 0, rank: 9, facts: { resolution: '1080p', seeders: 50 } }],
      ['zero', { facts: { resolution: '1080p', seeders: 0 } }],
    ]);
    expect(labels(orderStreams(seeded, 'quality', UHD_HDR))).toEqual([
      'fifty',
      'later addon',
      'five',
      'zero',
      'none',
    ]);
  });
});

describe("orderStreams 'fast'", () => {
  it('puts cached links first, whatever their resolution', () => {
    const list = entries(UHD_HDR, [
      ['unknown 1080p', { facts: { resolution: '1080p' } }],
      ['cached 2160p', { facts: { resolution: '2160p', cached: true } }],
    ]);
    expect(labels(orderStreams(list, 'fast', UHD_HDR))).toEqual(['cached 2160p', 'unknown 1080p']);
  });

  it('prefers 1080p, then 720p, then 4K, then the rest', () => {
    const list = entries(UHD_HDR, [
      ['480p', { facts: { resolution: '480p' } }],
      ['2160p', { facts: { resolution: '2160p' } }],
      ['unknown', {}],
      ['720p', { facts: { resolution: '720p' } }],
      ['1440p', { facts: { resolution: '1440p' } }],
      ['1080p', { facts: { resolution: '1080p' } }],
    ]);
    expect(labels(orderStreams(list, 'fast', UHD_HDR))).toEqual([
      '1080p',
      '720p',
      '2160p',
      '480p',
      'unknown',
      '1440p',
    ]);
  });

  it('prefers smaller files, unknown sizes after known ones, then addon score and order', () => {
    const GB = 1024 * 1024 * 1024;
    const list = entries(UHD_HDR, [
      ['unknown size', { facts: { resolution: '1080p' } }],
      ['8 GB', { facts: { resolution: '1080p', sizeBytes: 8 * GB } }],
      ['2 GB second addon', { addonRank: 1, facts: { resolution: '1080p', sizeBytes: 2 * GB } }],
      [
        '2 GB trusted',
        { addonId: 'good', addonRank: 2, facts: { resolution: '1080p', sizeBytes: 2 * GB } },
      ],
      ['2 GB first addon', { addonRank: 0, facts: { resolution: '1080p', sizeBytes: 2 * GB } }],
    ]);
    const ordered = orderStreams(list, 'fast', UHD_HDR, {
      addonScore: (id) => (id === 'good' ? 0.8 : 0.5),
    });
    expect(labels(ordered)).toEqual([
      '2 GB trusted',
      '2 GB first addon',
      '2 GB second addon',
      '8 GB',
      'unknown size',
    ]);
  });
});

describe("orderStreams 'addon'", () => {
  it('keeps the addons’ priority and their own order, below the tiers', () => {
    const list = [
      entry('second addon', { addonRank: 1, rank: 0 }, UHD_HDR),
      entry('first addon, second', { addonRank: 0, rank: 1 }, UHD_HDR),
      entry(
        'first addon, first',
        { addonRank: 0, rank: 0, facts: { resolution: '480p' } },
        UHD_HDR,
      ),
      entry('torrent', { addonRank: 0, rank: 2, source: 'torrent' }, UHD_HDR),
      entry('uncached', { addonRank: 0, rank: 3, facts: { cached: false } }, UHD_HDR),
    ];
    expect(labels(orderStreams(list, 'addon', UHD_HDR))).toEqual([
      'first addon, first',
      'first addon, second',
      'second addon',
      'uncached',
      'torrent',
    ]);
  });
});

describe('playableCandidates', () => {
  const tv = UHD_HDR;
  const list = entries(tv, [
    ['torrent', { source: 'torrent', facts: { resolution: '2160p' } }],
    ['youtube', { source: 'youtube' }],
    ['proxy', { source: 'proxy', facts: { resolution: '1080p' } }],
    ['severe cam', { facts: { resolution: '1080p', cached: false, releaseSource: 'CAM' } }],
    ['cam', { facts: { resolution: '1080p', cached: true, releaseSource: 'CAM', sizeBytes: 1 } }],
    ['uncached', { facts: { resolution: '1080p', cached: false } }],
    ['720p', { facts: { resolution: '720p', cached: true } }],
    ['1080p', { facts: { resolution: '1080p', cached: true } }],
  ]);

  it('offers only what BannerTV plays, cinema recordings and then severe warnings last', () => {
    expect(labels(playableCandidates(list, 'quality', tv))).toEqual([
      '1080p',
      '720p',
      'cam',
      'uncached',
      'severe cam',
    ]);
    // 'fast' alone would put the small cached recording first.
    expect(labels(orderStreams(list, 'fast', tv))[0]).toBe('cam');
    expect(labels(playableCandidates(list, 'fast', tv))).toEqual([
      '1080p',
      '720p',
      'cam',
      'uncached',
      'severe cam',
    ]);
  });

  it('keeps severe streams as a last resort when nothing else plays', () => {
    const onlySevere = entries(HD, [
      ['torrent', { source: 'torrent' }],
      ['4k', { facts: { resolution: '2160p' } }],
    ]);
    expect(labels(playableCandidates(onlySevere, 'quality', HD))).toEqual(['4k']);
  });
});

describe('qualityChoices', () => {
  it('offers the first candidate at each resolution, highest first, unknown last', () => {
    const list = entries(UHD_HDR, [
      ['1080p a', { facts: { resolution: '1080p' } }],
      ['unknown', {}],
      ['2160p', { facts: { resolution: '2160p' } }],
      ['1080p b', { facts: { resolution: '1080p' } }],
      ['720p', { facts: { resolution: '720p' } }],
    ]);
    expect(
      qualityChoices(list).map((choice) => [choice.resolution, choice.entry.stream.name]),
    ).toEqual([
      ['2160p', '2160p'],
      ['1080p', '1080p a'],
      ['720p', '720p'],
      [undefined, 'unknown'],
    ]);
  });

  it('leaves out a resolution only streams with a severe warning offer', () => {
    const candidates = playableCandidates(
      entries(HD, [
        ['4k', { facts: { resolution: '2160p' } }],
        ['1080p', { facts: { resolution: '1080p' } }],
        ['720p uncached', { facts: { resolution: '720p', cached: false } }],
      ]),
      'quality',
      HD,
    );
    expect(qualityChoices(candidates).map((choice) => choice.resolution)).toEqual(['1080p']);
  });

  it('prefers a stream without a severe warning at the same resolution', () => {
    const list = entries(UHD_HDR, [
      ['uncached', { facts: { resolution: '1080p', cached: false } }],
      ['cached', { facts: { resolution: '1080p', cached: true } }],
    ]);
    expect(qualityChoices(list).map((choice) => choice.entry.stream.name)).toEqual(['cached']);
  });

  it('keeps every resolution when every stream has a severe warning', () => {
    const list = entries(HD, [
      ['4k', { facts: { resolution: '2160p' } }],
      ['1080p uncached', { facts: { resolution: '1080p', cached: false } }],
    ]);
    expect(qualityChoices(list).map((choice) => choice.resolution)).toEqual(['2160p', '1080p']);
  });

  it('offers nothing for no candidates', () => {
    expect(qualityChoices([])).toEqual([]);
  });
});

describe('streams too heavy for the connection', () => {
  const GB = 1e9;
  /** 2 h 35 min. */
  const RUNTIME = 9300;
  const LIMIT = { maxBitrate: 40e6, runtimeSeconds: RUNTIME };

  // The 84 GB disc remux from the TV run averages about 72 Mbit/s.
  const remux: [string, Spec] = [
    'remux 4K',
    {
      facts: {
        resolution: '2160p',
        hdr: ['DV', 'HDR10'],
        releaseSource: 'REMUX',
        cached: true,
        sizeBytes: 84 * GB,
      },
    },
  ];
  const web: [string, Spec] = [
    'web 4K',
    { facts: { resolution: '2160p', hdr: ['HDR10'], releaseSource: 'WEB-DL', sizeBytes: 20 * GB } },
  ];
  const bluray: [string, Spec] = [
    '1080p',
    { facts: { resolution: '1080p', releaseSource: 'BluRay', cached: true, sizeBytes: 12 * GB } },
  ];

  it('puts the least heavy first when every stream is too heavy', () => {
    // With the limit at 8 Mbit/s, all three are over it: the remux about 9x,
    // the web 4K about 2x, the 1080p just over.
    const low = { maxBitrate: 8e6, runtimeSeconds: RUNTIME };
    const list = entries(UHD_HDR, [remux, web, bluray]);
    expect(labels(orderStreams(list, 'quality', UHD_HDR, low))).toEqual([
      '1080p',
      'web 4K',
      'remux 4K',
    ]);
    expect(labels(orderStreams(list, 'fast', UHD_HDR, low))).toEqual([
      '1080p',
      'web 4K',
      'remux 4K',
    ]);
  });

  it("ranks them below every stream within the limit in 'quality'", () => {
    const list = entries(UHD_HDR, [
      remux,
      bluray,
      ['720p', { facts: { resolution: '720p', sizeBytes: 3 * GB } }],
      ['unknown size 4K', { facts: { resolution: '2160p' } }],
      // 40 Mbit/s exactly is still within it.
      ['at the limit 4K', { facts: { resolution: '2160p', sizeBytes: 46.5 * GB } }],
    ]);
    expect(labels(orderStreams(list, 'quality', UHD_HDR, LIMIT))).toEqual([
      'unknown size 4K',
      'at the limit 4K',
      '1080p',
      '720p',
      'remux 4K',
    ]);
  });

  it('keeps them above cinema recordings and streams with a severe warning', () => {
    const list = entries(UHD_HDR, [
      ['uncached 1080p', { facts: { resolution: '1080p', cached: false, sizeBytes: 2 * GB } }],
      ['cam 1080p', { facts: { resolution: '1080p', releaseSource: 'CAM', sizeBytes: 2 * GB } }],
      remux,
      bluray,
    ]);
    expect(labels(orderStreams(list, 'quality', UHD_HDR, LIMIT))).toEqual([
      '1080p',
      'remux 4K',
      'cam 1080p',
      'uncached 1080p',
    ]);
  });

  it("ranks them below every stream within the limit in 'fast', cached or not", () => {
    const list = entries(UHD_HDR, [
      ['heavy cached 1080p', { facts: { resolution: '1080p', cached: true, sizeBytes: 50 * GB } }],
      web,
    ]);
    expect(labels(orderStreams(list, 'fast', UHD_HDR))).toEqual(['heavy cached 1080p', 'web 4K']);
    expect(labels(orderStreams(list, 'fast', UHD_HDR, LIMIT))).toEqual([
      'web 4K',
      'heavy cached 1080p',
    ]);
  });

  it("leaves the addons' own order alone", () => {
    const list = entries(UHD_HDR, [remux, web, bluray]);
    expect(labels(orderStreams(list, 'addon', UHD_HDR, LIMIT))).toEqual(labels(list));
  });

  it('sets no limit when there is no limit or no running time to estimate with', () => {
    const list = entries(UHD_HDR, [bluray, remux]);
    expect(labels(orderStreams(list, 'quality', UHD_HDR))).toEqual(['remux 4K', '1080p']);
    expect(labels(orderStreams(list, 'quality', UHD_HDR, { runtimeSeconds: RUNTIME }))).toEqual([
      'remux 4K',
      '1080p',
    ]);
    expect(labels(orderStreams(list, 'quality', UHD_HDR, { maxBitrate: 40e6 }))).toEqual([
      'remux 4K',
      '1080p',
    ]);
    expect(labels(orderStreams(list, 'quality', UHD_HDR, LIMIT))).toEqual(['1080p', 'remux 4K']);
  });

  it('offers the light 4K in the Quality menu when there is a heavy one too', () => {
    const list = entries(UHD_HDR, [remux, web, bluray]);
    const choose = (options: typeof LIMIT | undefined) =>
      qualityChoices(playableCandidates(list, 'quality', UHD_HDR, options)).map((choice) => [
        choice.resolution,
        choice.entry.stream.name,
      ]);
    expect(choose(LIMIT)).toEqual([
      ['2160p', 'web 4K'],
      ['1080p', '1080p'],
    ]);
    // Without a limit the remux is the better 4K picture.
    expect(choose(undefined)).toEqual([
      ['2160p', 'remux 4K'],
      ['1080p', '1080p'],
    ]);
  });

  it('still offers 4K in the Quality menu when only a heavy one exists', () => {
    const candidates = playableCandidates(
      entries(UHD_HDR, [remux, bluray]),
      'quality',
      UHD_HDR,
      LIMIT,
    );
    // Auto-play starts with the stream that keeps up.
    expect(labels(candidates)).toEqual(['1080p', 'remux 4K']);
    expect(
      qualityChoices(candidates).map((choice) => [choice.resolution, choice.entry.stream.name]),
    ).toEqual([
      ['2160p', 'remux 4K'],
      ['1080p', '1080p'],
    ]);
  });
});

describe('streamTier', () => {
  const list = entries(UHD_HDR, [
    ['torrent', { source: 'torrent', facts: { resolution: '2160p', cached: true } }],
    ['proxy', { source: 'proxy' }],
    ['external', { source: 'external' }],
    ['youtube', { source: 'youtube' }],
    ['uncached', { facts: { resolution: '2160p', cached: false } }],
    ['plays', { facts: { resolution: '480p' } }],
  ]);

  it('gives what plays, then severe warnings, then other apps, then what cannot play', () => {
    expect(list.map((item) => [item.stream.name, streamTier(item)])).toEqual([
      ['torrent', 3],
      ['proxy', 3],
      ['external', 2],
      ['youtube', 2],
      ['uncached', 1],
      ['plays', 0],
    ]);
  });

  for (const order of ORDERS) {
    it(`is the first thing every order goes by (${order})`, () => {
      const tiers = orderStreams(list, order, UHD_HDR).map(streamTier);
      expect(tiers).toEqual([0, 1, 2, 2, 3, 3]);
    });
  }
});

describe('qualityChoices, closest to what plays now', () => {
  const GB = 1e9;
  const MB = 1024 * 1024;
  /** A 45-minute episode. */
  const LENGTH = 2700;

  it('prefers the language playing now over a better-ranked stream in another language', () => {
    const list = entries(UHD_HDR, [
      ['1080p english', { facts: { resolution: '1080p', cached: true } }],
      ['720p spanish', { facts: { resolution: '720p', cached: true, languages: ['es'] } }],
      ['720p plain', { facts: { resolution: '720p' } }],
    ]);
    expect(closest(list, { entry: list[0]! })).toEqual([
      ['1080p', '1080p english', undefined],
      ['720p', '720p plain', undefined],
    ]);
    // Without what plays now, the first candidate, as before.
    expect(labels(qualityChoices(list).map((choice) => choice.entry))).toEqual([
      '1080p english',
      '720p spanish',
    ]);
  });

  it('follows the audio track playing, as the engine names it', () => {
    const list = entries(UHD_HDR, [
      ['1080p dual', { facts: { resolution: '1080p', languages: ['multi', 'es'] } }],
      ['720p english', { facts: { resolution: '720p', languages: ['en'] } }],
      ['720p castellano', { facts: { resolution: '720p', languages: ['es'] } }],
    ]);
    const at720 = (audioLanguage?: string) => closest(list, { entry: list[0]!, audioLanguage })[1];
    expect(at720('spa')).toEqual(['720p', '720p castellano', undefined]);
    expect(at720('es-MX')).toEqual(['720p', '720p castellano', undefined]);
    expect(at720('Spanish')).toEqual(['720p', '720p castellano', undefined]);
    expect(at720('eng')).toEqual(['720p', '720p english', undefined]);
    // An unknown track language goes by what the playing stream names.
    expect(at720('und')).toEqual(['720p', '720p castellano', undefined]);
    expect(at720('')).toEqual(['720p', '720p castellano', undefined]);
    expect(at720('Track 2')).toEqual(['720p', '720p castellano', undefined]);
    expect(at720(undefined)).toEqual(['720p', '720p castellano', undefined]);
  });

  it('counts several languages, or English named, as likely the same when nothing is named', () => {
    const list = entries(UHD_HDR, [
      ['1080p', { facts: { resolution: '1080p' } }],
      ['2160p french', { facts: { resolution: '2160p', languages: ['fr'] } }],
      ['2160p multi', { facts: { resolution: '2160p', languages: ['multi', 'fr'] } }],
      ['720p english', { facts: { resolution: '720p', languages: ['en'] } }],
    ]);
    expect(closest(list, { entry: list[0]! })).toEqual([
      ['2160p', '2160p multi', undefined],
      ['1080p', '1080p', undefined],
      ['720p', '720p english', undefined],
    ]);
  });

  it('takes a stream that names no language before one that names another, while a dub plays', () => {
    const list = entries(UHD_HDR, [
      ['1080p italiano', { facts: { resolution: '1080p', languages: ['it'] } }],
      ['720p spanish', { facts: { resolution: '720p', cached: true, languages: ['es'] } }],
      ['720p unnamed', { facts: { resolution: '720p' } }],
    ]);
    expect(closest(list, { entry: list[0]! })).toEqual([
      ['1080p', '1080p italiano', undefined],
      ['720p', '720p unnamed', undefined],
    ]);
  });

  it('still offers a resolution found only in another language, and says which', () => {
    const list = entries(UHD_HDR, [
      ['1080p', { facts: { resolution: '1080p' } }],
      ['720p spanish', { facts: { resolution: '720p', languages: ['es'] } }],
      ['480p italian spanish', { facts: { resolution: '480p', languages: ['it', 'es'] } }],
    ]);
    expect(closest(list, { entry: list[0]! })).toEqual([
      ['1080p', '1080p', undefined],
      ['720p', '720p spanish', ['es']],
      ['480p', '480p italian spanish', ['it', 'es']],
    ]);
    // English heard, a release that names English among others says nothing.
    const english = entries(UHD_HDR, [
      ['1080p', { facts: { resolution: '1080p' } }],
      ['720p ita eng', { facts: { resolution: '720p', languages: ['it', 'en'] } }],
    ]);
    expect(closest(english, { entry: english[0]!, audioLanguage: 'eng' })[1]).toEqual([
      '720p',
      '720p ita eng',
      undefined,
    ]);
    expect(qualityChoices(list).every((choice) => choice.otherLanguages === undefined)).toBe(true);
  });

  it('keeps severe streams and cinema recordings below a proper release in another language', () => {
    const list = entries(UHD_HDR, [
      ['1080p', { facts: { resolution: '1080p', cached: true } }],
      ['720p cam english', { facts: { resolution: '720p', releaseSource: 'CAM', cached: true } }],
      ['720p uncached english', { facts: { resolution: '720p', cached: false } }],
      ['720p spanish', { facts: { resolution: '720p', cached: true, languages: ['es'] } }],
    ]);
    expect(closest(list, { entry: list[0]! })).toEqual([
      ['1080p', '1080p', undefined],
      ['720p', '720p spanish', ['es']],
    ]);
  });

  it('leaves out samples, trailers and files far too small for the length playing', () => {
    const list = entries(UHD_HDR, [
      ['1080p', { facts: { resolution: '1080p', sizeBytes: 2 * GB } }],
      ['other 30 s clip', { facts: { sizeBytes: 12 * MB } }],
      ['720p sample', { facts: { resolution: '720p', sample: true } }],
      ['2160p 40 MB', { facts: { resolution: '2160p', sizeBytes: 40 * MB } }],
      ['480p small but real', { facts: { resolution: '480p', sizeBytes: 90 * MB } }],
    ]);
    expect(closest(list, { entry: list[0]!, lengthSeconds: LENGTH })).toEqual([
      ['1080p', '1080p', undefined],
      ['480p', '480p small but real', undefined],
    ]);
    // Without a length only the name tells: a sample still goes.
    expect(closest(list, { entry: list[0]! }).map(([, name]) => name)).toEqual([
      '2160p 40 MB',
      '1080p',
      '480p small but real',
      'other 30 s clip',
    ]);
    expect(labels(qualityChoices(list).map((choice) => choice.entry))).toEqual([
      '2160p 40 MB',
      '1080p',
      '480p small but real',
      'other 30 s clip',
    ]);
  });

  it('counts clips for no resolution and for no group, so a dimmed chip stays dimmed', () => {
    // Only a cinema recording plays here; a clean sample does not lift the bar above it.
    const list = entries(UHD_HDR, [
      ['1080p cam', { facts: { resolution: '1080p', releaseSource: 'CAM' } }],
      ['720p sample', { facts: { resolution: '720p', sample: true } }],
      ['2160p trailer', { facts: { resolution: '2160p', sizeBytes: 50 * MB } }],
    ]);
    expect(closest(list, { entry: list[0]!, lengthSeconds: LENGTH })).toEqual([
      ['1080p', '1080p cam', undefined],
    ]);
  });

  it('judges no size against an endless length, as of a live stream', () => {
    const list = entries(UHD_HDR, [
      ['1080p', { facts: { resolution: '1080p', sizeBytes: 2 * GB } }],
      ['720p', { facts: { resolution: '720p', sizeBytes: GB } }],
      ['480p', { facts: { resolution: '480p', sizeBytes: 300 * MB } }],
    ]);
    expect(closest(list, { entry: list[0]!, lengthSeconds: Infinity }).map(([r]) => r)).toEqual([
      '1080p',
      '720p',
      '480p',
    ]);
    expect(
      closestCandidate(list.slice(1), { entry: list[0]!, lengthSeconds: Infinity })?.stream.name,
    ).toBe('720p');
  });

  it('without what plays now, picks as before whatever the options say', () => {
    const list = entries(UHD_HDR, [
      ['2160p heavy', { facts: { resolution: '2160p', sizeBytes: 84 * GB } }],
      ['2160p light', { facts: { resolution: '2160p', sizeBytes: 20 * GB, cached: true } }],
      ['1080p', { facts: { resolution: '1080p' } }],
    ]);
    const options: OrderOptions = { maxBitrate: 40e6, runtimeSeconds: 9300 };
    expect(labels(qualityChoices(list, undefined, options).map((c) => c.entry))).toEqual([
      '2160p heavy',
      '1080p',
    ]);
    expect(closest(list, { entry: list[2]! }, options)[0]).toEqual([
      '2160p',
      '2160p light',
      undefined,
    ]);
  });

  it('never leaves out what plays now, whatever its size says', () => {
    // A size the addon got wrong, in MB for GB.
    const list = entries(UHD_HDR, [
      ['1080p', { facts: { resolution: '1080p', sizeBytes: 2 * MB } }],
      ['720p', { facts: { resolution: '720p', sizeBytes: GB } }],
    ]);
    expect(closest(list, { entry: list[0]!, lengthSeconds: LENGTH }).map(([r]) => r)).toEqual([
      '1080p',
      '720p',
    ]);
  });

  it('prefers the same release, then the same family of source, among streams that play as well', () => {
    const list = entries(UHD_HDR, [
      [
        '1080p web flux',
        {
          bingeGroup: 'torrentio|1080p|FLUX',
          facts: {
            resolution: '1080p',
            releaseSource: 'WEB-DL',
            releaseGroup: 'flux',
            cached: true,
          },
        },
      ],
      ['2160p bluray', { facts: { resolution: '2160p', releaseSource: 'BluRay', cached: true } }],
      [
        '2160p web other',
        {
          facts: {
            resolution: '2160p',
            releaseSource: 'WEB-DL',
            releaseGroup: 'ntb',
            cached: true,
          },
        },
      ],
      [
        '2160p web flux',
        {
          facts: {
            resolution: '2160p',
            releaseSource: 'WEB-DL',
            releaseGroup: 'flux',
            cached: true,
          },
        },
      ],
      ['720p bluray', { facts: { resolution: '720p', releaseSource: 'BluRay', cached: true } }],
      [
        '720p binge',
        {
          bingeGroup: 'torrentio|720p|FLUX',
          facts: { resolution: '720p', releaseSource: 'WEBRip', cached: true },
        },
      ],
      ['480p bluray', { facts: { resolution: '480p', releaseSource: 'BluRay', cached: true } }],
      ['480p webrip', { facts: { resolution: '480p', releaseSource: 'WEBRip', cached: true } }],
    ]);
    expect(closest(list, { entry: list[0]! })).toEqual([
      ['2160p', '2160p web flux', undefined],
      ['1080p', '1080p web flux', undefined],
      ['720p', '720p binge', undefined],
      ['480p', '480p webrip', undefined],
    ]);
  });

  it('does not take a binge group of nothing but the resolution for the same release', () => {
    const list = entries(UHD_HDR, [
      [
        '1080p web',
        { bingeGroup: '1080p', facts: { resolution: '1080p', releaseSource: 'WEB-DL' } },
      ],
      ['720p disc', { bingeGroup: '720p', facts: { resolution: '720p', releaseSource: 'BluRay' } }],
      ['720p web', { facts: { resolution: '720p', releaseSource: 'WEBRip' } }],
    ]);
    expect(closest(list, { entry: list[0]! })[1]).toEqual(['720p', '720p web', undefined]);
  });

  it('never trades playing well for closeness: light before heavy, cached before unknown', () => {
    const list = entries(UHD_HDR, [
      [
        '1080p remux grp',
        {
          facts: {
            resolution: '1080p',
            releaseSource: 'REMUX',
            releaseGroup: 'framestor',
            cached: true,
            sizeBytes: 30 * GB,
          },
        },
      ],
      [
        '2160p web',
        {
          facts: { resolution: '2160p', releaseSource: 'WEB-DL', cached: true, sizeBytes: 20 * GB },
        },
      ],
      [
        '2160p remux grp heavy',
        {
          facts: {
            resolution: '2160p',
            releaseSource: 'REMUX',
            releaseGroup: 'framestor',
            cached: true,
            sizeBytes: 84 * GB,
          },
        },
      ],
      [
        '720p bluray grp',
        { facts: { resolution: '720p', releaseSource: 'BluRay', releaseGroup: 'framestor' } },
      ],
      ['720p web cached', { facts: { resolution: '720p', releaseSource: 'WEB-DL', cached: true } }],
    ]);
    expect(closest(list, { entry: list[0]! }, { maxBitrate: 40e6, runtimeSeconds: 9300 })).toEqual([
      ['2160p', '2160p web', undefined],
      ['1080p', '1080p remux grp', undefined],
      ['720p', '720p web cached', undefined],
    ]);
    // With no limit, the same release at 4K.
    expect(closest(list, { entry: list[0]! })[0]).toEqual([
      '2160p',
      '2160p remux grp heavy',
      undefined,
    ]);
  });

  it('decides in one pass, so an unstable sort changes nothing', () => {
    sortUnstably();
    const list = entries(
      UHD_HDR,
      Array.from({ length: 30 }, (_, i): [string, Spec] => [
        `s${i}`,
        { facts: { resolution: i % 2 ? '1080p' : '720p', cached: true } },
      ]),
    );
    expect(closest(list, { entry: list[1]! }).map(([, name]) => name)).toEqual(['s1', 's0']);
  });
});

describe('otherLanguages', () => {
  const list = entries(UHD_HDR, [
    ['plain', {}],
    ['spanish', { facts: { languages: ['es'] } }],
    ['english', { facts: { languages: ['en'] } }],
    ['italian spanish', { facts: { languages: ['it', 'es'] } }],
    ['multi spanish', { facts: { languages: ['multi', 'es'] } }],
  ]);

  it('names the languages of a stream that names only others than the one heard', () => {
    const spanishTrack: QualityReference = { entry: list[0]!, audioLanguage: 'spa' };
    expect(list.map((item) => otherLanguages(item.facts, spanishTrack))).toEqual([
      undefined,
      undefined,
      ['en'],
      undefined,
      undefined,
    ]);
    const englishTrack: QualityReference = { entry: list[0]!, audioLanguage: 'en-GB' };
    expect(list.map((item) => otherLanguages(item.facts, englishTrack))).toEqual([
      undefined,
      ['es'],
      undefined,
      ['it', 'es'],
      undefined,
    ]);
  });

  it('without what plays now, names a stream that names no English', () => {
    expect(list.map((item) => otherLanguages(item.facts))).toEqual([
      undefined,
      ['es'],
      undefined,
      ['it', 'es'],
      undefined,
    ]);
  });
});

describe('closestCandidate, for a step-down after buffering', () => {
  const GB = 1e9;
  const MB = 1024 * 1024;
  const TWO_HOURS = 7200;

  /** Picks as the finder's step-down does: lighter than what plays, then closest to it. */
  function stepDown(list: readonly StreamEntry[], reference: QualityReference) {
    const lighter = list.filter((item) => isLighter(item.facts, reference.entry.facts, TWO_HOURS));
    return closestCandidate(lighter, reference)?.stream.name;
  }

  it('keeps the ranking while the language fits', () => {
    const list = entries(UHD_HDR, [
      ['2160p', { facts: { resolution: '2160p', sizeBytes: 60 * GB } }],
      ['1080p', { facts: { resolution: '1080p', sizeBytes: 10 * GB } }],
      ['720p english', { facts: { resolution: '720p', sizeBytes: 3 * GB, languages: ['en'] } }],
    ]);
    expect(stepDown(list, { entry: list[0]!, audioLanguage: 'eng' })).toBe('1080p');
    expect(stepDown(list, { entry: list[0]! })).toBe('1080p');
  });

  it('never steps down to a stream in another language, nor to a clip', () => {
    const list = entries(UHD_HDR, [
      ['2160p', { facts: { resolution: '2160p', sizeBytes: 60 * GB } }],
      ['1080p spanish', { facts: { resolution: '1080p', sizeBytes: 10 * GB, languages: ['es'] } }],
      ['1080p sample', { facts: { resolution: '1080p', sample: true } }],
      ['720p clip', { facts: { resolution: '720p', sizeBytes: 30 * MB } }],
      ['720p', { facts: { resolution: '720p', sizeBytes: 3 * GB } }],
    ]);
    expect(stepDown(list, { entry: list[0]!, lengthSeconds: TWO_HOURS })).toBe('720p');
    // With nothing else lighter, it stays where it is.
    expect(stepDown(list.slice(0, 4), { entry: list[0]!, lengthSeconds: TWO_HOURS })).toBe(
      undefined,
    );
  });

  it('takes a stream that names the language heard before one that says nothing, while a dub plays', () => {
    const list = entries(UHD_HDR, [
      [
        '2160p castellano',
        { facts: { resolution: '2160p', sizeBytes: 60 * GB, languages: ['es'] } },
      ],
      ['1080p unnamed', { facts: { resolution: '1080p', sizeBytes: 10 * GB } }],
      ['720p castellano', { facts: { resolution: '720p', sizeBytes: 3 * GB, languages: ['es'] } }],
    ]);
    expect(stepDown(list, { entry: list[0]! })).toBe('720p castellano');
    // When nothing names it, one that says nothing is still better than buffering.
    expect(stepDown(list.slice(0, 2), { entry: list[0]! })).toBe('1080p unnamed');
  });

  it('puts streams likelier to play first, as the candidates are', () => {
    const list = entries(UHD_HDR, [
      ['1080p cam', { facts: { resolution: '1080p', releaseSource: 'CAM', languages: ['en'] } }],
      ['720p', { facts: { resolution: '720p' } }],
    ]);
    expect(closestCandidate(list, { entry: list[0]!, audioLanguage: 'en' })?.stream.name).toBe(
      '720p',
    );
    expect(closestCandidate([], { entry: list[0]! })).toBeUndefined();
  });
});

describe('the first ranking, by the audio language wanted', () => {
  const dubbed = () =>
    entries(UHD_HDR, [
      ['2160p castellano', { facts: { resolution: '2160p', cached: true, languages: ['es'] } }],
      ['2160p latino', { facts: { resolution: '2160p', cached: true, languages: ['es'] } }],
      ['1080p', { facts: { resolution: '1080p', cached: true } }],
      ['1080p multi', { facts: { resolution: '1080p', languages: ['multi', 'fr'] } }],
      ['720p english', { facts: { resolution: '720p', languages: ['en'] } }],
    ]);

  it('puts dubs in other languages below every stream that has the language or says nothing', () => {
    for (const order of ['quality', 'fast'] as const) {
      expect(
        labels(playableCandidates(dubbed(), order, UHD_HDR, { audioLanguage: 'eng' })),
      ).toEqual(['1080p', '1080p multi', '720p english', '2160p castellano', '2160p latino']);
    }
  });

  it('counts nothing chosen as wanting the film’s own language, English when unsaid', () => {
    expect(labels(orderStreams(dubbed(), 'quality', UHD_HDR)).slice(0, 2)).toEqual([
      '1080p',
      '1080p multi',
    ]);
  });

  it('puts streams in a language wanted other than English first, then those that say nothing', () => {
    expect(labels(orderStreams(dubbed(), 'quality', UHD_HDR, { audioLanguage: 'es-ES' }))).toEqual([
      '2160p castellano',
      '2160p latino',
      '1080p multi',
      '1080p',
      '720p english',
    ]);
  });

  it("leaves the addons' order alone, and an unknown language changes nothing", () => {
    expect(labels(orderStreams(dubbed(), 'addon', UHD_HDR, { audioLanguage: 'eng' }))).toEqual(
      labels(dubbed()),
    );
    expect(
      labels(orderStreams(dubbed(), 'quality', UHD_HDR, { audioLanguage: 'Klingon' })),
    ).toEqual(labels(orderStreams(dubbed(), 'quality', UHD_HDR)));
  });

  it('still puts a stream that plays before a dub that may not', () => {
    const list = entries(UHD_HDR, [
      ['castellano', { facts: { resolution: '1080p', languages: ['es'] } }],
      ['torrent', { source: 'torrent', facts: { resolution: '1080p' } }],
    ]);
    expect(labels(orderStreams(list, 'quality', UHD_HDR, { audioLanguage: 'en' }))).toEqual([
      'castellano',
      'torrent',
    ]);
  });

  it('tells a dub from what the viewer wants', () => {
    expect(namesOnlyOthers({ hdr: [], audio: [], languages: ['es'] }, 'eng')).toBe(true);
    expect(namesOnlyOthers({ hdr: [], audio: [], languages: [] }, 'eng')).toBe(false);
    expect(namesOnlyOthers({ hdr: [], audio: [], languages: ['multi', 'es'] }, 'en')).toBe(false);
    expect(namesOnlyOthers({ hdr: [], audio: [], languages: ['es'] }, 'spa')).toBe(false);
  });
});

describe('streamInLanguage, for "English audio: switch stream"', () => {
  it('offers the stream in that language closest to what plays, never a clip', () => {
    const list = entries(UHD_HDR, [
      [
        '2160p castellano',
        { facts: { resolution: '2160p', languages: ['es'] }, bingeGroup: 'a|FLUX' },
      ],
      ['1080p sample', { facts: { resolution: '1080p', sample: true } }],
      ['1080p', { facts: { resolution: '1080p' } }],
      ['720p flux', { facts: { resolution: '720p' }, bingeGroup: 'a|FLUX' }],
      ['720p english', { facts: { resolution: '720p', languages: ['en'] } }],
    ]);
    const reference = { entry: list[0]!, audioLanguage: 'spa' };
    // Names English first; then, among those that say nothing, the same release.
    expect(streamInLanguage(list, reference, 'eng')?.stream.name).toBe('720p english');
    expect(streamInLanguage(list.slice(0, 4), reference, 'eng')?.stream.name).toBe('720p flux');
  });

  it('offers nothing when no other stream has the language', () => {
    const list = entries(UHD_HDR, [
      ['castellano', { facts: { resolution: '1080p', languages: ['es'] } }],
      ['italiano', { facts: { resolution: '1080p', languages: ['it'] } }],
      ['unnamed', { facts: { resolution: '720p' } }],
    ]);
    expect(streamInLanguage(list, { entry: list[0]! }, 'fr')).toBeUndefined();
    expect(streamInLanguage(list.slice(0, 1), { entry: list[0]! }, 'en')).toBeUndefined();
    expect(streamInLanguage(list, { entry: list[0]! }, 'Klingon')).toBeUndefined();
  });
});

describe('the first ranking, within the picture limits a profile set', () => {
  const list = () =>
    entries(UHD_HDR, [
      ['2160p hdr', { facts: { resolution: '2160p', hdr: ['HDR10'], cached: true } }],
      ['2160p', { facts: { resolution: '2160p', cached: true } }],
      ['1080p hdr', { facts: { resolution: '1080p', hdr: ['DV', 'HDR10'], cached: true } }],
      ['1080p', { facts: { resolution: '1080p' } }],
      ['unknown', { facts: {} }],
    ]);

  it('puts streams above the highest picture below the rest', () => {
    expect(labels(orderStreams(list(), 'quality', UHD_HDR, { maxResolution: '1080p' }))).toEqual([
      '1080p hdr',
      '1080p',
      'unknown',
      '2160p hdr',
      '2160p',
    ]);
  });

  it('puts HDR below the rest when the profile avoids it, in both orders', () => {
    expect(labels(orderStreams(list(), 'quality', UHD_HDR, { avoidHdr: true }))).toEqual([
      '2160p',
      '1080p',
      'unknown',
      '2160p hdr',
      '1080p hdr',
    ]);
    expect(
      labels(
        playableCandidates(list(), 'fast', UHD_HDR, { avoidHdr: true, maxResolution: '1080p' }),
      ),
    ).toEqual(['1080p', 'unknown', '1080p hdr', '2160p', '2160p hdr']);
  });
});
