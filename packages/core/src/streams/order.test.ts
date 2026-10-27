import { parseStream } from '@bannertv/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { assessStream } from './assess';
import { orderStreams, playableCandidates, qualityChoices } from './order';
import type { StreamEntry, StreamFacts, StreamOrder, TvCapabilities } from './types';

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
}

/** An entry labelled by its stream name, assessed for the TV it will be ordered for. */
function entry(label: string, spec: Spec, tv: TvCapabilities): StreamEntry {
  const stream = parseStream({ ...RAW[spec.source ?? 'url'], name: label })!;
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
