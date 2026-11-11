import { describe, expect, it } from 'vitest';
import { releaseGroup } from './release';

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
