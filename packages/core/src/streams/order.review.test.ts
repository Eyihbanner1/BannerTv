import { parseStream, type Stream } from '@bannertv/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { assessStream, SEVERE_WARNINGS } from './assess';
import { describeStream } from './facts';
import fixture from './fixtures/streams.json';
import { orderStreams, playableCandidates, qualityChoices } from './order';
import type {
  Resolution,
  StreamEntry,
  StreamFacts,
  StreamOrder,
  StreamWarning,
  TvCapabilities,
} from './types';

// Review from the sofa: what does pressing Play pick on an LG TV, and does
// the Quality menu make sense? Edge cases, the TV's unstable sort, partial
// capabilities and the addon fixture.

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
  webOS: 5,
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

/** A 2022 Full HD set: no 4K, no HDR. */
const FHD_2022: TvCapabilities = { ...LG_2022, uhd: false, hdr10: false };

const TVS: Readonly<Record<string, TvCapabilities>> = {
  UNKNOWN,
  CAPABLE,
  NOTHING,
  LG_2022,
  FHD_2022,
};

const GB = 1024 * 1024 * 1024;

type Source = 'url' | 'youtube' | 'external' | 'torrent' | 'proxy';

const RAW: Readonly<Record<Source, Record<string, unknown>>> = {
  url: { url: 'https://cdn.example.org/film.mkv' },
  youtube: { ytId: 'dQw4w9WgXcQ' },
  external: { externalUrl: 'https://example.org/watch' },
  torrent: { infoHash: '41798c2b59b919cb8bcd673a26e6972a5b8a2c53' },
  proxy: {
    url: 'https://cdn.example.org/master.m3u8',
    behaviorHints: { proxyHeaders: { request: { 'User-Agent': 'Addon/1.0' } } },
  },
};

interface Spec {
  facts?: Partial<StreamFacts>;
  source?: Source;
  addonId?: string;
  addonRank?: number;
  rank?: number;
}

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

function menu(list: readonly StreamEntry[]): Array<[Resolution | undefined, string]> {
  return qualityChoices(list).map((choice) => [choice.resolution, choice.entry.stream.name ?? '']);
}

function isSevere(item: StreamEntry): boolean {
  return item.assessment.warnings.some((warning) => SEVERE_WARNINGS.has(warning));
}

function isCam(item: StreamEntry): boolean {
  return item.assessment.warnings.indexOf('cam') >= 0;
}

/** Tiers every order must keep: what plays, then with a severe warning, then other apps, then the rest. */
function tierOf(item: StreamEntry): number {
  const kind = item.assessment.action.kind;
  if (kind === 'play') return isSevere(item) ? 1 : 0;
  return kind === 'unavailable' ? 3 : 2;
}

const ORDERS: StreamOrder[] = ['quality', 'fast', 'addon'];
const AUTO: Array<Exclude<StreamOrder, 'addon'>> = ['quality', 'fast'];

const stableSort = Array.prototype.sort;

/**
 * Chromium 68 sorts arrays of more than 10 items unstably. Node sorts stably,
 * so this stand-in turns ties around to show code that leans on stability.
 */
function sortReversingTies() {
  Array.prototype.sort = function <T>(this: T[], compare?: (a: T, b: T) => number): T[] {
    const reversed = this.slice().reverse();
    stableSort.call(reversed, compare);
    reversed.forEach((item, index) => {
      this[index] = item;
    });
    return this;
  };
}

/** Another stand-in: ties come out in a shuffled order, as a quicksort may leave them. */
function sortShufflingTies(seed: number) {
  Array.prototype.sort = function <T>(this: T[], compare?: (a: T, b: T) => number): T[] {
    const copy = this.slice();
    let state = seed;
    for (let i = copy.length - 1; i > 0; i--) {
      state = (state * 1103515245 + 12345) & 0x7fffffff;
      const j = state % (i + 1);
      const swap = copy[i]!;
      copy[i] = copy[j]!;
      copy[j] = swap;
    }
    stableSort.call(copy, compare);
    copy.forEach((item, index) => {
      this[index] = item;
    });
    return this;
  };
}

afterEach(() => {
  Array.prototype.sort = stableSort;
});

/** The fixture's streams as the finder builds them, all from one addon in fixture order. */
function fixtureEntries(tv: TvCapabilities): StreamEntry[] {
  const raws = (fixture as unknown as { streams: Array<Record<string, unknown>> }).streams;
  const list: StreamEntry[] = [];
  raws.forEach((raw, rank) => {
    let stream: Stream | undefined = parseStream(raw);
    // Comet sends raw spaces in its links, which parseStream rejects as it stands.
    if (!stream && typeof raw.url === 'string') {
      stream = parseStream({ ...raw, url: raw.url.replace(/\s/g, '%20') });
    }
    if (!stream) return;
    const facts = describeStream(stream);
    list.push({
      stream,
      addonId: (raw._fixture as { id: string }).id,
      addonRank: rank % 3,
      rank,
      facts,
      assessment: assessStream(stream, facts, tv),
    });
  });
  return list;
}

describe('auto-play on an LG TV, reviewed', () => {
  it('starts a cached 1080p before an uncached 4K remux the debrid service would have to fetch', () => {
    const list = entries(LG_2022, [
      ['uncached remux', { facts: { resolution: '2160p', releaseSource: 'REMUX', cached: false } }],
      ['cached 1080p', { facts: { resolution: '1080p', cached: true, audio: ['DD+'] } }],
    ]);
    for (const order of AUTO) {
      expect(labels(playableCandidates(list, order, LG_2022))).toEqual([
        'cached 1080p',
        'uncached remux',
      ]);
    }
  });

  it('starts nothing the TV would show tinted or play silent while something else plays', () => {
    const list = entries(LG_2022, [
      ['dv profile 5', { facts: { resolution: '2160p', hdr: ['DV'], cached: true } }],
      [
        'truehd first',
        {
          facts: {
            resolution: '2160p',
            hdr: ['HDR10'],
            audio: ['Atmos', 'TrueHD', 'DD'],
            mainAudio: 'TrueHD',
            cached: true,
          },
        },
      ],
      ['dts 1080p', { facts: { resolution: '1080p', audio: ['DTS-HD MA'], cached: true } }],
      ['plain 720p', { facts: { resolution: '720p', audio: ['AAC'] } }],
    ]);
    for (const order of AUTO) {
      const candidates = playableCandidates(list, order, LG_2022);
      expect(candidates[0]!.stream.name).toBe('plain 720p');
      expect(candidates.slice(1).every(isSevere)).toBe(true);
    }
  });

  it('plays the same 4K Dolby Vision profile 5 file first on a Dolby Vision TV', () => {
    const specs: Array<[string, Spec]> = [
      ['dv profile 5', { facts: { resolution: '2160p', hdr: ['DV'], cached: true } }],
      ['plain 720p', { facts: { resolution: '720p', cached: true } }],
    ];
    const dvTv = { ...LG_2022, dolbyVision: true };
    expect(labels(playableCandidates(entries(dvTv, specs), 'quality', dvTv))[0]).toBe(
      'dv profile 5',
    );
  });

  it('starts a 1080p before a 4K file on a Full HD TV, in either order', () => {
    const list = entries(FHD_2022, [
      ['4k cached small', { facts: { resolution: '2160p', cached: true, sizeBytes: 2 * GB } }],
      ['1080p', { facts: { resolution: '1080p', cached: true, sizeBytes: 9 * GB } }],
    ]);
    for (const order of AUTO) {
      expect(labels(playableCandidates(list, order, FHD_2022))).toEqual([
        '1080p',
        '4k cached small',
      ]);
    }
  });

  it('never offers torrents, links needing headers, YouTube or web links to auto-play', () => {
    const list = entries(CAPABLE, [
      ['torrent', { source: 'torrent', facts: { resolution: '2160p', cached: true } }],
      ['proxy', { source: 'proxy', facts: { resolution: '2160p', cached: true } }],
      ['youtube', { source: 'youtube', facts: { resolution: '2160p' } }],
      ['external', { source: 'external', facts: { resolution: '2160p' } }],
      ['uncached 480p', { facts: { resolution: '480p', cached: false } }],
    ]);
    for (const order of AUTO) {
      expect(labels(playableCandidates(list, order, CAPABLE))).toEqual(['uncached 480p']);
    }
    const nothingPlays = list.filter((item) => item.stream.name !== 'uncached 480p');
    for (const order of AUTO) expect(playableCandidates(nothingPlays, order, CAPABLE)).toEqual([]);
    expect(qualityChoices(playableCandidates(nothingPlays, 'quality', CAPABLE))).toEqual([]);
  });

  it('keeps a stream whose Dolby Vision support is unknown with the rest, not with the severe', () => {
    const tv = { ...LG_2022, dolbyVision: null };
    const list = entries(tv, [
      ['dv 2160p', { facts: { resolution: '2160p', hdr: ['DV'], cached: true } }],
      ['sdr 1080p', { facts: { resolution: '1080p', cached: true } }],
    ]);
    expect(list[0]!.assessment.warnings).toEqual([]);
    expect(labels(playableCandidates(list, 'quality', tv))).toEqual(['dv 2160p', 'sdr 1080p']);
  });
});

describe("'fast' and big files, reviewed", () => {
  const remux60 = {
    resolution: '2160p' as const,
    releaseSource: 'REMUX' as const,
    cached: true,
    sizeBytes: 60 * GB,
  };

  it('does not start a 60 GB remux while a smaller cached stream near 1080p exists', () => {
    const list = entries(CAPABLE, [
      ['60 GB 4k remux', { facts: remux60 }],
      [
        '30 GB 1080p remux',
        {
          facts: { resolution: '1080p', releaseSource: 'REMUX', cached: true, sizeBytes: 30 * GB },
        },
      ],
      ['3 GB 1080p web', { facts: { resolution: '1080p', cached: true, sizeBytes: 3 * GB } }],
      ['1 GB 720p web', { facts: { resolution: '720p', cached: true, sizeBytes: 1 * GB } }],
    ]);
    expect(labels(playableCandidates(list, 'fast', CAPABLE))).toEqual([
      '3 GB 1080p web',
      '30 GB 1080p remux',
      '1 GB 720p web',
      '60 GB 4k remux',
    ]);
    // 'quality' is the order that wants the remux.
    expect(labels(playableCandidates(list, 'quality', CAPABLE))[0]).toBe('60 GB 4k remux');
  });

  it('as specified, puts a cached 60 GB remux before a link whose cache state is unknown', () => {
    // A plain HTTP link says nothing about a cache, so it counts as unknown.
    // See the review notes: this is a product question, not settled here.
    const list = entries(CAPABLE, [
      ['direct 2 GB 1080p', { facts: { resolution: '1080p', sizeBytes: 2 * GB } }],
      ['60 GB 4k remux', { facts: remux60 }],
    ]);
    expect(labels(orderStreams(list, 'fast', CAPABLE))).toEqual([
      '60 GB 4k remux',
      'direct 2 GB 1080p',
    ]);
  });
});

describe('HDR on a TV without it, reviewed', () => {
  const specs: Array<[string, Spec]> = [
    [
      'hdr10 web-dl',
      { facts: { resolution: '1080p', hdr: ['HDR10'], releaseSource: 'WEB-DL', cached: true } },
    ],
    ['sdr webrip', { facts: { resolution: '1080p', releaseSource: 'WEBRip', cached: true } }],
  ];

  it('prefers SDR at the same resolution on a TV known to lack HDR', () => {
    const list = entries(FHD_2022, specs);
    expect(list[0]!.assessment.warnings).toEqual(['hdr-on-sdr-tv']);
    expect(labels(orderStreams(list, 'quality', FHD_2022))).toEqual(['sdr webrip', 'hdr10 web-dl']);
    expect(labels(playableCandidates(list, 'quality', FHD_2022))[0]).toBe('sdr webrip');
  });

  it('still prefers HDR on an HDR TV, and goes by release source when HDR support is unknown', () => {
    expect(labels(orderStreams(entries(LG_2022, specs), 'quality', LG_2022))[0]).toBe(
      'hdr10 web-dl',
    );
    expect(labels(orderStreams(entries(UNKNOWN, specs), 'quality', UNKNOWN))[0]).toBe(
      'hdr10 web-dl',
    );
  });

  it('counts Dolby Vision on a Dolby Vision TV even when its HDR10 answer is false', () => {
    const tv = { ...CAPABLE, hdr10: false };
    const list = entries(tv, [
      ['sdr', { facts: { resolution: '2160p' } }],
      ['dv', { facts: { resolution: '2160p', hdr: ['DV', 'HDR10'] } }],
    ]);
    expect(labels(orderStreams(list, 'quality', tv))).toEqual(['dv', 'sdr']);
  });

  it('does not let a higher resolution lose to SDR', () => {
    const list = entries(FHD_2022, [
      ['sdr 720p', { facts: { resolution: '720p' } }],
      ['hdr 1080p', { facts: { resolution: '1080p', hdr: ['HDR'] } }],
    ]);
    expect(labels(orderStreams(list, 'quality', FHD_2022))).toEqual(['hdr 1080p', 'sdr 720p']);
  });
});

describe('unknown capabilities, reviewed', () => {
  /** Warnings that depend on one capability each. */
  const BY_CAPABILITY: Readonly<Record<string, readonly StreamWarning[]>> = {
    uhd: ['uhd-on-hd-tv'],
    hdr10: ['hdr-on-sdr-tv'],
    dolbyVision: ['dolby-vision-as-hdr10', 'dolby-vision-only'],
    hevc: ['hevc'],
    av1: ['av1'],
    dts: ['dts'],
    truehd: ['truehd'],
  };
  const STREAM_ONLY: readonly StreamWarning[] = ['uncached', 'old-container', 'cam'];

  const base: StreamFacts = {
    resolution: '2160p',
    hdr: [],
    audio: ['Atmos', 'TrueHD', 'DTS-HD MA'],
    mainAudio: 'TrueHD',
    languages: [],
    container: 'avi',
    releaseSource: 'CAM',
    cached: false,
  };
  const variants: StreamFacts[] = [
    { ...base, hdr: ['DV'], videoCodec: 'HEVC' },
    { ...base, hdr: ['DV', 'HDR10'], videoCodec: 'AV1' },
    { ...base, hdr: ['HDR10+'], videoCodec: 'HEVC' },
    { ...base, hdr: ['HLG'], videoCodec: 'AV1', audio: ['DTS'], mainAudio: 'DTS' },
  ];
  const stream = parseStream(RAW.url)!;

  for (const capability of Object.keys(BY_CAPABILITY)) {
    it(`never warns about ${capability} while it is unknown, even when the TV lacks everything else`, () => {
      const tv = { ...NOTHING, [capability]: null } as TvCapabilities;
      for (const facts of variants) {
        const found = assessStream(stream, facts, tv).warnings;
        for (const warning of BY_CAPABILITY[capability]!) expect(found).not.toContain(warning);
      }
    });

    it(`warns about ${capability} alone when it is the only thing known to be missing`, () => {
      const tv = { ...UNKNOWN, [capability]: false } as TvCapabilities;
      const allowed = STREAM_ONLY.concat(BY_CAPABILITY[capability]!);
      const seen = new Set<StreamWarning>();
      for (const facts of variants) {
        const found = assessStream(stream, facts, tv).warnings;
        expect(found.filter((warning) => allowed.indexOf(warning) < 0)).toEqual([]);
        found.forEach((warning) => seen.add(warning));
      }
      // And the variants do give each of its warnings, so the check above is not empty.
      for (const warning of BY_CAPABILITY[capability]!) expect(seen.has(warning)).toBe(true);
    });
  }

  it('ranks streams the same with unknown capabilities as on a TV that can do everything, bar Dolby Vision and HDR', () => {
    const plain = fixtureEntries(UNKNOWN).filter((item) => item.facts.hdr.length === 0);
    for (const order of ORDERS) {
      expect(labels(orderStreams(plain, order, UNKNOWN))).toEqual(
        labels(
          orderStreams(
            fixtureEntries(CAPABLE).filter((item) => item.facts.hdr.length === 0),
            order,
            CAPABLE,
          ),
        ),
      );
    }
  });
});

describe('tiers and stability on the TV, reviewed', () => {
  /** 40 streams with ties at every level: same addon rank and rank for many. */
  function crowd(tv: TvCapabilities): StreamEntry[] {
    const resolutions: Array<Resolution | undefined> = ['2160p', '1080p', '720p', undefined];
    const cache: Array<boolean | undefined> = [true, undefined, false];
    const sources: Source[] = ['url', 'url', 'url', 'youtube', 'torrent', 'proxy', 'external'];
    const specs: Array<[string, Spec]> = [];
    for (let i = 0; i < 40; i++) {
      specs.push([
        `s${i}`,
        {
          source: sources[i % sources.length],
          addonId: i % 4 === 0 ? 'b' : 'a',
          addonRank: i % 2,
          rank: i % 3,
          facts: {
            resolution: resolutions[i % resolutions.length],
            cached: cache[i % cache.length],
            sizeBytes: i % 5 === 0 ? undefined : GB,
            releaseSource: i % 11 === 0 ? 'TS' : undefined,
            hdr: i % 6 === 0 ? ['DV'] : [],
          },
        },
      ]);
    }
    return specs.map(([label, spec]) => entry(label, spec, tv));
  }

  for (const [name, tv] of Object.entries(TVS)) {
    it(`keeps the tiers in every order (${name})`, () => {
      for (const order of ORDERS) {
        const tiers = orderStreams(crowd(tv), order, tv).map(tierOf);
        expect(tiers).toEqual(tiers.slice().sort((a, b) => a - b));
      }
    });

    it(`gives the same answer when the sort is unstable (${name})`, () => {
      const list = crowd(tv);
      const score = { addonScore: (id: string) => (id === 'b' ? 0.9 : 0.5) };
      const want = ORDERS.map((order) => labels(orderStreams(list, order, tv, score)));
      const wantCandidates = AUTO.map((order) =>
        labels(playableCandidates(list, order, tv, score)),
      );
      const wantMenu = AUTO.map((order) => menu(playableCandidates(list, order, tv, score)));
      for (const stand of [
        () => sortReversingTies(),
        () => sortShufflingTies(7),
        () => sortShufflingTies(1234),
      ]) {
        stand();
        expect(ORDERS.map((order) => labels(orderStreams(list, order, tv, score)))).toEqual(want);
        expect(AUTO.map((order) => labels(playableCandidates(list, order, tv, score)))).toEqual(
          wantCandidates,
        );
        expect(AUTO.map((order) => menu(playableCandidates(list, order, tv, score)))).toEqual(
          wantMenu,
        );
        Array.prototype.sort = stableSort;
      }
    });
  }

  it('keeps the addons’ own order for equal streams when the sort is unstable', () => {
    sortShufflingTies(99);
    const same = entries(
      LG_2022,
      Array.from({ length: 25 }, (_, i): [string, Spec] => [
        `s${i}`,
        { addonRank: 0, rank: 0, facts: { resolution: '1080p', cached: true, sizeBytes: GB } },
      ]),
    );
    for (const order of ORDERS)
      expect(labels(orderStreams(same, order, LG_2022))).toEqual(labels(same));
    for (const order of AUTO) {
      expect(labels(playableCandidates(same, order, LG_2022))).toEqual(labels(same));
    }
    expect(menu(same)).toEqual([['1080p', 's0']]);
  });

  it('copes with addon scores that are not numbers between 0 and 1', () => {
    const list = entries(CAPABLE, [
      ['nan', { addonId: 'nan', facts: { resolution: '1080p' } }],
      ['huge', { addonId: 'huge', facts: { resolution: '1080p' } }],
      ['negative', { addonId: 'negative', facts: { resolution: '1080p' } }],
      ['infinite', { addonId: 'infinite', facts: { resolution: '1080p' } }],
      ['text', { addonId: 'text', facts: { resolution: '1080p' } }],
    ]);
    const scores: Record<string, unknown> = {
      nan: NaN,
      huge: 7,
      negative: -3,
      infinite: -Infinity,
      text: '0.9',
    };
    const addonScore = (id: string) => scores[id] as number;
    for (const order of AUTO) {
      sortShufflingTies(5);
      expect(labels(orderStreams(list, order, CAPABLE, { addonScore }))).toEqual([
        'huge',
        'nan',
        'infinite',
        'text',
        'negative',
      ]);
      Array.prototype.sort = stableSort;
    }
  });
});

describe('the Quality menu, reviewed', () => {
  it('offers 4K, 1080p and 720p on a 4K TV, each the best stream there', () => {
    const list = entries(LG_2022, [
      ['720p web', { facts: { resolution: '720p', cached: true } }],
      ['1080p webrip', { facts: { resolution: '1080p', releaseSource: 'WEBRip', cached: true } }],
      ['2160p hdr10', { facts: { resolution: '2160p', hdr: ['HDR10'], cached: true } }],
      ['1080p bluray', { facts: { resolution: '1080p', releaseSource: 'BluRay', cached: true } }],
      ['2160p sdr', { facts: { resolution: '2160p', cached: true } }],
    ]);
    expect(menu(playableCandidates(list, 'quality', LG_2022))).toEqual([
      ['2160p', '2160p hdr10'],
      ['1080p', '1080p bluray'],
      ['720p', '720p web'],
    ]);
  });

  it('leaves 4K out on a Full HD TV', () => {
    const list = entries(FHD_2022, [
      ['2160p', { facts: { resolution: '2160p', cached: true } }],
      ['1080p', { facts: { resolution: '1080p', cached: true } }],
      ['720p', { facts: { resolution: '720p', cached: true } }],
    ]);
    expect(menu(playableCandidates(list, 'quality', FHD_2022))).toEqual([
      ['1080p', '1080p'],
      ['720p', '720p'],
    ]);
  });

  it('leaves 4K out on the 2022 TV when every 4K stream would be silent or tinted', () => {
    const list = entries(LG_2022, [
      ['4k truehd', { facts: { resolution: '2160p', audio: ['TrueHD'], cached: true } }],
      ['4k dts', { facts: { resolution: '2160p', audio: ['DTS:X'], cached: true } }],
      ['4k dv5', { facts: { resolution: '2160p', hdr: ['DV'], cached: true } }],
      ['1080p', { facts: { resolution: '1080p', audio: ['DD+'], cached: true } }],
    ]);
    expect(menu(playableCandidates(list, 'quality', LG_2022))).toEqual([['1080p', '1080p']]);
    // One 4K stream that plays brings 4K back.
    const withGood4k = list.concat(
      entry(
        '4k dd+',
        { rank: 9, facts: { resolution: '2160p', audio: ['DD+'], cached: true } },
        LG_2022,
      ),
    );
    expect(menu(playableCandidates(withGood4k, 'quality', LG_2022))).toEqual([
      ['2160p', '4k dd+'],
      ['1080p', '1080p'],
    ]);
  });

  it('does not offer "4K" for a cinema recording while a proper release plays at 1080p', () => {
    const list = entries(CAPABLE, [
      ['2160p telesync', { facts: { resolution: '2160p', releaseSource: 'TS', cached: true } }],
      ['1080p cam', { facts: { resolution: '1080p', releaseSource: 'CAM', cached: true } }],
      ['1080p web', { facts: { resolution: '1080p', releaseSource: 'WEB-DL', cached: true } }],
      ['720p hdcam', { facts: { resolution: '720p', releaseSource: 'CAM', cached: true } }],
    ]);
    for (const order of AUTO) {
      expect(menu(playableCandidates(list, order, CAPABLE))).toEqual([['1080p', '1080p web']]);
    }
  });

  it('offers cinema recordings when nothing better is out yet', () => {
    const list = entries(CAPABLE, [
      ['720p telesync', { facts: { resolution: '720p', releaseSource: 'TS', cached: true } }],
      ['1080p cam', { facts: { resolution: '1080p', releaseSource: 'CAM', cached: true } }],
      ['2160p uncached web', { facts: { resolution: '2160p', cached: false } }],
    ]);
    expect(menu(playableCandidates(list, 'quality', CAPABLE))).toEqual([
      ['1080p', '1080p cam'],
      ['720p', '720p telesync'],
    ]);
  });

  it('picks the proper release at a resolution even when a list puts a recording first', () => {
    // Not from playableCandidates: 'fast' alone puts the small recording first.
    const list = entries(CAPABLE, [
      ['1080p web 3 GB', { facts: { resolution: '1080p', cached: true, sizeBytes: 3 * GB } }],
      [
        '1080p cam 1 GB',
        { facts: { resolution: '1080p', releaseSource: 'CAM', cached: true, sizeBytes: GB } },
      ],
    ]);
    const fast = orderStreams(list, 'fast', CAPABLE);
    expect(labels(fast)[0]).toBe('1080p cam 1 GB');
    expect(menu(fast)).toEqual([['1080p', '1080p web 3 GB']]);
  });

  it('lists each resolution once, highest first, unknown last, from the fixture on every TV', () => {
    const order: Array<Resolution | undefined> = [
      '2160p',
      '1440p',
      '1080p',
      '720p',
      '576p',
      '480p',
      '360p',
      undefined,
    ];
    for (const tv of Object.values(TVS)) {
      for (const choice of AUTO) {
        const candidates = playableCandidates(fixtureEntries(tv), choice, tv);
        const choices = qualityChoices(candidates);
        const positions = choices.map((item) => order.indexOf(item.resolution));
        expect(positions).toEqual(positions.slice().sort((a, b) => a - b));
        expect(new Set(positions).size).toBe(positions.length);
        for (const item of choices) expect(candidates).toContain(item.entry);
        // A menu line with a severe warning only when every candidate has one.
        if (candidates.some((item) => !isSevere(item))) {
          expect(choices.filter((item) => isSevere(item.entry))).toEqual([]);
        }
      }
    }
  });
});

describe('the addon fixture on each TV, reviewed', () => {
  for (const [name, tv] of Object.entries(TVS)) {
    for (const order of AUTO) {
      it(`offers only playable links, the likeliest to play first (${name}, ${order})`, () => {
        const candidates = playableCandidates(fixtureEntries(tv), order, tv);
        expect(candidates.length).toBeGreaterThan(0);
        for (const item of candidates) {
          expect(item.assessment.action.kind).toBe('play');
          expect(item.stream.source.kind).toBe('url');
          expect(item.stream.behaviorHints.proxyHeaders?.request ?? {}).toEqual({});
        }
        // Plain, then cinema recordings, then severe, then both.
        const groups = candidates.map((item) => (isSevere(item) ? 2 : 0) + (isCam(item) ? 1 : 0));
        expect(groups).toEqual(groups.slice().sort((a, b) => a - b));
      });
    }
  }

  it('starts a stream on the 2022 TV that has sound and a picture, by what the addons say', () => {
    for (const order of AUTO) {
      const first = playableCandidates(fixtureEntries(LG_2022), order, LG_2022)[0]!;
      expect(first.assessment.warnings.filter((warning) => SEVERE_WARNINGS.has(warning))).toEqual(
        [],
      );
      expect(first.facts.cached).toBe(true);
    }
  });

  it('starts a 1080p or lower stream on a Full HD TV', () => {
    for (const order of AUTO) {
      const first = playableCandidates(fixtureEntries(FHD_2022), order, FHD_2022)[0]!;
      expect(['1080p', '720p']).toContain(first.facts.resolution);
      expect(first.facts.hdr).toEqual([]);
    }
  });
});
