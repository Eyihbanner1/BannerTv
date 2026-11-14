import { describe, expect, it } from 'vitest';
import { parseSubtitle, parseSubtitlesResponse } from './subtitles';

// Files from the live OpenSubtitles v3 addon's answers of 14 November 2026, trimmed: the
// download links are shortened, and the fields BannerTV does not read are left as they came.
const LAST_OF_US_HI = {
  id: '9397119',
  url: 'https://subs5.strem.io/en/download/file/1957967200',
  SubEncoding: 'UTF-8',
  lang: 'eng',
  m: 'i',
  g: '2',
  subtitleFileName: 'The.Last.of.Us.S01E01.1080p.WEB.H264-CAKES-HI.srt',
  movieReleaseName: 'The.Last.of.Us.S01E01.1080p.WEB.H264-CAKES',
  // Wrong: the file is CAKES', as its name says. BannerTV reads the group from the name.
  releaseGroup: 'NTb',
  releaseFormat: 'WEBRip',
  fpsMilli: 23976,
  season: 1,
  episode: 1,
};
const SHAWSHANK_CD1 = {
  id: '68061',
  url: 'https://subs5.strem.io/en/download/file/88133',
  SubEncoding: 'ASCII',
  lang: 'eng',
  m: 'i',
  g: '11',
  subtitleFileName: 'The_Shawshank_Redemption_(1994).CD1.aFLDp.srt',
  movieReleaseName: 'Shawshank Redemption, The (1994)',
  fpsMilli: 23980,
  season: 0,
  episode: 0,
};
// Found by the hash of the video sent with the request.
const NIGHT_OF_THE_LIVING_DEAD = {
  id: '3367057',
  url: 'https://subs5.strem.io/en/download/file/1951969682',
  SubEncoding: 'CP1252',
  lang: 'pob',
  m: 'h',
  g: '14',
  subtitleFileName: 'Night_of_the_Living_Dead.srt',
  movieReleaseName: 'Night_of_the_Living_Dead.avi',
  fpsMilli: 23980,
  season: 0,
  episode: 0,
};
// No release group, and no frame rate.
const DUNE_PART_TWO = {
  id: '9958266',
  url: 'https://subs5.strem.io/en/download/file/1958538703',
  SubEncoding: 'UTF-8',
  lang: 'eng',
  m: 'i',
  g: '',
  subtitleFileName: 'Dune.Part.Two.2024.1080p.AMZN.WEB-DL.DDP5.1.Atmos.H.264.srt',
  movieReleaseName: 'Dune.Part.Two.2024.1080p.WEB-DL.H264.AAC-InMemoryOfEVO',
  season: 0,
  episode: 0,
};

describe('parseSubtitle', () => {
  it('keeps the file name, the release name and the episode OpenSubtitles v3 sends', () => {
    expect(parseSubtitle(LAST_OF_US_HI)).toEqual({
      id: '9397119',
      url: 'https://subs5.strem.io/en/download/file/1957967200',
      lang: 'eng',
      label: 'The.Last.of.Us.S01E01.1080p.WEB.H264-CAKES-HI.srt',
      releaseName: 'The.Last.of.Us.S01E01.1080p.WEB.H264-CAKES',
      fps: 23.976,
      season: 1,
      episode: 1,
    });
  });

  it('gives a film no season or episode, as OpenSubtitles sends 0 for both', () => {
    expect(parseSubtitle(SHAWSHANK_CD1)).toEqual({
      id: '68061',
      url: 'https://subs5.strem.io/en/download/file/88133',
      lang: 'eng',
      label: 'The_Shawshank_Redemption_(1994).CD1.aFLDp.srt',
      releaseName: 'Shawshank Redemption, The (1994)',
      fps: 23.98,
    });
    expect(parseSubtitle(DUNE_PART_TWO)).toEqual({
      id: '9958266',
      url: 'https://subs5.strem.io/en/download/file/1958538703',
      lang: 'eng',
      label: 'Dune.Part.Two.2024.1080p.AMZN.WEB-DL.DDP5.1.Atmos.H.264.srt',
      releaseName: 'Dune.Part.Two.2024.1080p.WEB-DL.H264.AAC-InMemoryOfEVO',
    });
  });

  it('marks a file OpenSubtitles found by the video’s hash, and only that', () => {
    expect(parseSubtitle(NIGHT_OF_THE_LIVING_DEAD)).toMatchObject({ hashMatch: true });
    expect(parseSubtitle(LAST_OF_US_HI)).not.toHaveProperty('hashMatch');
    for (const m of ['H', 'hash', true, 1, null]) {
      expect(parseSubtitle({ ...NIGHT_OF_THE_LIVING_DEAD, m })).not.toHaveProperty('hashMatch');
    }
  });

  it('takes a label first, then a title, then the file name', () => {
    const file = { ...LAST_OF_US_HI, label: 'English (CAKES)', title: 'CAKES, English' };
    expect(parseSubtitle(file)?.label).toBe('English (CAKES)');
    expect(parseSubtitle({ ...file, label: undefined })?.label).toBe('CAKES, English');
    expect(parseSubtitle({ ...file, label: '  ', title: '' })?.label).toBe(
      'The.Last.of.Us.S01E01.1080p.WEB.H264-CAKES-HI.srt',
    );
  });

  it('takes an empty name or a bare extension for no name', () => {
    for (const name of ['', '   ', '.srt', 'srt', ' .SRT ', '.ass']) {
      const file = parseSubtitle({
        ...LAST_OF_US_HI,
        subtitleFileName: name,
        movieReleaseName: name,
      });
      expect(file, JSON.stringify(name)).not.toHaveProperty('label');
      expect(file, JSON.stringify(name)).not.toHaveProperty('releaseName');
    }
    expect(parseSubtitle({ ...LAST_OF_US_HI, subtitleFileName: '  Film.srt  ' })?.label).toBe(
      'Film.srt',
    );
  });

  it('keeps no second name that only repeats the first', () => {
    const same = { ...LAST_OF_US_HI, movieReleaseName: LAST_OF_US_HI.subtitleFileName };
    expect(parseSubtitle(same)).not.toHaveProperty('releaseName');
  });

  it('drops values of the wrong shape, and reads numbers sent as text', () => {
    expect(
      parseSubtitle({
        ...LAST_OF_US_HI,
        subtitleFileName: 42,
        movieReleaseName: { name: 'x' },
        fpsMilli: -25000,
        season: 1.5,
        episode: 'two',
      }),
    ).toEqual({
      id: '9397119',
      url: 'https://subs5.strem.io/en/download/file/1957967200',
      lang: 'eng',
      label: '42',
    });
    expect(
      parseSubtitle({ ...LAST_OF_US_HI, fpsMilli: '25000', season: '2', episode: '7' }),
    ).toMatchObject({ fps: 25, season: 2, episode: 7 });
    for (const bad of [NaN, Infinity, 0, -1, 'none', [], null]) {
      const file = parseSubtitle({ ...LAST_OF_US_HI, fpsMilli: bad, season: bad, episode: bad });
      expect(file).not.toHaveProperty('fps');
      expect(file).not.toHaveProperty('season');
      expect(file).not.toHaveProperty('episode');
    }
  });
});

describe('parseSubtitlesResponse', () => {
  it('reads every file of a live answer, in its order', () => {
    const response = parseSubtitlesResponse({
      subtitles: [NIGHT_OF_THE_LIVING_DEAD, LAST_OF_US_HI, SHAWSHANK_CD1, DUNE_PART_TWO],
    });
    expect(response.subtitles.map((file) => [file.id, file.hashMatch ?? false])).toEqual([
      ['3367057', true],
      ['9397119', false],
      ['68061', false],
      ['9958266', false],
    ]);
    expect(response.dropped).toBe(0);
  });
});
