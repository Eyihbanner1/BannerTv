import { describe, expect, it } from 'vitest';
import {
  isYtsRelease,
  readNameTags,
  releaseEdition,
  releaseGroup,
  releaseService,
  releaseShort,
} from './release';

describe('releaseGroup', () => {
  it('reads the group a release name ends on, lower case', () => {
    expect(releaseGroup('Film.2023.1080p.WEB-DL.DDP5.1.H.264-FLUX')).toBe('flux');
    expect(
      releaseGroup(
        'Lanternfall.2016.UHD.BluRay.2160p.TrueHD.Atmos.7.1.DV.HEVC.HYBRiD.REMUX-FraMeSToR',
      ),
    ).toBe('framestor');
    expect(releaseGroup('Lanternfall 2016 BluRay 1080p DTS-ES AC3 x264-3Li')).toBe('3li');
  });

  it('looks past a file extension, a site tag and spaces at the end', () => {
    expect(releaseGroup('Unwinding.S02E05.720p.WEB.h264-ETHEL.mkv')).toBe('ethel');
    expect(releaseGroup('The.Long.Shore.S01E04.720p.HDTV-NTb.srt')).toBe('ntb');
    expect(releaseGroup('Show.S01E01.720p.HDTV.x264-GRP[showfeed]')).toBe('grp');
    expect(releaseGroup('  Film.2020.1080p.BluRay.x264-AMIABLE  ')).toBe('amiable');
  });

  it('takes no word for a group that only ends a format, source or language', () => {
    for (const name of [
      'Film.2020.1080p.WEB-DL',
      'Film.2020.1080p.Blu-Ray',
      'Film.2020.1080p.BluRay.DTS-HD',
      'Film.2020.1080p.BluRay.DTS-ES',
      'Film.2020.2160p.WEB.H-265',
      'Film.2020.1080p.x-264',
      'Film.2020.720p.BluRay.x264-ITA',
      'Film.2020.720p.BluRay.x264-Castellano',
      'Film.2020.1080p.Dual-Audio',
      'Film.2020.1080p.Multi-Subs',
      'Film.2020.1080p.Multi-Lang',
      'Film.2020.1080p.x264-GRP-sample',
      'Stormglass 2025 1080p CAMRip x264 AAC-NOGRP',
      'Film.2020.1080p-10bit',
      'Film.2020.1080p.x265.10-bit',
      'Film-1080p',
      'Film.2020-4K',
      'Film.2020.2160p-UHD',
      'Film 2020 5-1',
      'Film.2020.1080p.WEB-DLRip',
      'Film.2020.2160p.UHD-BDRip',
      'Film.2020.1080p-Featurette',
      'Film 2020 1080p Dual Latino-Ingles',
      'Show.Complete.S01-S05',
      'Show.S01E01-E02',
      'Show.S01-E02',
    ]) {
      expect(releaseGroup(name), name).toBeUndefined();
    }
  });

  it('gives nothing without a dash and a word of two or more at the end', () => {
    expect(releaseGroup('')).toBeUndefined();
    expect(releaseGroup('Lanternfall [2016] 2160p BDRip x265 Kira [SEV]')).toBeUndefined();
    expect(releaseGroup('Holloway S01 E01 BluRay 1080p x264 ESub - mkvHouse')).toBeUndefined();
    expect(releaseGroup('Kestrel.S03E07.2160p.WEB-DL.H.265-MeM.GP')).toBeUndefined();
    expect(releaseGroup('Film.2020.DTS-X')).toBeUndefined();
  });

  it('reads a long careless line in one pass', () => {
    const line = '-ab['.repeat(25000);
    const start = Date.now();
    expect(releaseGroup(line)).toBeUndefined();
    expect(Date.now() - start).toBeLessThan(200);
  });
});

describe('readNameTags', () => {
  it('reads a subtitle file’s own tags off the end, one at a time, back to the release', () => {
    const release = 'The.Last.of.Us.S01E01.1080p.WEB.H264-CAKES';
    for (const tail of [
      '.srt',
      '-HI.srt',
      '.eng.srt',
      '.en.HI.srt',
      '.English.srt',
      '(SDH).srt',
      '.en[cc].srt',
      '-HI.v2.srt',
      '13_[spa].srt',
      '.HI.C.updated.Addic7ed.com.srt',
      ' [ger].srt',
      '.forced.srt',
      '.pt-BR.srt',
      // A copy's number in brackets, other formats, and tags saying the lines are plain.
      '(1).srt',
      '[2].srt',
      '.smi',
      '.idx',
      '-NHI.srt',
      '-NHI_spa.srt',
      '.NonHI.srt',
      '.Non-HI.en.srt',
    ]) {
      expect(readNameTags(release + tail).release, tail).toBe(release);
    }
    expect(releaseGroup(readNameTags(`${release}-HI.srt`).release)).toBe('cakes');
    expect(releaseGroup(readNameTags(`${release}-NHI.srt`).release)).toBe('cakes');
    expect(releaseGroup(readNameTags('Film.2021.1080p.WEB-DL-GRP(1).srt').release)).toBe('grp');
  });

  it('says whether the file is for the hard of hearing, and which disc it goes with', () => {
    expect(readNameTags('The.Last.of.Us.S01E01.1080p.WEB.H264-CAKES-HI.srt')).toEqual({
      release: 'The.Last.of.Us.S01E01.1080p.WEB.H264-CAKES',
      hearing: true,
    });
    expect(readNameTags('The_Shawshank_Redemption_(1994).CD1.aFLDp.srt')).toMatchObject({
      hearing: false,
      part: 1,
    });
    expect(readNameTags('Film.1994.DVDRip.XviD-HigHoT-CD2.ENG.srt')).toEqual({
      release: 'Film.1994.DVDRip.XviD-HigHoT',
      hearing: false,
      part: 2,
    });
  });

  it('keeps a name of one word, and a title that ends on a language’s name', () => {
    expect(readNameTags('It.srt').release).toBe('It');
    expect(readNameTags('English.srt').release).toBe('English');
    expect(readNameTags('').release).toBe('');
  });
});

describe('isYtsRelease', () => {
  it('knows YTS and YIFY by their tag, never by a word inside another', () => {
    for (const name of [
      'Inception (2010) [1080p] [BluRay] [5.1] [YTS.MX]',
      'Inception.2010.1080p.BluRay.x264-[YTS.AM]',
      'Inception.2010.720p.BrRip.x264.YIFY',
      'Inception 2010 1080p YTS',
    ]) {
      expect(isYtsRelease(name), name).toBe(true);
    }
    for (const name of [
      'Inception.2010.1080p.BluRay.x264-SPARKS',
      'Keyytsu.2020.1080p',
      'YTSE.Jam',
    ]) {
      expect(isYtsRelease(name), name).toBe(false);
    }
  });
});

describe('releaseGroup and a subtitle file’s tags', () => {
  it('takes no subtitle tag for a group', () => {
    for (const name of [
      'Film.2021.1080p.WEB-HI',
      'Film.2021.1080p.WEB-SDH',
      'Film.2021-CD1',
      'Film.2021.WEB-v2',
    ]) {
      expect(releaseGroup(name), name).toBeUndefined();
    }
  });
});

describe('releaseService', () => {
  it('reads the streaming service a web release names, as its own word', () => {
    expect(
      releaseService(
        'The.Rainmaker.S01E06.Episode.6.2160p.10bit.AMZN.WEB-DL.DDP5.1.HEVC-Vyndros.mkv',
      ),
    ).toBe('amzn');
    expect(releaseService('The.Rainmaker.S01E06.1080p.AMZN.WEB-DL.DDP5.1.H.264-FLUX')).toBe('amzn');
    expect(releaseService('The.Rainmaker.S01E01.2160p.STAN.WEB-DL.DDP5.1.HDR.H265-playWEB')).toBe(
      'stan',
    );
    expect(releaseService('The.Bear.S01E01.720p.HULU.WEBRip.x264-GalaxyTV')).toBe('hulu');
    expect(releaseService('Fleabag.S01E01.2160p Amazon WEBRip DD+ 5.1 x264-TrollUHD')).toBe('amzn');
    expect(releaseService('Show.S02E03.1080p.NF.WEBRip.DDP5.1.x264-NTb')).toBe('nf');
    expect(releaseService('Show.S02E03.WEBRip.Netflix.pt')).toBe('nf');
    expect(releaseService('Show.S02E03.1080p.MAX.WEB-DL.DDP5.1.H.264-FLUX')).toBe('hmax');
    expect(releaseService('Show.S02E03.SHO.WEB-DL.AAC2.0.H.264-NTb')).toBe('sho');
    expect(releaseService('Show.S02E03.Showtime.720p')).toBe('sho');
    expect(releaseService('Show.S02E03.1080p.PCOK.WEBRip.x264-GRP')).toBe('pcok');
    expect(releaseService('Show.S02E03.2160p.DSNP.WEB-DL.DDP5.1.H.265-FLUX')).toBe('dsnp');
  });

  it("reads iTunes and Movies Anywhere only in the name's own case", () => {
    expect(releaseService('Film.2019.1080p.iT.WEB-DL.DD5.1.H.264-GRP')).toBe('itunes');
    expect(releaseService('film.2019.1080p.it.web-dl.dd5.1.h.264-grp')).toBeUndefined();
    expect(releaseService('Film.2019.1080p.MA.WEB-DL.DDP5.1.H.264-GRP')).toBe('ma');
  });

  it('says nothing for a name with no service, or a title word that looks like one', () => {
    expect(releaseService('The.Rainmaker.S01E06.WEB.REAL')).toBeUndefined();
    expect(releaseService('Mad.Max.Fury.Road.2015.1080p.BluRay')).toBeUndefined();
    expect(releaseService('Stan.and.Ollie.2018.1080p.BluRay')).toBeUndefined();
    expect(releaseService('Amazonia.2013.1080p.BluRay.x264-GRP')).toBeUndefined();
    expect(releaseService('Show.S01E01.720p.HDTV.x264-NFC')).toBeUndefined();
  });
});

describe('releaseEdition', () => {
  it('reads an edition that changes the cut', () => {
    expect(releaseEdition('Film.2001.Extended.Cut.1080p.BluRay.x264-GRP')).toBe('extended');
    expect(releaseEdition("Film.2001.Director's.Cut.1080p.BluRay")).toBe('directors cut');
    expect(releaseEdition('Film.2001.Directors.Cut.1080p.BluRay')).toBe('directors cut');
    expect(releaseEdition('Film.2001.UNRATED.720p.BluRay')).toBe('unrated');
    expect(releaseEdition('Film.2001.Final.Cut.2160p.UHD.BluRay')).toBe('final cut');
  });

  it('says nothing for a plain name', () => {
    expect(releaseEdition('Film.2001.1080p.BluRay.x264-GRP')).toBeUndefined();
    expect(releaseEdition('The.Rainmaker.S01E06.WEB.REAL')).toBeUndefined();
  });
});

describe('releaseShort', () => {
  it('keeps what tells copies apart, without the title, episode or episode name', () => {
    expect(releaseShort('The.Long.Road.North.S01E04.1080p.WEB.H264-NTb.srt')).toBe(
      '1080p WEB H264 · NTb',
    );
    expect(releaseShort('The.Long.Road.North.S01E04.Ashfall.1080p.WEB.H264-NTb.en.srt')).toBe(
      '1080p WEB H264 · NTb',
    );
    expect(
      releaseShort('Harbour.Lights.S02E10.The.Last.Tide.1080p.AMZN.WEB-DL.DDP5.1.H.264-FLUX'),
    ).toBe('1080p AMZN WEB-DL DDP5.1 H.264 · FLUX');
  });

  it('reads a stream title written with spaces, its channels and codec put back together', () => {
    expect(
      releaseShort('The Long Road North S01E04 Ashfall 2160p AMZN WEB-DL DD 5 1 Atmos H 265-NTb'),
    ).toBe('2160p AMZN WEB-DL DD 5.1 Atmos H.265 · NTb');
  });

  it("starts after a film's year, the first one a title with a year in it", () => {
    expect(releaseShort('Film.2023.1080p.WEB-DL.DDP5.1.H.264-FLUX')).toBe(
      '1080p WEB-DL DDP5.1 H.264 · FLUX',
    );
    expect(releaseShort('Charlottes.Web.2006.1080p.BluRay.x264-AMIABLE')).toBe(
      '1080p BluRay x264 · AMIABLE',
    );
    expect(releaseShort('Orbit.2049.2017.2160p.UHD.BluRay.x265-GRP')).toBe(
      '2160p UHD BluRay x265 · GRP',
    );
  });

  it("leaves off a subtitle file's own tags and a name with no group", () => {
    expect(releaseShort('Show.S01E01.720p.HDTV.x264-CAKES-HI.srt')).toBe('720p HDTV x264 · CAKES');
    expect(releaseShort('Film.2020.1080p.WEB-DL')).toBe('1080p WEB-DL');
    expect(
      releaseShort(
        'Lanternfall.2016.UHD.BluRay.2160p.TrueHD.Atmos.7.1.DV.HEVC.HYBRiD.REMUX-FraMeSToR',
      ),
    ).toBe('UHD BluRay 2160p TrueHD Atmos 7.1 DV HEVC HYBRiD REMUX · FraMeSToR');
  });

  it('says nothing for a name with only a title and episode', () => {
    expect(releaseShort('Harbour.Lights.S02E10.srt')).toBeUndefined();
    expect(releaseShort('Harbour Lights S02E10 The Last Tide')).toBeUndefined();
    expect(releaseShort('')).toBeUndefined();
  });
});
