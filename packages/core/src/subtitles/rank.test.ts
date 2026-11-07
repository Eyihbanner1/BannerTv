import { describe, expect, it } from 'vitest';
import type { SubtitleFit } from './fit';
import { clearlyBetter, fitTier, rankSubtitles, UNREAD_TIER } from './rank';

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

interface File {
  id: string;
  label?: string;
}

const video = { filename: 'Open.Movie.2021.1080p.WEB-DL.x264-GROUP.mkv' };

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
