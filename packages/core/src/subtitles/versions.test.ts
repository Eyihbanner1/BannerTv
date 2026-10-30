import { describe, expect, it } from 'vitest';
import { keepOrder, numberBySource, releaseMatch } from './versions';

describe('releaseMatch', () => {
  const episode = {
    filename: 'The.Long.Shore.S01E04.1080p.WEB-DL.DDP5.1.H.264-NTb.mkv',
    title: 'The Long Shore S01E04 1080p WEB-DL',
  };

  it('matches a release name that agrees on at least two facts and differs on none', () => {
    expect(releaseMatch('The.Long.Shore.S01E04.1080p.WEB-DL', episode)).toBe(true);
    // WEBRip and WEB-DL come from the same web source, with the same timing.
    expect(releaseMatch('The Long Shore S01E04 WEBRip', episode)).toBe(true);
    expect(releaseMatch('The.Long.Shore.S01E04.720p.HDTV-NTb.srt', episode)).toBe(false);
    expect(releaseMatch('The.Long.Shore.S01E05.1080p.WEB-DL', episode)).toBe(false);
  });

  it('says nothing when a name gives too little to go on', () => {
    expect(releaseMatch('Long.Shore.104', episode)).toBe(false);
    expect(releaseMatch('English', episode)).toBe(false);
    expect(releaseMatch('The.Long.Shore.S01E04', episode)).toBe(false);
    expect(releaseMatch(undefined, episode)).toBe(false);
    expect(releaseMatch('The.Long.Shore.S01E04.1080p.WEB-DL', {})).toBe(false);
  });

  it('reads the group after the last dash, never the DL of WEB-DL', () => {
    const film = { filename: 'Open.Movie.2160p.UHD.BluRay.x265-GROUPX.mkv' };
    expect(releaseMatch('Open.Movie.BluRay-GROUPX', film)).toBe(true);
    expect(releaseMatch('Open.Movie.BluRay-OTHER', film)).toBe(false);
    expect(releaseMatch('Open.Movie.4K.WEB-DL', film)).toBe(false);
  });

  it('fills what the file name leaves out from the title', () => {
    const video = { filename: 'movie-1080p.webm', title: 'Open Movie 1080p WEB-DL x264' };
    expect(releaseMatch('Open.Movie.1080p.WEB-DL', video)).toBe(true);
    expect(releaseMatch('Open.Movie.720p.BluRay', video)).toBe(false);
  });

  it('takes the file name over the title where they differ', () => {
    const video = { filename: 'Film.720p.BluRay.mkv', title: 'Film 1080p WEB' };
    expect(releaseMatch('Film.720p.BluRay', video)).toBe(true);
    expect(releaseMatch('Film.1080p.WEB', video)).toBe(false);
  });

  it('does not take a title word for the source when the name gives one', () => {
    const video = { filename: "Charlotte's.Web.1973.1080p.BluRay.x264-AMIABLE.mkv" };
    expect(releaseMatch("Charlotte's.Web.1973.1080p.BluRay", video)).toBe(true);
    expect(releaseMatch("Charlotte's.Web.1973.1080p.WEB-DL", video)).toBe(false);
  });
});

describe('numberBySource', () => {
  it('numbers the files of a source that sent several, and leaves a lone one plain', () => {
    const files = [
      { id: 'a', source: 'OpenSubtitles' },
      { id: 'b', source: 'SubDL' },
      { id: 'c', source: 'OpenSubtitles' },
      { id: 'd', source: 'OpenSubtitles' },
    ];
    expect(numberBySource(files).map(({ item, number }) => [item.id, number])).toEqual([
      ['a', 1],
      ['b', undefined],
      ['c', 2],
      ['d', 3],
    ]);
    expect(numberBySource([])).toEqual([]);
  });
});

describe('keepOrder', () => {
  it('keeps the rows shown in their places and puts new ones after them', () => {
    expect(keepOrder([], ['en', 'fr'])).toEqual(['en', 'fr']);
    // An addon earlier in the list answered late with German.
    expect(keepOrder(['en', 'fr'], ['de', 'en', 'fr', 'es'])).toEqual(['en', 'fr', 'de', 'es']);
    // Another stream's list: what it no longer has goes.
    expect(keepOrder(['en', 'fr', 'de'], ['fr', 'it'])).toEqual(['fr', 'it']);
    // Given twice, kept once.
    expect(keepOrder(['en'], ['fr', 'fr', 'en'])).toEqual(['en', 'fr']);
  });
});
