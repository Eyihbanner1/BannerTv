import { afterEach, describe, expect, it } from 'vitest';
import type { SubtitleFit } from './fit';
import { clearlyBetter, fileTier, fitTier, rankReason, rankSubtitles, UNREAD_TIER } from './rank';

const FITS: SubtitleFit = {
  script: 'right',
  signs: false,
  hearing: false,
  length: 'fits',
  unfit: false,
};
const SDH: SubtitleFit = { ...FITS, hearing: true };
const DRIFTS: SubtitleFit = { ...FITS, drift: 'behind' };
const HALF: SubtitleFit = { ...FITS, length: 'short' };
const SIGNS: SubtitleFit = { ...FITS, signs: true, unfit: true };
const LONG: SubtitleFit = { ...FITS, length: 'long' };

interface File {
  id: string;
  label?: string;
  hashMatch?: boolean;
  season?: number;
  episode?: number;
}

const video = { filename: 'Open.Movie.2021.1080p.WEB-DL.x264-GROUP.mkv' };

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

function rank(
  files: File[],
  fits: Record<string, SubtitleFit>,
  options: { remembered?: string; hearing?: boolean } = {},
) {
  return rankSubtitles(files, {
    video,
    fit: (file) => fits[file.id],
    remembered: (file) => file.id === options.remembered,
    hearing: options.hearing ?? false,
  }).map((file) => file.id);
}

describe('fitTier', () => {
  it('puts a whole fit first, then one for the hard of hearing, a file not read yet, a drift, part of the film', () => {
    expect(fitTier(FITS, false)).toBe(0);
    expect(fitTier(SDH, false)).toBe(1);
    expect(fitTier(undefined, false)).toBe(UNREAD_TIER);
    expect(fitTier(DRIFTS, false)).toBe(2);
    expect(fitTier({ ...DRIFTS, hearing: true }, false)).toBe(3);
    expect(fitTier(HALF, false)).toBe(4);
    expect(fitTier(SIGNS, false)).toBe(5);
  });

  it('puts files for the hard of hearing first once the viewer asked for them', () => {
    expect(fitTier(SDH, true)).toBe(0);
    expect(fitTier(FITS, true)).toBe(1);
  });
});

describe('rankSubtitles', () => {
  it('puts the version picked by hand first, then a release match, then the best fit', () => {
    const files: File[] = [
      { id: 'drifts' },
      { id: 'match', label: 'Open.Movie.2021.1080p.WEB-DL-GROUP' },
      { id: 'fits' },
      { id: 'picked' },
    ];
    const fits = { drifts: DRIFTS, match: SDH, fits: FITS, picked: HALF };
    expect(rank(files, fits, { remembered: 'picked' })).toEqual([
      'picked',
      'match',
      'fits',
      'drifts',
    ]);
    expect(rank(files, fits)).toEqual(['match', 'fits', 'drifts', 'picked']);
  });

  it('puts plain lines before lines for the hard of hearing, unless those were asked for', () => {
    const files = [{ id: 'sdh' }, { id: 'plain' }];
    expect(rank(files, { sdh: SDH, plain: FITS })).toEqual(['plain', 'sdh']);
    expect(rank(files, { sdh: SDH, plain: FITS }, { hearing: true })).toEqual(['sdh', 'plain']);
  });

  it('keeps the addon’s order where nothing tells files apart, however many there are', () => {
    sortUnstably();
    const files = Array.from({ length: 30 }, (_, i) => ({ id: `f${i}` }));
    const fits: Record<string, SubtitleFit> = {};
    for (const file of files) fits[file.id] = FITS;
    fits.f3 = DRIFTS;
    const ranked = rank(files, fits);
    expect(ranked.slice(0, 3)).toEqual(['f0', 'f1', 'f2']);
    expect(ranked[3]).toBe('f4');
    expect(ranked[29]).toBe('f3');
    // Nothing read yet: the addon's order, which may reflect a match on the video's hash.
    expect(rank(files, {})).toEqual(files.map((file) => file.id));
  });

  it('puts a file known to fit before one not read yet, and one not read before a drift', () => {
    const files = [{ id: 'drifts' }, { id: 'unread' }, { id: 'fits' }];
    expect(rank(files, { drifts: DRIFTS, fits: FITS })).toEqual(['fits', 'unread', 'drifts']);
  });

  it('lets a release match count only while the file is not read or reads whole', () => {
    const files: File[] = [
      { id: 'match', label: 'Open.Movie.2021.EXTENDED.1080p.WEB-DL-GROUP' },
      { id: 'fits' },
      { id: 'unread' },
    ];
    // Read as running long, it ranks by its fit like any other.
    expect(rank(files, { match: LONG, fits: FITS })).toEqual(['fits', 'unread', 'match']);
    expect(rank(files, { match: HALF, fits: FITS })).toEqual(['fits', 'unread', 'match']);
    expect(rank(files, { match: DRIFTS, fits: FITS })).toEqual(['fits', 'unread', 'match']);
    // Not read yet, or read whole (even for the hard of hearing), it stays first.
    expect(rank(files, { fits: FITS })).toEqual(['match', 'fits', 'unread']);
    expect(rank(files, { match: SDH, fits: FITS })).toEqual(['match', 'fits', 'unread']);
    // Picked by hand, it stays first whatever its checks found.
    expect(rank(files, { match: LONG, fits: FITS }, { remembered: 'match' })).toEqual([
      'match',
      'fits',
      'unread',
    ]);
  });
});

describe('rankReason', () => {
  const match = { id: 'match', label: 'Open.Movie.2021.1080p.WEB-DL-GROUP' };
  const other = { id: 'other', label: 'Another.Film.1999.DVDRip-XYZ' };

  it('puts the version picked by hand first, then a release match, then neither', () => {
    expect(rankReason(match, { video, remembered: (file) => file === match })).toBe(0);
    expect(rankReason(match, { video })).toBe(1);
    expect(rankReason(other, { video })).toBe(2);
  });

  it('takes a match read as drifting, covering part, running long or unfit for no match', () => {
    const reason = (fit: SubtitleFit | undefined, hearing = false) =>
      rankReason(match, { video, fit: () => fit, hearing });
    expect(reason(undefined)).toBe(1);
    expect(reason(FITS)).toBe(1);
    expect(reason(SDH)).toBe(1);
    expect(reason(FITS, true)).toBe(1);
    expect(reason(DRIFTS)).toBe(2);
    expect(reason(HALF)).toBe(2);
    expect(reason(LONG)).toBe(2);
    expect(reason(SIGNS)).toBe(2);
    expect(rankReason(match, { video, fit: () => LONG, remembered: () => true })).toBe(0);
  });
});

describe('hash, disc and episode', () => {
  it('ranks a file found by the video’s hash as made for the release, before one named for it', () => {
    const files = [
      { id: 'plain' },
      { id: 'named', label: 'Open.Movie.2021.1080p.WEB-DL.x264-GROUP-HI.srt' },
      { id: 'hash', label: 'Open_Movie.srt', hashMatch: true },
    ];
    expect(rankReason(files[2]!, { video })).toBe(1);
    expect(rank(files, {})).toEqual(['hash', 'named', 'plain']);
    // Read as drifting, it ranks by its fit like any other.
    expect(rank(files, { hash: DRIFTS, plain: FITS })).toEqual(['named', 'plain', 'hash']);
  });

  it('puts a loosely named file before another only where they fit as well', () => {
    const files = [{ id: 'a' }, { id: 'loose', label: 'Open.Movie.2021.1080p.WEB-DL.srt' }];
    expect(rankReason(files[1]!, { video })).toBe(2);
    expect(rank(files, {})).toEqual(['loose', 'a']);
    expect(rank(files, { a: FITS })).toEqual(['a', 'loose']);
  });

  it('takes one disc of two for part of the video until it is read against its length', () => {
    const cd1 = { id: 'cd1', label: 'Open.Movie.2021.1080p.WEB-DL.x264-GROUP.CD1.srt' };
    expect(fileTier(cd1, undefined, video, false)).toBe(4);
    // Read while the video's length is not known yet: still part of it.
    expect(fileTier(cd1, { ...FITS, length: undefined }, video, false)).toBe(4);
    // Read against the video's length and found whole: judged by that.
    expect(fileTier(cd1, FITS, video, false)).toBe(0);
    expect(rank([cd1, { id: 'whole' }], {})).toEqual(['whole', 'cd1']);
    expect(rankReason(cd1, { video })).toBe(2);
  });

  it('takes a file for another episode for unfit, whatever reading finds', () => {
    const episode = { filename: 'Show.S01E01.1080p.WEB.H264-CAKES.mkv', season: 1, episode: 1 };
    const e2 = { id: 'e2', label: 'Show.S01E02.1080p.WEB.H264-CAKES.srt' };
    expect(fileTier(e2, FITS, episode, false)).toBe(5);
    expect(fileTier({ season: 1, episode: 2 }, undefined, episode, false)).toBe(5);
    expect(fileTier({ label: 'Show.S01E01.srt' }, FITS, episode, false)).toBe(0);
  });

  it('puts a file named for the hard of hearing after a plain one while neither is read', () => {
    const files = [
      { id: 'sdh', label: 'Film.2021.HI.srt' },
      { id: 'plain', label: 'Film.2021.srt' },
    ];
    expect(rank(files, {})).toEqual(['plain', 'sdh']);
    expect(rank(files, {}, { hearing: true })).toEqual(['sdh', 'plain']);
  });
});

describe('clearlyBetter', () => {
  it('switches only to a file read and fitting a whole step better', () => {
    expect(clearlyBetter(FITS, DRIFTS, false)).toBe(true);
    expect(clearlyBetter(FITS, SDH, false)).toBe(true);
    expect(clearlyBetter(DRIFTS, HALF, false)).toBe(true);
    expect(clearlyBetter(FITS, FITS, false)).toBe(false);
    expect(clearlyBetter(SDH, FITS, false)).toBe(false);
    expect(clearlyBetter(undefined, DRIFTS, false)).toBe(false);
    expect(clearlyBetter(FITS, undefined, false)).toBe(false);
    expect(clearlyBetter(SDH, FITS, true)).toBe(true);
  });
});
