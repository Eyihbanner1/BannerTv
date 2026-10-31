import { parseStream, type Stream } from '@bannertv/protocol';
import { describe, expect, it } from 'vitest';
import { describeStream } from './facts';
import fixture from './fixtures/streams.json';
import type { StreamFacts } from './types';

interface Labels {
  resolution: string | null;
  hdr: string[];
  videoCodec: string | null;
  source: string | null;
  audio: string[];
  channels: string | null;
  size: { text: string; base: number; bytes: number } | null;
  seeders: number | null;
  availability: string;
  service: string | null;
  languages: string[];
}

interface FixtureStream {
  url?: unknown;
  behaviorHints?: { videoSize?: number };
  _fixture: { id: string; expect: Labels };
}

const STREAMS = (fixture as unknown as { streams: FixtureStream[] }).streams;

type Field =
  | 'resolution'
  | 'hdr'
  | 'videoCodec'
  | 'releaseSource'
  | 'audio'
  | 'channels'
  | 'sizeBytes'
  | 'seeders'
  | 'cached'
  | 'service'
  | 'languages';

/**
 * Labels the parser deliberately does not match, and why. Kept here so a
 * mismatch is a decision anyone can read, not a silent gap.
 */
const SKIPPED: Readonly<Record<string, Partial<Record<Field, string>>>> = {
  'mediafusion-v1-p2p-720p': {
    languages:
      'The file name says "Dual Audio", read as multi. The label leaves multi out here but has it for the same words in torrentio-p2p-720p-dual-audio.',
  },
  'jackettio-ad-uncached-1080p-progress': {
    languages:
      'The label reads 🌎 as multi, but AIOStreams writes 🌎 before every language list, so it is not taken as multi.',
  },
};

/** Streams parseStream drops because BannerTV cannot play their source at all. */
const UNREADABLE: Readonly<Record<string, string>> = {
  'usenet-nzb': 'nzbUrl needs a streaming server',
  'rar-archive': 'rarUrls needs a streaming server',
};

const CODECS: Readonly<Record<string, string>> = { hevc: 'HEVC', avc: 'H.264', av1: 'AV1' };
const SOURCES: Readonly<Record<string, string>> = {
  remux: 'REMUX',
  bluray: 'BluRay',
  bdrip: 'BluRay',
  'web-dl': 'WEB-DL',
  web: 'WEB-DL',
  webrip: 'WEBRip',
  hdtv: 'HDTV',
  dvdrip: 'DVD',
  cam: 'CAM',
  telesync: 'TS',
};
const AUDIO: Readonly<Record<string, string>> = {
  atmos: 'Atmos',
  truehd: 'TrueHD',
  'dts-x': 'DTS:X',
  'dts-hd-ma': 'DTS-HD MA',
  dts: 'DTS',
  ddp: 'DD+',
  dd: 'DD',
  aac: 'AAC',
};
/** The labels' own spellings for what StreamFacts calls "multi" and plain ISO 639-1. */
const LANGUAGES: Readonly<Record<string, string>> = { dual: 'multi', 'pt-BR': 'pt' };

function sorted(values: readonly string[]): string[] {
  return values.slice().sort();
}

/** The labels in StreamFacts' terms. */
function expected(raw: FixtureStream): Record<Field, unknown> {
  const labels = raw._fixture.expect;
  return {
    resolution: labels.resolution ?? undefined,
    hdr: labels.hdr.filter((format) => format !== 'SDR'),
    videoCodec: labels.videoCodec === null ? undefined : CODECS[labels.videoCodec],
    releaseSource: labels.source === null ? undefined : SOURCES[labels.source],
    audio: sorted(labels.audio.map((format) => AUDIO[format] ?? format)),
    channels: labels.channels ?? undefined,
    // behaviorHints.videoSize is exact and wins over the text the label was read from.
    sizeBytes: raw.behaviorHints?.videoSize ?? labels.size?.bytes,
    seeders: labels.seeders ?? undefined,
    cached:
      labels.availability === 'cached'
        ? true
        : labels.availability === 'uncached'
          ? false
          : undefined,
    service: labels.service ?? undefined,
    languages: sorted(labels.languages.map((code) => LANGUAGES[code] ?? code)),
  };
}

function actual(facts: StreamFacts): Record<Field, unknown> {
  return {
    resolution: facts.resolution,
    hdr: facts.hdr,
    videoCodec: facts.videoCodec,
    releaseSource: facts.releaseSource,
    audio: sorted(facts.audio),
    channels: facts.channels,
    sizeBytes: facts.sizeBytes,
    seeders: facts.seeders,
    cached: facts.cached,
    service: facts.service,
    languages: sorted(facts.languages),
  };
}

/**
 * Comet sends links with raw spaces, which parseStream rejects as it stands.
 * Those two streams are read with the spaces percent-encoded, so their text
 * still tests the parser.
 */
function parseFixture(raw: FixtureStream): Stream | undefined {
  const stream = parseStream(raw);
  if (stream || typeof raw.url !== 'string' || !/\s/.test(raw.url)) return stream;
  return parseStream({ ...raw, url: raw.url.replace(/\s/g, '%20') });
}

function read(raw: Record<string, unknown>): StreamFacts {
  const stream = parseStream({ url: 'https://example.org/play', ...raw });
  if (!stream) throw new Error('fixture stream did not parse');
  return describeStream(stream);
}

describe('describeStream on the addon fixture', () => {
  it('has every fixture stream', () => {
    expect(STREAMS.length).toBe(62);
  });

  for (const raw of STREAMS) {
    const id = raw._fixture.id;
    it(`reads ${id}`, () => {
      const stream = parseFixture(raw);
      if (UNREADABLE[id]) {
        expect(stream).toBeUndefined();
        return;
      }
      expect(stream).toBeDefined();
      const facts = describeStream(stream!);
      const want = expected(raw);
      const got = actual(facts);
      const skipped = SKIPPED[id] ?? {};
      for (const field of Object.keys(want) as Field[]) {
        if (skipped[field]) {
          // Still different: if the parser starts matching, the skip should go.
          expect(got[field], `${id} ${field} now matches; remove the skip`).not.toEqual(
            want[field],
          );
        } else {
          expect(got[field], `${id} ${field}`).toEqual(want[field]);
        }
      }
    });
  }

  it('never puts the link into the facts', () => {
    for (const raw of STREAMS) {
      const stream = parseFixture(raw);
      if (!stream || stream.source.kind !== 'url') continue;
      const text = JSON.stringify(describeStream(stream));
      expect(text).not.toContain('http');
      expect(text).not.toContain('KEY');
    }
  });

  it('reads every fixture stream 200 times well within a second', () => {
    const streams = STREAMS.map(parseFixture).filter((s): s is Stream => s !== undefined);
    // Warm up first, so the time is the parser's and not the compiler's.
    for (const stream of streams) describeStream(stream);
    const start = Date.now();
    for (let round = 0; round < 200; round++) {
      for (const stream of streams) describeStream(stream);
    }
    expect(Date.now() - start).toBeLessThan(600);
  });
});

describe('describeStream, tricky tokens', () => {
  it('tells the .ts container from a telesync', () => {
    const container = read({
      name: 'Sports',
      behaviorHints: { filename: 'Final.2024.1080p.HDTV.x264.ts' },
    });
    expect(container.releaseSource).toBe('HDTV');
    expect(container.container).toBe('ts');
    // A description that repeats the file name, extension and all.
    expect(read({ description: 'Final.2024.1080p.ts\nmore' }).releaseSource).toBeUndefined();
    expect(read({ description: 'Final.2024.1080p.ts' }).releaseSource).toBeUndefined();
    expect(read({ description: 'Film.2025.TS.x264-GRP' }).releaseSource).toBe('TS');
    expect(read({ description: 'Film 2025 720p HDTS' }).releaseSource).toBe('TS');
    expect(read({ name: 'Torrentio\nTeleSync' }).releaseSource).toBe('TS');
    expect(read({ description: 'Film 2025 TS' }).releaseSource).toBe('TS');
    // "ts" inside words and in container names is not a source.
    expect(read({ description: 'Wildcats.Shorts.2020.MPEG-TS.1080p' }).releaseSource).toBe(
      undefined,
    );
    expect(read({ url: 'https://cdn.example.org/live/chunk.ts?x=1' }).container).toBe('ts');
  });

  it('reads release sources, a cinema recording or remux over anything else named', () => {
    expect(read({ description: 'Film.2025.WEBSCR.x264' }).releaseSource).toBe('SCR');
    expect(read({ description: 'Film.2025.DVDScr.XviD' }).releaseSource).toBe('SCR');
    expect(read({ description: 'Film.2025.HDTC.x264' }).releaseSource).toBe('TC');
    expect(read({ description: 'Film 2025 HDCAM' }).releaseSource).toBe('CAM');
    expect(read({ description: 'Film.2016.BDRemux.x265' }).releaseSource).toBe('REMUX');
    expect(read({ description: 'Film.2016.UHD.BluRay.2160p.REMUX' }).releaseSource).toBe('REMUX');
    expect(read({ description: 'Film.2016.Blu-ray.1080p' }).releaseSource).toBe('BluRay');
    expect(read({ description: 'Show.S01E01.PDTV.x264' }).releaseSource).toBe('HDTV');
    expect(read({ description: 'Film 2025 1080p WEB-DL', name: 'CAM' }).releaseSource).toBe('CAM');
  });

  it('does not see HDR inside other words', () => {
    expect(read({ description: 'Film.2019.720p.HDRip.x264' }).hdr).toEqual([]);
    expect(read({ description: 'Film 2019 1080p HDRezka Studio' }).hdr).toEqual([]);
    expect(read({ description: 'Film 2019 1080p UHDR' }).hdr).toEqual([]);
    expect(read({ description: 'Film 2019 1080p SDR' }).hdr).toEqual([]);
    expect(read({ description: 'Film.2160p.HDR10Plus.HEVC' }).hdr).toEqual(['HDR10+']);
    expect(read({ description: 'Film.2160p.DV.HDR.HLG' }).hdr).toEqual(['DV', 'HDR', 'HLG']);
    // The name's plain "HDR" is the HDR10 the file name spells out.
    expect(read({ name: '4k DV | HDR', description: 'Film.2160p.DoVi.HDR10' }).hdr).toEqual([
      'DV',
      'HDR10',
    ]);
    expect(read({ description: 'Film Dolby Vision' }).hdr).toEqual(['DV']);
    expect(read({ description: 'Film.1080p.DVDRip' }).hdr).toEqual([]);
  });

  it('trusts the release name over a name tag that says 4k', () => {
    const facts = read({ name: 'Brazuca\n4k', description: 'Interstelar.2014.1080p.BluRay' });
    expect(facts.resolution).toBe('1080p');
    expect(read({ name: 'Brazuca\n4k', description: 'Interstelar 2014' }).resolution).toBe('2160p');
    expect(
      read({
        name: 'Addon 4k',
        description: 'Film 2160p',
        behaviorHints: { filename: 'Film.1080p.mkv' },
      }).resolution,
    ).toBe('1080p');
  });

  it('reads resolutions written in other ways', () => {
    expect(read({ name: '🚀 FHD' }).resolution).toBe('1080p');
    expect(read({ name: 'Addon UHD' }).resolution).toBe('2160p');
    expect(read({ name: '📺4K' }).resolution).toBe('2160p');
    expect(read({ description: 'Film.2160p60.HEVC' }).resolution).toBe('2160p');
    expect(read({ description: 'Film 1920x1080 x264' }).resolution).toBe('1080p');
    expect(read({ description: 'Film 1080i HDTV' }).resolution).toBe('1080p');
    expect(read({ description: 'Film UHD BluRay 1080p' }).resolution).toBe('1080p');
    // "HD" alone only counts when nothing better is said.
    expect(read({ name: 'Addon HD' }).resolution).toBe('720p');
    expect(read({ name: 'Addon HD', description: 'Film 1080p' }).resolution).toBe('1080p');
    expect(read({ name: 'Addon DTS-HD' }).resolution).toBeUndefined();
    expect(read({ description: 'Film HD-TS' }).resolution).toBeUndefined();
  });

  it('does not take "TPB+" or "Ingles+Subs" for a cache marker', () => {
    const facts = read({
      name: 'TPB+',
      description: 'Film [DTS 5.1 Castellano DTS 5.1-Ingles+Subs]',
    });
    expect(facts.cached).toBeUndefined();
    expect(facts.service).toBeUndefined();
    expect(facts.languages).toEqual(['es', 'en']);
  });

  it('reads ⚡ with and without the variation selector', () => {
    expect(read({ name: 'MediaFusion 🧲 RD ⚡️ 4k' })).toMatchObject({
      cached: true,
      service: 'RD',
    });
    expect(read({ name: 'MediaFusion 🧲 RD ⚡ 4k' })).toMatchObject({ cached: true });
    expect(read({ name: '[PM⚡️] Comet' })).toMatchObject({ cached: true, service: 'PM' });
    expect(read({ name: '⚡️ [RD]\nTorz\n2160p' })).toMatchObject({
      cached: true,
      service: 'RD',
    });
  });

  it('reads the other cache markers', () => {
    expect(read({ name: '[RD+] Torrentio' })).toMatchObject({ cached: true, service: 'RD' });
    expect(read({ name: '[RD download] Torrentio' })).toMatchObject({
      cached: false,
      service: 'RD',
    });
    expect(read({ name: '[TB⬇️] Comet' })).toMatchObject({ cached: false, service: 'TB' });
    expect(read({ name: 'MediaFusion 🧲 TRB ⏳ 1080p' })).toMatchObject({
      cached: false,
      service: 'TB',
    });
    expect(read({ name: 'TorBox (Instant TB) (2160p)' })).toMatchObject({
      cached: true,
      service: 'TB',
    });
    expect(read({ name: '[AD] Jackettio 1080p' })).toMatchObject({
      cached: false,
      service: 'AD',
    });
    expect(read({ name: '✨ 4K 🎫' }).cached).toBe(true);
    expect(read({ name: '✨ 4K 🎟️' }).cached).toBe(false);
    expect(read({ name: '🚀 FHD', description: '❌ Not Ready (RD)' })).toMatchObject({
      cached: false,
      service: 'RD',
    });
    expect(read({ name: '🚀 ORION\n[Offcloud]' })).toMatchObject({
      cached: true,
      service: 'OC',
    });
    // The 🚀 is Orion's own marker, not a general one.
    expect(read({ name: '🚀 FHD' }).cached).toBeUndefined();
    // Older MediaFusion's "P2P ⏳" is not an uncached debrid link.
    expect(read({ name: 'MediaFusion 🧲 P2P ⏳ 1080P' }).cached).toBeUndefined();
    // "[P2P]" is not PikPak's "PP".
    expect(read({ name: '[P2P] Torrentio 720p' }).service).toBeUndefined();
    expect(read({ name: 'Plain addon 1080p' }).cached).toBeUndefined();
  });

  it('leaves cache state and service out for torrents', () => {
    const torrent = parseStream({
      infoHash: 'e4f5d7a2f3dd6b7b1826bd77e316b6b5ba31eb72',
      name: '[RD+] Torrentio\n4k',
    })!;
    const facts = describeStream(torrent);
    expect(facts.cached).toBeUndefined();
    expect(facts.service).toBeUndefined();
    expect(facts.resolution).toBe('2160p');
  });

  it('reads GiB, MiB, GB and MB', () => {
    const GiB = 1024 * 1024 * 1024;
    expect(read({ description: '💾 4.2 GB' }).sizeBytes).toBe(Math.round(4.2 * GiB));
    expect(read({ description: '💾33.82 GiB' }).sizeBytes).toBe(Math.round(33.82 * GiB));
    expect(read({ description: '💾701.5 MiB' }).sizeBytes).toBe(Math.round(701.5 * 1024 * 1024));
    expect(read({ description: '💾 864.57 MB' }).sizeBytes).toBe(Math.round(864.57 * 1024 * 1024));
    expect(read({ description: 'Size: 1,46 GB | Source: x' }).sizeBytes).toBe(
      Math.round(1.46 * GiB),
    );
    expect(read({ description: 'Size: 1,234.5 MB' }).sizeBytes).toBe(
      Math.round(1234.5 * 1024 * 1024),
    );
    expect(read({ description: '💾 1.2 TB' }).sizeBytes).toBe(Math.round(1.2 * GiB * 1024));
    // Where the same text also writes GiB, a plain GB is decimal.
    expect(read({ description: '💾 4.2 GB 📦 30 GiB' }).sizeBytes).toBe(4.2e9);
    // A speed is not a size.
    expect(read({ description: '⬇️ 42% 3.1 MB/s 💾 2.1 GB' }).sizeBytes).toBe(
      Math.round(2.1 * GiB),
    );
  });

  it('takes the file size from "file / pack" and "💾 file 📦 pack"', () => {
    const GiB = 1024 * 1024 * 1024;
    expect(read({ description: '📦 2.43 GB / 33.48 GB 👤 4' }).sizeBytes).toBe(
      Math.round(2.43 * GiB),
    );
    expect(read({ description: '💾 3.1 GB 📦 22.4 GB 👤 9' }).sizeBytes).toBe(
      Math.round(3.1 * GiB),
    );
  });

  it('prefers behaviorHints.videoSize to the text', () => {
    expect(
      read({ description: '💾 7.29 GB', behaviorHints: { videoSize: 7826122416 } }).sizeBytes,
    ).toBe(7826122416);
  });

  it('reads seeders with and without spaces', () => {
    expect(read({ description: '👤 47 💾 40.33 GB' }).seeders).toBe(47);
    expect(read({ description: '💾26.6 GB 👤0 🎥h265' }).seeders).toBe(0);
    expect(read({ description: '💾2.1 GB 👥310 ⚙️yts' }).seeders).toBe(310);
    expect(read({ description: '📦 7.94 GB 🌱 230' }).seeders).toBe(230);
    expect(read({ description: 'Type: Torrent | Seeders: 77' }).seeders).toBe(77);
    expect(read({ description: 'S: 12' }).seeders).toBe(12);
    expect(read({ description: '👤 1,532' }).seeders).toBe(1532);
    expect(read({ description: 'DTS:X 7.1' }).seeders).toBeUndefined();
    expect(read({ description: '💾 2.1 GB' }).seeders).toBeUndefined();
  });

  it('reads channels without mistaking sizes and codecs for them', () => {
    expect(read({ description: 'TrueHD Atmos 7 1 Kira [SEV] mkv' }).channels).toBe('7.1');
    expect(read({ description: 'Film.DDP5.1.Atmos' }).channels).toBe('5.1');
    expect(read({ description: 'Film.AAC2.0.x264' }).channels).toBe('2.0');
    expect(read({ description: 'Film DD+5.1' }).channels).toBe('5.1');
    expect(read({ description: '🔊7.1' }).channels).toBe('7.1');
    expect(read({ description: 'Film stereo' }).channels).toBe('2.0');
    expect(read({ description: 'Film.x265.10bit 💾 2.0 GB' }).channels).toBeUndefined();
    expect(read({ description: 'Film 2017 1080p 💾 7.1 GB' }).channels).toBeUndefined();
    expect(read({ description: '⬇️ 3.1 MB/s' }).channels).toBeUndefined();
  });

  it('reads codecs and bit depth', () => {
    expect(read({ description: 'Film.H.265-GRP' }).videoCodec).toBe('HEVC');
    expect(read({ description: 'Film [H264-mp4]' }).videoCodec).toBe('H.264');
    expect(read({ description: 'Film.AV1-GRP' }).videoCodec).toBe('AV1');
    expect(read({ description: 'Film.XviD-GRP' }).videoCodec).toBe('XviD');
    expect(read({ description: 'Film.VC-1' }).videoCodec).toBe('VC-1');
    expect(read({ description: 'Film.MPEG-2' }).videoCodec).toBe('MPEG-2');
    expect(read({ description: 'Film.x265.10bit' }).bitDepth).toBe(10);
    expect(read({ description: 'Film 12 bit DV' }).bitDepth).toBe(12);
    expect(read({ description: 'Film 8bit' }).bitDepth).toBe(8);
    // HDR is never 8-bit.
    expect(read({ description: 'Film HDR' }).bitDepth).toBe(10);
    expect(read({ description: 'Film x264' }).bitDepth).toBeUndefined();
  });

  it('lists audio best first and names the main track', () => {
    const remux = read({ description: 'Film.TrueHD.Atmos.7.1.AC3.5.1-GRP' });
    expect(remux.audio).toEqual(['Atmos', 'TrueHD', 'DD']);
    expect(remux.mainAudio).toBe('TrueHD');
    const web = read({ description: 'Film.DDP5.1.Atmos-GRP', name: '🎧 TrueHD' });
    expect(web.mainAudio).toBe('DD+');
    expect(read({ description: '🔊 Atmos' }).mainAudio).toBeUndefined();
    expect(read({ description: 'Film DTS-HD MA 5.1 DTS core' }).audio).toEqual(['DTS-HD MA']);
    expect(read({ description: 'Film DTS 5.1 then DTS-HD MA' }).mainAudio).toBe('DTS-HD MA');
    // DTS:X needs its own boundary: "DTS x264" is plain DTS.
    expect(read({ description: 'Film DTS x264' }).audio).toEqual(['DTS']);
    expect(read({ description: 'Film DTS:X' }).audio).toEqual(['DTS:X']);
    expect(read({ description: 'Film DDPA5.1' }).audio).toEqual(['Atmos', 'DD+']);
    expect(read({ description: 'Film Dolby Digital Plus' }).audio).toEqual(['DD+']);
    expect(read({ description: 'Film E-AC-3 and LPCM' }).audio).toEqual(['DD+', 'PCM']);
  });

  it('reads languages from flags, words and marked code lists', () => {
    expect(read({ description: 'Multi Subs / 🇬🇧 / 🇷🇺 / 🇫🇮' }).languages).toEqual([
      'en',
      'ru',
      'fi',
    ]);
    expect(read({ description: 'Film.MULTi.1080p' }).languages).toEqual(['multi']);
    expect(read({ description: 'Film [Dual Audio]' }).languages).toEqual(['multi']);
    expect(read({ description: '👂EN FR ES ☁️1337x' }).languages).toEqual(['en', 'fr', 'es']);
    expect(read({ description: '👤 76 💾 2.3 GB 🗣 SK/CZ' }).languages).toEqual(['sk', 'cs']);
    expect(read({ description: 'Languages: English, Italian' }).languages).toEqual(['en', 'it']);
    // Two-letter words outside a marked list stay unread: "IT" is also a word.
    expect(read({ description: 'IT (2017) 1080p' }).languages).toEqual([]);
    // Subtitle lists after 📝 are not the stream's languages.
    expect(read({ description: '🌎 English | French📝 German' }).languages).toEqual(['en', 'fr']);
    expect(read({ description: '🌐 🇬🇧 / 🇮🇹📝 🇩🇪' }).languages).toEqual(['en', 'it']);
  });

  it('reads the container from the file name, else from the link', () => {
    expect(read({ behaviorHints: { filename: 'Film.avi' } }).container).toBe('avi');
    expect(
      read({ url: 'https://cdn.example.org/hls/master.m3u8?token=abc', name: 'Live' }).container,
    ).toBe('m3u8');
    expect(read({ url: 'https://cdn.example.org/Film.2020.1080p.mp4' })).toMatchObject({
      container: 'mp4',
      resolution: '1080p',
    });
    expect(read({ url: 'https://cdn.example.org/play/abcdef' }).container).toBeUndefined();
  });
});

describe('describeStream, samples and release groups', () => {
  /** The facts of one fixture stream, by its id. */
  function fixtureFacts(id: string): StreamFacts {
    const raw = STREAMS.find((stream) => stream._fixture.id === id);
    const stream = raw && parseFixture(raw);
    if (!stream) throw new Error(`no fixture stream ${id}`);
    return describeStream(stream);
  }

  it('marks samples, trailers, teasers and featurettes', () => {
    expect(
      read({ behaviorHints: { filename: 'Film.2020.1080p.WEB-DL.x264-GRP.sample.mkv' } }).sample,
    ).toBe(true);
    expect(read({ description: 'Film 2020 Official Trailer 1080p' }).sample).toBe(true);
    expect(read({ description: 'Film.2020.Teaser.1080p.WEB' }).sample).toBe(true);
    expect(read({ description: 'Film 2020 Featurette 720p' }).sample).toBe(true);
    expect(read({ url: 'https://cdn.example.org/Sample/film-sample.mkv' }).sample).toBe(true);
    expect(read({ name: 'Trailer' }).sample).toBe(true);
  });

  it('does not mark a title with the word in it, nor a longer word', () => {
    expect(read({ description: 'Trailer.Park.Boys.S01E01.1080p.WEB.h264-GRP' }).sample).toBe(
      undefined,
    );
    expect(read({ description: 'The Teaser (2019) 1080p' }).sample).toBeUndefined();
    // A line that is only the title, as some addons write it, is not a clip.
    expect(read({ name: 'Trailer Park Boys', description: 'S01E01 1080p' }).sample).toBeUndefined();
    expect(read({ description: 'Trailer Park Boys\n1080p WEB 1.2 GB' }).sample).toBeUndefined();
    expect(read({ name: 'Official Trailer' }).sample).toBe(true);
    expect(read({ description: 'Film.2020.1080p.WEB-DL.x264-GRP' }).sample).toBeUndefined();
    expect(read({ description: 'Film.2020.1080p.Samples.Included' }).sample).toBeUndefined();
  });

  it("does not mark an episode whose own title has the word, but still marks the episode's sample", () => {
    expect(read({ description: 'Show.S03E05.The.Trailer.1080p.WEB-DL.x264-GRP' }).sample).toBe(
      undefined,
    );
    expect(read({ description: 'Show.S01E04.Free.Sample.1080p.WEB' }).sample).toBeUndefined();
    expect(read({ description: 'Show S02E01 Teaser Trailer 720p HDTV' }).sample).toBeUndefined();
    expect(
      read({ behaviorHints: { filename: 'Show.S01E01.1080p.WEB.x264-GRP.sample.mkv' } }).sample,
    ).toBe(true);
    expect(read({ description: 'Show.S01E01.1080p.WEB.Trailer' }).sample).toBe(true);
    // Any source or codec ends the title, and so does the end of a file's own name.
    for (const tags of [
      'PDTV.XviD-LOL',
      'SDTV.AAC',
      'DSR.XviD-GRP',
      'HDRip.XviD-GRP',
      'DVDR-GRP',
    ]) {
      expect(read({ description: `Show.S03E05.The.Trailer.${tags}` }).sample, tags).toBeUndefined();
    }
    expect(read({ description: 'Show.S01E01E02.Free.Sample.1080p.WEB-DL' }).sample).toBeUndefined();
    expect(
      read({
        description: 'Show.S03.1080p.BluRay.x264-GRP',
        behaviorHints: { filename: 'Show (1989) - S03E05 - The Trailer.mkv' },
      }).sample,
    ).toBeUndefined();
    expect(
      read({ description: 'Show.S03.1080p.WEB\nShow - S03E05 - The Trailer.mkv' }).sample,
    ).toBe(undefined);
    // In brackets it is a tag; in a release name with nothing after it, nothing says it is a title.
    expect(read({ description: 'Show.S01E01.[Sample].1080p.WEB' }).sample).toBe(true);
    expect(read({ description: 'Show.S01E01.Sample' }).sample).toBe(true);
    // A file named for the episode's sample, with no tag to end a title, is a sample.
    expect(read({ behaviorHints: { filename: 'Show.S03E05.Sample.mkv' } }).sample).toBe(true);
    expect(read({ behaviorHints: { filename: 'show.s03e05-sample.mkv' } }).sample).toBe(true);
    expect(read({ url: 'https://cdn.example.org/show.s03e05-sample.mkv' }).sample).toBe(true);
    expect(read({ description: '📂 Show.S03E05.Sample.mkv\n💾 40 MB' }).sample).toBe(true);
    // Beside other words, with no tag, it is the episode's own title.
    expect(
      read({ behaviorHints: { filename: 'Show (2010) - s01e04 - Free Sample.mkv' } }).sample,
    ).toBeUndefined();
    expect(
      read({ description: 'Show.S01.1080p.WEB.h264-GRP\nShow.S01/Show - S01E04 - Free Sample.mkv' })
        .sample,
    ).toBeUndefined();
  });

  it('reads the release group from the file name first', () => {
    expect(
      read({
        behaviorHints: {
          filename:
            'Deadpool.2016.UHD.BluRay.2160p.TrueHD.Atmos.7.1.DV.HEVC.HYBRiD.REMUX-FraMeSToR.mkv',
        },
      }).releaseGroup,
    ).toBe('framestor');
    expect(
      read({
        description: 'Show.S01.1080p.WEB-DL.x264-PACK',
        behaviorHints: { filename: 'Show.S01E02.1080p.WEB-DL.x264-EPGRP.mkv' },
      }).releaseGroup,
    ).toBe('epgrp');
  });

  it('else from the first line of the description that names a release', () => {
    expect(
      read({ description: 'Film.2023.1080p.WEB-DL.DDP5.1.H.264-FLUX\n💾 5.2 GB' }),
    ).toMatchObject({ releaseGroup: 'flux' });
    expect(
      read({
        description: 'Quality: WEB-DL\nName: Show.S02E10.2160p.WEB-DL.H.265-NTb.mkv\nSize: 8.4 GB',
      }).releaseGroup,
    ).toBe('ntb');
    // The file name has none, so the description's goes.
    expect(
      read({
        description: 'Film.2020.1080p.BluRay.x264-AMIABLE',
        behaviorHints: { filename: 'film.mkv' },
      }).releaseGroup,
    ).toBe('amiable');
  });

  it('reads no group from words that only look like one', () => {
    expect(read({ description: 'Film.2020.1080p.WEB-DL' }).releaseGroup).toBeUndefined();
    expect(read({ description: 'Film.2020.720p.BluRay.x264-ITA' }).releaseGroup).toBeUndefined();
    expect(read({ description: 'Spider-Man' }).releaseGroup).toBeUndefined();
    expect(read({ description: 'Film.2020.1080p.x264-GRP-sample' }).releaseGroup).toBeUndefined();
    // A line naming no year, episode or resolution is not a release name.
    expect(read({ description: 'Open Movie - Directors-Cut' }).releaseGroup).toBeUndefined();
  });

  it('never reads the group from the link, which can carry account keys', () => {
    expect(
      read({ url: 'https://cdn.example.org/play/Film.2020.1080p.WEB-DL.x264-SECRETKEY' })
        .releaseGroup,
    ).toBeUndefined();
  });

  it('reads the fixture streams', () => {
    expect(fixtureFacts('torrentio-p2p-4k-dv-remux').releaseGroup).toBe('framestor');
    expect(fixtureFacts('torrentio-tb-cached-1080p-web-atmos').releaseGroup).toBe('flux');
    expect(fixtureFacts('torrentio-p2p-4k-hdr10plus-web').releaseGroup).toBe('ntb');
    expect(fixtureFacts('aiostreams-torrentio-style-p2p-mib').releaseGroup).toBe('ethel');
    expect(fixtureFacts('stremthru-torz-rd-cached-2160p').releaseGroup).toBe('framestor');
    expect(fixtureFacts('comet-v1-p2p-1080p').releaseGroup).toBe('3li');
    expect(fixtureFacts('torrentio-p2p-cam').releaseGroup).toBeUndefined();
    expect(fixtureFacts('torrentio-p2p-1080p-pack-multisubs').releaseGroup).toBeUndefined();
    expect(fixtureFacts('youtube-trailer').sample).toBe(true);
    for (const raw of STREAMS) {
      const stream = parseFixture(raw);
      if (stream && raw._fixture.id !== 'youtube-trailer') {
        expect(describeStream(stream).sample, raw._fixture.id).toBeUndefined();
      }
    }
  });
});
