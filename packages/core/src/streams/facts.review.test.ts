import { parseStream, type Stream } from '@bannertv/protocol';
import { describe, expect, it } from 'vitest';
import { describeStream } from './facts';
import fixture from './fixtures/streams.json';
import type { StreamFacts } from './types';

// Edge cases found in review: every addon format in the research, title
// words, glued and dotted tokens, sizes, the link's host and query, and speed
// on long or careless input.

const GiB = 1024 * 1024 * 1024;
const MiB = 1024 * 1024;

function read(raw: Record<string, unknown>): StreamFacts {
  const stream = parseStream({ url: 'https://example.org/play', ...raw });
  if (!stream) throw new Error('stream did not parse');
  return describeStream(stream);
}

describe('describeStream, reviewed: addon formats', () => {
  it('reads Torrentio, and takes the 💾 file size over a pack size in the torrent name', () => {
    const facts = read({
      name: '[RD+] Torrentio\n720p',
      description:
        'The Office (US) Complete Series 720p WEB-DL [120 GB]\nThe.Desk.US.S01E01.Pilot.720p.WEB-DL.DDP5.1.H.264-NTb.mkv\n👤 20 💾 350 MB ⚙️ Index42',
    });
    expect(facts).toMatchObject({
      resolution: '720p',
      releaseSource: 'WEB-DL',
      videoCodec: 'H.264',
      audio: ['DD+'],
      channels: '5.1',
      sizeBytes: 350 * MiB,
      seeders: 20,
      cached: true,
      service: 'RD',
    });
  });

  it('reads Knightcrawler, lower-case and without seeders', () => {
    const facts = read({
      name: '[PM download] knightcrawler\n1080p',
      description: 'The.Nightwarden.2022.1080p.BluRay.DD5.1.x264-GRP\n💾 12.4 GB',
    });
    expect(facts).toMatchObject({ resolution: '1080p', cached: false, service: 'PM' });
    expect(facts.seeders).toBeUndefined();
  });

  it('reads Comet v2 lines', () => {
    const facts = read({
      name: '[RD⚡] Comet 2160p',
      description:
        '📄 Fission.2023.2160p.UHD.BluRay.REMUX.DV.HDR.HEVC.TrueHD.Atmos.7.1-GRP\n📹 hevc • DV • HDR | 🔊 Atmos • TrueHD • 7.1\n⭐ BluRay REMUX | 🏷️ GRP\n👤 87 💾 74.3 GB 🔎 StarTracker\n🇬🇧',
    });
    expect(facts).toMatchObject({
      resolution: '2160p',
      hdr: ['DV', 'HDR'],
      videoCodec: 'HEVC',
      audio: ['Atmos', 'TrueHD'],
      mainAudio: 'TrueHD',
      channels: '7.1',
      releaseSource: 'REMUX',
      sizeBytes: Math.round(74.3 * GiB),
      seeders: 87,
      cached: true,
      service: 'RD',
      languages: ['en'],
    });
  });

  it('reads MediaFusion, upper case and lower case, with "file / pack"', () => {
    const facts = read({
      name: 'MEDIAFUSION | ELFHOSTED 🧲 TRB ⏳ 1080P',
      description:
        '📺 BluRay 🎞️ x264 🎵 DTS 🔊 5.1\n📦 9.87 GB / 41.20 GB 👤 18\n🌐 English + Italian\n🔗 Index42',
    });
    expect(facts).toMatchObject({
      resolution: '1080p',
      releaseSource: 'BluRay',
      audio: ['DTS'],
      sizeBytes: Math.round(9.87 * GiB),
      seeders: 18,
      cached: false,
      service: 'TB',
      languages: ['en', 'it'],
    });
  });

  it('reads StremThru: 💾 is the file and 📦 the pack', () => {
    const facts = read({
      name: '[TB]\nTorz\n1080p',
      description: '💿 WEB-DL 🎞️ AVC\n🎧 DD+ | 5.1\n💾 3.1 GB 📦 22.4 GB 👤 9',
    });
    expect(facts).toMatchObject({
      sizeBytes: Math.round(3.1 * GiB),
      cached: false,
      service: 'TB',
      videoCodec: 'H.264',
    });
  });

  it('reads the AIOStreams torrentio template: GiB, "/ 💾" folder size, and "Subs /"', () => {
    const facts = read({
      name: '[RD+] Torrentio 2160p\nDV | HDR10',
      description:
        'High.Wing.Ace.2022.2160p.UHD.BluRay.x265.10bit.DV.HDR10.DTS-HD.MA.7.1-GRP\n💾33.82 GiB / 💾120.5 GiB👤61 📅12d ⚙️StarTracker\n🇬🇧 / 🇫🇷 Subs / 🇬🇧 / 🇪🇸',
    });
    expect(facts).toMatchObject({
      resolution: '2160p',
      hdr: ['DV', 'HDR10'],
      videoCodec: 'HEVC',
      bitDepth: 10,
      audio: ['DTS-HD MA'],
      channels: '7.1',
      releaseSource: 'BluRay',
      sizeBytes: Math.round(33.82 * GiB),
      seeders: 61,
      cached: true,
      service: 'RD',
      // The flags after "Subs /" are subtitles.
      languages: ['en', 'fr'],
    });
    // With no audio languages the line starts with "Subs /".
    expect(read({ description: 'Subs / 🇬🇧 / 🇪🇸' }).languages).toEqual([]);
    // Torrentio's own "Multi Subs /" is followed by the audio languages.
    expect(read({ description: 'Multi Subs / 🇬🇧 / 🇷🇺' }).languages).toEqual(['en', 'ru']);
  });

  it('reads the AIOStreams torbox template, leaving out "| Subtitles:"', () => {
    const facts = read({
      name: 'Comet (Instant RD) (2160p)',
      description:
        'Quality: BluRay REMUX\nName: Sandsea.2021.2160p.UHD.BluRay.REMUX.DV.HDR10.HEVC.TrueHD.Atmos.7.1-GRP.mkv\nSize: 68.4 GB / 140 GB | Source: StarTracker\nLanguages: English, Italian | Subtitles: French, German',
    });
    expect(facts).toMatchObject({
      resolution: '2160p',
      releaseSource: 'REMUX',
      cached: true,
      service: 'RD',
      languages: ['en', 'it'],
    });
    // The file, not the pack, whichever base the template used.
    expect(facts.sizeBytes).toBeGreaterThan(68e9);
    expect(facts.sizeBytes).toBeLessThan(74e9);
    expect(read({ name: 'TorBox (TB) (1080p)' })).toMatchObject({ cached: false, service: 'TB' });
  });

  it('reads the AIOStreams gdrive and lightgdrive templates', () => {
    const gdrive = read({
      name: '[RD⚡] Comet 2160p (Best)',
      description:
        '🎥 BluRay REMUX 🎞️ HEVC 🏷️ FraMeSToR 📡 AMZN\n📺 DV | HDR10 🎧 TrueHD | Atmos 🔊 7.1\n📦 61.2 GB / 140 GB 👥 45 📅 3d 🔍 StarTracker\n🌎 English | French📝 English | German\n📁 Tidewalker.The.Deep.Path.2022.2160p.UHD.BluRay.REMUX.DV.HDR10.HEVC.TrueHD.Atmos.7.1-FraMeSToR.mkv',
    });
    expect(gdrive).toMatchObject({
      resolution: '2160p',
      hdr: ['DV', 'HDR10'],
      audio: ['Atmos', 'TrueHD'],
      mainAudio: 'TrueHD',
      channels: '7.1',
      releaseSource: 'REMUX',
      seeders: 45,
      cached: true,
      service: 'RD',
      languages: ['en', 'fr'],
    });
    expect(gdrive.sizeBytes).toBeGreaterThan(61e9);
    expect(gdrive.sizeBytes).toBeLessThan(66e9);

    const light = read({
      name: '[RD⏳] Comet 1080p',
      description:
        '📁 Sandsea (2021)\n🎥 WEB-DL 🎞️ HEVC 🏷️ GRP\n📺 HDR10 🎧 DD+ | Atmos 🔊 5.1\n📦 9.8 GB 📅 3d 🔍 StarTracker\n🌐 🇬🇧 / 🇮🇹📝 🇬🇧 / 🇩🇪',
    });
    expect(light).toMatchObject({
      resolution: '1080p',
      hdr: ['HDR10'],
      audio: ['Atmos', 'DD+'],
      mainAudio: 'DD+',
      channels: '5.1',
      cached: false,
      service: 'RD',
      languages: ['en', 'it'],
    });
  });

  it('reads the AIOStreams minimalistic template, its tickets and its "2K"', () => {
    expect(read({ name: '🧿1080p 🎟️ \nWEB-DL' })).toMatchObject({
      resolution: '1080p',
      releaseSource: 'WEB-DL',
      cached: false,
    });
    expect(read({ name: '🧿1080p 🎟 \nWEB-DL' }).cached).toBe(false);
    expect(read({ name: '📀 2K 🎫 \nBLURAY' })).toMatchObject({
      resolution: '1440p',
      releaseSource: 'BluRay',
      cached: true,
    });
    const facts = read({
      name: '✨ 4K 🎫 \nBLURAY REMUX',
      description: '🔆 DV • HDR10  🔊 TrueHD • Atmos\n📦 58.1 GB \n🌎 English • German📝 French',
    });
    expect(facts).toMatchObject({
      resolution: '2160p',
      releaseSource: 'REMUX',
      languages: ['en', 'de'],
    });
  });

  it('reads the AIOStreams prism template, "⚡Ready (RD)" and "❌ Not Ready (RD)"', () => {
    const description =
      '🎬 Arena Ii (2024) \n🎥 WEB-DL 📺 HDR 🎞️ HEVC \n🎧 DD+ | Atmos 🔊 5.1 🗣️ 🇬🇧 / 🇮🇹📝 🇫🇷\n📦 7.94 GB 📊 12.5 Mbps \n🏷️ GRP 📡 StarTracker \n';
    const ready = read({ name: '🚀 FHD', description: description + '⚡Ready (RD) 🔍Torrentio ' });
    expect(ready).toMatchObject({
      resolution: '1080p',
      hdr: ['HDR'],
      videoCodec: 'HEVC',
      audio: ['Atmos', 'DD+'],
      channels: '5.1',
      releaseSource: 'WEB-DL',
      sizeBytes: Math.round(7.94 * GiB),
      cached: true,
      service: 'RD',
      languages: ['en', 'it'],
    });
    const notReady = read({
      name: '🔥4K UHD',
      description: description + '❌ Not Ready (TB) 🔍Torrentio ',
    });
    expect(notReady).toMatchObject({ resolution: '2160p', cached: false, service: 'TB' });
    expect(read({ name: '✨ QHD' }).resolution).toBe('1440p');
    expect(read({ name: '💿 HD' }).resolution).toBe('720p');
    expect(read({ name: '💩 Low Quality' }).resolution).toBeUndefined();
    // "Already" is not "Ready", and a title with "Ready" in it does not hide the mark.
    expect(read({ description: 'Already (RD)' }).service).toBeUndefined();
    expect(
      read({
        name: '🚀 FHD',
        description: '🎬 Ready Player One (2018) \n📦 7.94 GB \n❌ Not Ready (RD) 🔍Torrentio ',
      }),
    ).toMatchObject({ cached: false, service: 'RD' });
  });

  it('reads the AIOStreams tamtaro template: one unit for "file / pack", ⇄ seeders', () => {
    const facts = read({
      name: '   4K \u200d    \u200d\u200d\u200d\u200d⏳\u200d\u200b\n  〈Remux〉\u200d     ',
      description:
        '✎  Sandsea (2021)\n▣  HEVC ✦ DV · HDR10  ♬ DTS-HD MA  ♯ 7.1\n◈ 61.2 / 140 GB · 98.5 Mbps ⇄ 12❦ · 3d\n⛉ [RD] Comet · FraMeSToR · StarTracker',
    });
    expect(facts).toMatchObject({
      resolution: '2160p',
      hdr: ['DV', 'HDR10'],
      videoCodec: 'HEVC',
      audio: ['DTS-HD MA'],
      channels: '7.1',
      releaseSource: 'REMUX',
      seeders: 12,
      cached: false,
    });
    expect(facts.sizeBytes).toBeGreaterThan(61e9);
    expect(facts.sizeBytes).toBeLessThan(66e9);
    expect(read({ description: '❖ 900 MB / 22.4 GB' }).sizeBytes).toBe(900 * MiB);
  });

  it('reads Jackettio stats without spaces, and its progress line', () => {
    const facts = read({
      name: '[AD] Jackettio 1080p',
      description:
        'Nightshade.2024.1080p.WEBRip.x264.AAC5.1-GRP\n💾2.1 GB 👥310 ⚙️harbourindex 🇫🇷\n⬇️ 42% 3.1 MB/s',
    });
    expect(facts).toMatchObject({
      resolution: '1080p',
      releaseSource: 'WEBRip',
      audio: ['AAC'],
      channels: '5.1',
      sizeBytes: Math.round(2.1 * GiB),
      seeders: 310,
      cached: false,
      service: 'AD',
      languages: ['fr'],
    });
  });

  it('reads the TorBox addon\'s "Size: … | Source:" and "Type: … | Seeders:"', () => {
    const facts = read({
      name: 'TorBox (Instant TB) (2160p)',
      description:
        'Quality: WEB-DL\nName: Divide.S02E10.2160p.ATVP.WEB-DL.DDP5.1.Atmos.DV.HDR.H.265-FLUX.mkv\nSize: 8.4 GB | Source: StarTracker\nLanguages: English\nType: Torrent | Seeders: 77',
    });
    expect(facts).toMatchObject({
      resolution: '2160p',
      hdr: ['DV', 'HDR'],
      sizeBytes: Math.round(8.4 * GiB),
      seeders: 77,
      cached: true,
      service: 'TB',
      languages: ['en'],
    });
  });

  it('reads Peerflix, Orion and Debridio', () => {
    expect(
      read({
        name: '[RD+] Peerflix 🇪🇸 4K',
        description:
          'Lanternfall [4K UHD 2160p HEVC X265][DTS 5.1 Castellano DTS 5.1-Ingles+Subs][ES-EN]\n  👤 1 💾 20.38 GB 🌐 Peerflix',
      }),
    ).toMatchObject({
      resolution: '2160p',
      audio: ['DTS'],
      channels: '5.1',
      seeders: 1,
      cached: true,
      service: 'RD',
      languages: ['es', 'en'],
    });
    expect(
      read({
        name: '🚀 ORION\n[Offcloud]',
        description:
          'Lanternfall.&.Ember.(2024).(2160p.BluRay.x265.10bit.DV.HDR.TrueHD.Atmos.7.1.English. French. Spanish.r00t) [QxR]\n📺4K 💾22.8 GB 🎥h265 🔊7.1\n👂EN FR ES ☁️Index42',
      }),
    ).toMatchObject({
      resolution: '2160p',
      cached: true,
      service: 'OC',
      languages: ['en', 'fr', 'es'],
    });
    expect(read({ name: '[ED ⚡] \nDebridio 4k' })).toMatchObject({
      resolution: '2160p',
      cached: true,
      service: 'ED',
    });
  });
});

describe('describeStream, reviewed: titles', () => {
  it('does not read a source, codec or language out of a film title', () => {
    expect(read({ description: 'Cam.2018.1080p.NF.WEB-DL.DDP5.1.x264-NTG' }).releaseSource).toBe(
      'WEB-DL',
    );
    expect(read({ description: "Charlotte's.Web.2006.1080p.BluRay.x264-GRP" }).releaseSource).toBe(
      'BluRay',
    );
    expect(read({ description: 'Dark.Web.Cicada.3301.2021.1080p.BluRay.x264' }).releaseSource).toBe(
      'BluRay',
    );
    const opus = read({ description: 'Mr.Hollands.Opus.1995.1080p.BluRay.DTS.x264-GRP' });
    expect(opus.audio).toEqual(['DTS']);
    expect(opus.mainAudio).toBe('DTS');
    expect(read({ description: 'The.Italian.Job.2003.1080p.BluRay.x264' }).languages).toEqual([]);
    expect(read({ description: 'English.Vinglish.2012.Hindi.1080p' }).languages).toEqual(['hi']);
    expect(read({ description: 'Dual.2022.1080p.WEB-DL.DD5.1.H.264' }).languages).toEqual([]);
    expect(read({ description: 'Stereo.1969.1080p.BluRay.x264' }).channels).toBeUndefined();
    expect(read({ description: 'The.French.Dispatch.S01E01.720p' }).languages).toEqual([]);
  });

  it('still reads those words after the year, in tags and on lines without a year', () => {
    expect(read({ description: 'The.Italian.Job.2003.iTALiAN.ENG.1080p' }).languages).toEqual([
      'it',
      'en',
    ]);
    expect(read({ description: '[CAM] Film 2025' }).releaseSource).toBe('CAM');
    expect(read({ description: 'Film 2025 CAM' }).releaseSource).toBe('CAM');
    expect(read({ name: 'Torrentio\nCAM' }).releaseSource).toBe('CAM');
    expect(read({ description: 'Film.2025.WEB.1080p.x264' }).releaseSource).toBe('WEB-DL');
    expect(read({ description: '💿 WEB|HDR|hevc|BraD' }).releaseSource).toBe('WEB-DL');
    expect(read({ description: 'Film 2016 Hindi 5 1 English 5 1' })).toMatchObject({
      channels: '5.1',
      languages: ['hi', 'en'],
    });
    expect(read({ description: '🔊 Opus 5.1' }).mainAudio).toBe('Opus');
  });

  it('does not take a number in a title for channels', () => {
    expect(
      read({ description: 'Ghost.in.the.Shell.2.0.2008.1080p.BluRay.DTS-HD.MA.5.1.x264' }).channels,
    ).toBe('5.1');
    expect(read({ description: '2.0.2018.1080p.WEB-DL.Hindi.DD5.1.x264' })).toMatchObject({
      channels: '5.1',
      languages: ['hi'],
    });
    expect(read({ description: 'Ghost.in.the.Shell.2.0.2008.1080p' }).channels).toBeUndefined();
  });

  it('does not read a year or a number in a title as the resolution', () => {
    expect(read({ description: 'Neon.Courier.2049.2017.1080p.BluRay' }).resolution).toBe('1080p');
    expect(read({ description: 'Film.2160.2020.1080p' }).resolution).toBe('1080p');
    expect(read({ description: 'Room 1080 (2020) 720p' }).resolution).toBe('720p');
    expect(read({ description: 'Film 2160' }).resolution).toBeUndefined();
  });
});

describe('describeStream, reviewed: tokens', () => {
  it('reads glued and dotted audio and codec names', () => {
    expect(read({ description: 'Film.2020.1080p.BluRay.x265.10bit.AAC5.1' })).toMatchObject({
      videoCodec: 'HEVC',
      bitDepth: 10,
      audio: ['AAC'],
      channels: '5.1',
    });
    expect(read({ description: 'Film.2020.x265-10bit' }).bitDepth).toBe(10);
    expect(read({ description: 'Film.WEB-DL.DDP5.1.H.264' })).toMatchObject({
      videoCodec: 'H.264',
      audio: ['DD+'],
      channels: '5.1',
    });
    expect(read({ description: 'Film.WEB-DL.AAC2.0.H.264' })).toMatchObject({
      audio: ['AAC'],
      channels: '2.0',
    });
    expect(read({ description: 'Film.BluRay.DTS-HD.MA.7.1.x264' })).toMatchObject({
      audio: ['DTS-HD MA'],
      channels: '7.1',
    });
    expect(read({ description: 'Film DTS-HDMA 5.1' }).audio).toEqual(['DTS-HD MA']);
    expect(read({ description: 'Film.EAC3.5.1' })).toMatchObject({
      audio: ['DD+'],
      channels: '5.1',
    });
    expect(read({ description: 'Film.DD2.0' })).toMatchObject({ audio: ['DD'], channels: '2.0' });
    expect(read({ description: 'Film LPCM 2.0' })).toMatchObject({
      audio: ['PCM'],
      channels: '2.0',
    });
    expect(read({ description: 'Film FLAC2.0' })).toMatchObject({
      audio: ['FLAC'],
      channels: '2.0',
    });
    expect(read({ description: 'Film H 265' }).videoCodec).toBe('HEVC');
    expect(read({ description: 'Film x.264' }).videoCodec).toBe('H.264');
  });

  it('tells Atmos on DD+ from Atmos on TrueHD', () => {
    const web = read({ description: 'Film.2160p.WEB-DL.DDP5.1.Atmos.H.265' });
    expect(web.audio).toEqual(['Atmos', 'DD+']);
    expect(web.mainAudio).toBe('DD+');
    const disc = read({ description: 'Film.2160p.BluRay.TrueHD.7.1.Atmos.HEVC' });
    expect(disc.audio).toEqual(['Atmos', 'TrueHD']);
    expect(disc.mainAudio).toBe('TrueHD');
    expect(read({ description: '🎵 Atmos|EAC3' }).mainAudio).toBe('DD+');
    expect(read({ description: 'Film Dolby Atmos' }).mainAudio).toBeUndefined();
  });

  it('reads upper case, underscores and brackets the same as dots', () => {
    const want = {
      resolution: '2160p',
      hdr: ['DV', 'HDR10'],
      videoCodec: 'HEVC',
      audio: ['Atmos', 'TrueHD'],
      channels: '7.1',
      releaseSource: 'REMUX',
    };
    expect(
      read({ description: 'FILM.2020.2160P.UHD.BLURAY.REMUX.DV.HDR10.HEVC.TRUEHD.ATMOS.7.1-GRP' }),
    ).toMatchObject(want);
    expect(
      read({ description: 'Film_2020_2160p_UHD_BluRay_REMUX_DV_HDR10_HEVC_TrueHD_Atmos_7.1-GRP' }),
    ).toMatchObject(want);
    expect(
      read({
        description:
          '[GRP] Film (2020) [2160p] [UHD BluRay REMUX] [DV HDR10] [HEVC] [TrueHD Atmos 7.1]',
      }),
    ).toMatchObject(want);
  });

  it('does not read release groups as codecs, HDR or languages', () => {
    const ctrl = read({ description: 'Film.2020.1080p.BluRay.DD5.1.x264-CtrlHD' });
    expect(ctrl).toMatchObject({ resolution: '1080p', audio: ['DD'], hdr: [], languages: [] });
    expect(read({ description: 'Film.2020.2160p.WEB.x265-HDRinVayu' }).hdr).toEqual([]);
    expect(read({ description: 'Film.2020.1080p.WEB-DL.x264-ION10' }).bitDepth).toBeUndefined();
    expect(read({ description: 'Film.2020.1080p.BluRay.x264-HDS' }).resolution).toBe('1080p');
    expect(read({ description: 'Film.2020.1080p.WEB.H264-DTSiDE' }).audio).toEqual([]);
    expect(read({ description: 'Film.2020.1080p.WEB.H264-ENGiNE' }).languages).toEqual([]);
    expect(read({ description: 'Film.2020.1080p.BluRay.x264-SPARKS[TGx]' }).languages).toEqual([]);
  });

  it('does not see HDR or Dolby Vision inside other words', () => {
    expect(read({ description: 'Film.2019.720p.HDRip.x264' }).hdr).toEqual([]);
    expect(read({ description: 'Film 2019 1080p HDRezka' }).hdr).toEqual([]);
    expect(read({ description: 'Film.2019.DVDRip.XviD' }).hdr).toEqual([]);
    expect(read({ description: 'Film.2019.HDDVD.x264' }).hdr).toEqual([]);
    expect(read({ description: 'Film.2019.DV.HDR10Plus.HEVC' }).hdr).toEqual(['DV', 'HDR10+']);
  });

  it('tells the .ts container from a telesync in file names and links', () => {
    // The extension is gone already, so a "TS" before it is the release's own.
    expect(read({ behaviorHints: { filename: 'Film.2025.720p.TS.mkv' } })).toMatchObject({
      releaseSource: 'TS',
      container: 'mkv',
    });
    expect(read({ url: 'https://cdn.example.org/Film.2025.720p.TS.mkv' })).toMatchObject({
      releaseSource: 'TS',
      container: 'mkv',
    });
    const container = read({ behaviorHints: { filename: 'Final.2024.1080p.HDTV.ts' } });
    expect(container).toMatchObject({ releaseSource: 'HDTV', container: 'ts' });
    expect(read({ url: 'https://cdn.example.org/live/master.ts' }).releaseSource).toBeUndefined();
    expect(read({ description: 'Film.2025.TSRip.x264' }).releaseSource).toBe('TS');
    expect(read({ description: 'Film.2025.HDTSRip' }).releaseSource).toBe('TS');
    expect(read({ description: 'Film.2025.HDCAMRip' }).releaseSource).toBe('CAM');
    expect(read({ description: 'Shorts.2020.1080p.WEB' }).releaseSource).toBe('WEB-DL');
  });

  it('reads "Full HD" as 1080p', () => {
    expect(read({ name: 'Addon\nFull HD' }).resolution).toBe('1080p');
    expect(read({ description: 'Pelicula [FullHD]' }).resolution).toBe('1080p');
    expect(
      read({ name: 'Brazuca\n4k', behaviorHints: { filename: 'Film.1080p.mkv' } }).resolution,
    ).toBe('1080p');
  });
});

describe('describeStream, reviewed: sizes, seeders and cache marks', () => {
  it('reads decimal commas and glued units', () => {
    expect(read({ description: '💾 1,2 GB' }).sizeBytes).toBe(Math.round(1.2 * GiB));
    expect(read({ description: 'Size: 1.2GB' }).sizeBytes).toBe(Math.round(1.2 * GiB));
    expect(read({ description: '💾 4.2 GB' }).sizeBytes).toBe(Math.round(4.2 * GiB));
    expect(read({ description: '📦 7.94 GB 📊 12.5 Mbps' }).sizeBytes).toBe(Math.round(7.94 * GiB));
    expect(read({ description: '📊 12.5 Mbps 📦 7.94 GB' }).sizeBytes).toBe(Math.round(7.94 * GiB));
    // A release name's own size is used only when the addon gives none.
    expect(read({ description: 'Film 2020 720p BluRay x264 [800MB]' }).sizeBytes).toBe(800 * MiB);
    expect(
      read({ description: 'Film.2020.720p.BluRay.x264.800MB-Pahe' }).sizeBytes,
    ).toBeUndefined();
  });

  it('reads seeders in every addon style', () => {
    expect(read({ description: '👤 47 💾 40.33 GB' }).seeders).toBe(47);
    expect(read({ description: '💾33.82 GiB👤61 ⚙️StarTracker' }).seeders).toBe(61);
    expect(read({ description: '📦 61.2 GB 👥 45 📅 3d' }).seeders).toBe(45);
    expect(read({ description: '💾2.1 GB 👥310 ⚙️yfs' }).seeders).toBe(310);
    expect(read({ description: '📦 7.94 GB 🌱 230 ' }).seeders).toBe(230);
    expect(read({ description: '◈ 3.1 GB ⇄ 12❦' }).seeders).toBe(12);
    expect(read({ description: 'Type: Torrent | Seeders: 77' }).seeders).toBe(77);
    expect(read({ description: '👤 1,532' }).seeders).toBe(1532);
    expect(read({ description: '📦 2.43 GB / 33.48 GB 👤 0' }).seeders).toBe(0);
  });

  it('reads cache marks with and without the variation selector', () => {
    expect(read({ name: '[RD⚡️] Comet 2160p' })).toMatchObject({ cached: true, service: 'RD' });
    expect(read({ name: '[RD⚡] Comet 2160p' })).toMatchObject({ cached: true, service: 'RD' });
    expect(read({ name: '[TB⬇️] Comet 1080p' })).toMatchObject({ cached: false, service: 'TB' });
    expect(read({ name: '[TB⬇] Comet 1080p' })).toMatchObject({ cached: false, service: 'TB' });
    expect(read({ name: '[RD☁️⚡] Comet 2160p' })).toMatchObject({ cached: true, service: 'RD' });
    expect(read({ name: 'MediaFusion 🧲 PM ⏳ 4k' })).toMatchObject({
      cached: false,
      service: 'PM',
    });
    expect(read({ name: '🕵️\u200d♂️ 🔑 [Putio+] Torrentio 1080p' })).toMatchObject({
      cached: true,
      service: 'Putio',
    });
    expect(read({ name: '[P2P] Torrentio 720p' }).cached).toBeUndefined();
    expect(
      read({ name: 'HBI+', description: 'Film [DTS 5.1-Ingles+Subs]' }).cached,
    ).toBeUndefined();
  });
});

describe('describeStream, reviewed: the link', () => {
  it("reads nothing from the link's host, query or fragment", () => {
    const empty = { hdr: [], audio: [], languages: [] };
    for (const url of [
      'https://hevc-2160p-hdr10-truehd.example.org:8443/play?quality=2160p&codec=hevc&audio=truehd&lang=fr&size=40GB',
      'https://cdn.example.org?file=/movies/Film.2160p.DV.TrueHD.Atmos.mkv',
      'https://cdn.example.org#/Film.2160p.DV.mkv',
      'https://user:2160p@cdn.example.org/play#Film.2160p.mkv',
      'https://cdn.example.org/resolve/realdebrid/KEY/stream?filename=Film.2160p.HDR.mkv&token=KEY',
    ]) {
      expect(read({ url }), url).toEqual(empty);
    }
  });

  it('keeps only facts from fixed lists, never text from the link', () => {
    const facts = read({
      name: '[RD+] Torrentio\n4k',
      url: 'https://torrentio.example.org/resolve/realdebrid/KEY/0123456789abcdef/null/0/Film.2020.2160p.DV.HDR10.HEVC.TrueHD.Atmos.7.1.mkv?token=KEY#frag',
    });
    expect(facts).toMatchObject({ resolution: '2160p', container: 'mkv', service: 'RD' });
    const text = JSON.stringify(facts).toLowerCase();
    for (const part of [
      'http',
      'torrentio',
      'example',
      'resolve',
      'key',
      'token',
      'frag',
      '0123',
    ]) {
      expect(text).not.toContain(part);
    }
  });
});

describe('describeStream, reviewed: speed', () => {
  const PARSED = (fixture as unknown as { streams: unknown[] }).streams
    .map((raw) => parseStream(raw))
    .filter((stream): stream is Stream => stream !== undefined);

  it('reads 5000 streams well within half a second', () => {
    const streams: Stream[] = [];
    for (let i = 0; i < 5000; i++) {
      const base = PARSED[i % PARSED.length]!;
      // Different text each time, so nothing can be cached by the engine.
      streams.push({ ...base, description: (base.description ?? '') + ` #${i}` });
    }
    for (const stream of PARSED) describeStream(stream);
    const start = Date.now();
    for (const stream of streams) describeStream(stream);
    expect(Date.now() - start).toBeLessThan(500);
  });

  it('stays linear on long careless text, such as one line full of title words', () => {
    const inputs = [
      'web '.repeat(25000) + 'Film 2020',
      'english cam opus '.repeat(6000) + '2020',
      '2.0 '.repeat(25000) + '2020',
      'dd.'.repeat(33000),
      '.ts '.repeat(25000),
      '💾 1.'.repeat(20000),
      '1'.repeat(100000) + ' GB',
    ];
    for (const description of inputs) {
      const stream = parseStream({ url: 'https://example.org/play', description })!;
      const start = Date.now();
      describeStream(stream);
      expect(Date.now() - start, description.slice(0, 20)).toBeLessThan(200);
    }
  });
});
