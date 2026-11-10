import { describe, expect, it } from 'vitest';
import {
  chooseFit,
  contentFitFor,
  EARLIER_FIT_KEY,
  FILL,
  FIT,
  type FitStorage,
  fitFor,
  isFill,
  isFit,
  keptFrame,
  MAX_FIT_TITLES,
  MAX_SIZE,
  type PictureFits,
  type PictureFrame,
  PICTURE_FITS_KEY,
  pictureFitStore,
  pinchFit,
  readPictureFits,
  readPictureFrame,
  touchSpread,
  writePictureFits,
  writePictureFrame,
} from './picture-fit';

function memory(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial));
  const storage: FitStorage = {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => {
      items.set(key, value);
    },
  };
  return { items, storage };
}

/** Choices with `film` as films' last choice and `live` (the same unless given) as live's. */
function fits(
  film: PictureFrame,
  titles: Array<[string, PictureFrame]> = [],
  live: PictureFrame = film,
): PictureFits {
  return { last: { live, film }, titles: new Map(titles) };
}

/** What is stored, as plain data. */
function stored(items: Map<string, string>): unknown {
  const raw = items.get(PICTURE_FITS_KEY);
  return raw === undefined ? undefined : JSON.parse(raw);
}

/**
 * How the update before this one read what is stored (picture-fit.ts as it was): 'fill' is fill,
 * and anything else the whole picture.
 */
function earlierUpdateReads(raw: string): { last: string; titles: Array<[string, string]> } {
  const read = (value: unknown) => (value === 'fill' ? 'fill' : 'fit');
  const saved = JSON.parse(raw) as { last?: unknown; titles: unknown[] };
  return {
    last: read(saved.last),
    titles: saved.titles.map((entry) => {
      const [id, fit] = entry as [string, unknown];
      return [id, read(fit)];
    }),
  };
}

const TOP_KEPT: PictureFrame = { size: 1, x: 0, y: -1 };
const BETWEEN: PictureFrame = { size: 0.5, x: 0, y: 0 };

describe('readPictureFrame', () => {
  it('reads fit and fill as earlier updates kept them', () => {
    expect(readPictureFrame('fill')).toEqual(FILL);
    expect(readPictureFrame('fit')).toEqual(FIT);
  });

  it('reads a size and place kept as numbers', () => {
    expect(readPictureFrame({ size: 1, x: 0, y: -1 })).toEqual(TOP_KEPT);
    expect(readPictureFrame({ size: 0.42, x: 0.5, y: -0.25 })).toEqual({
      size: 0.42,
      x: 0.5,
      y: -0.25,
    });
  });

  it('brings numbers out of range back in range', () => {
    expect(readPictureFrame({ size: 9, x: -4, y: 4 })).toEqual({ size: MAX_SIZE, x: -1, y: 1 });
    expect(readPictureFrame({ size: -1, x: 0.5, y: 0.5 })).toEqual(FIT);
  });

  it('takes anything else for the whole picture', () => {
    for (const raw of [
      null,
      undefined,
      '',
      'cover',
      'zoom',
      3,
      true,
      [],
      {},
      { size: 1 },
      { size: '1', x: 0, y: 0 },
      { size: 1, x: null, y: 0 },
      { size: Number.NaN, x: 0, y: 0 },
      { size: 1, x: 0, y: Number.POSITIVE_INFINITY },
    ]) {
      expect(readPictureFrame(raw)).toEqual(FIT);
    }
  });
});

describe('writePictureFrame', () => {
  it('keeps fit, and fill centred, as the words earlier updates read', () => {
    expect(writePictureFrame(FIT)).toBe('fit');
    expect(writePictureFrame(FILL)).toBe('fill');
    expect(writePictureFrame({ size: 0, x: 0, y: 0 })).toBe('fit');
  });

  it('keeps any other size or place as its numbers', () => {
    expect(writePictureFrame(TOP_KEPT)).toEqual({ size: 1, x: 0, y: -1 });
    expect(writePictureFrame(BETWEEN)).toEqual({ size: 0.5, x: 0, y: 0 });
  });

  it('reads back what it wrote', () => {
    for (const frame of [FIT, FILL, TOP_KEPT, BETWEEN, { size: 1.5, x: 0.25, y: -0.75 }]) {
      expect(readPictureFrame(JSON.parse(JSON.stringify(writePictureFrame(frame))))).toEqual(frame);
    }
  });
});

describe('keptFrame', () => {
  it('keeps no place at fit, where nothing overhangs', () => {
    expect(keptFrame({ size: 0, x: 1, y: -1 })).toBe(FIT);
  });

  it('rounds to a thousandth, and never keeps minus zero', () => {
    const kept = keptFrame({ size: 0.123456, x: -0.0001, y: 0.9999 });
    expect(kept).toEqual({ size: 0.123, x: 0, y: 1 });
    expect(Object.is(kept.x, -0)).toBe(false);
  });
});

describe('isFit and isFill', () => {
  it('tell the whole picture and the screen covered centred from anything else', () => {
    expect(isFit(FIT)).toBe(true);
    expect(isFill(FILL)).toBe(true);
    expect(isFit(FILL)).toBe(false);
    expect(isFill(FIT)).toBe(false);
    expect(isFill(TOP_KEPT)).toBe(false);
    expect(isFill(BETWEEN)).toBe(false);
    expect(isFit(BETWEEN)).toBe(false);
  });
});

describe('contentFitFor', () => {
  it('maps fit to contain and fill to cover', () => {
    expect(contentFitFor(FIT)).toBe('contain');
    expect(contentFitFor(FILL)).toBe('cover');
  });
});

describe('touchSpread', () => {
  it('measures between the first two fingers', () => {
    expect(
      touchSpread([
        { pageX: 0, pageY: 0 },
        { pageX: 30, pageY: 40 },
      ]),
    ).toBe(50);
  });

  it('ignores a third finger', () => {
    expect(
      touchSpread([
        { pageX: 10, pageY: 10 },
        { pageX: 10, pageY: 110 },
        { pageX: 500, pageY: 500 },
      ]),
    ).toBe(100);
  });

  it('is null with one finger or none', () => {
    expect(touchSpread([{ pageX: 5, pageY: 5 }])).toBeNull();
    expect(touchSpread([])).toBeNull();
    expect(touchSpread(undefined)).toBeNull();
  });
});

describe('pinchFit', () => {
  it('fills as two fingers spread, and fits as they close', () => {
    expect(pinchFit(200, 260)).toEqual(FILL);
    expect(pinchFit(260, 200)).toEqual(FIT);
  });

  it('waits while the change is small', () => {
    expect(pinchFit(200, 200)).toBeNull();
    expect(pinchFit(200, 230)).toBeNull();
    expect(pinchFit(230, 200)).toBeNull();
  });
});

describe('readPictureFits', () => {
  it('starts with the whole picture and no titles on a phone that never chose', () => {
    expect(readPictureFits(null, null)).toEqual(fits(FIT));
  });

  it('starts both kinds from the one choice the phone kept for every film before', () => {
    expect(readPictureFits(null, 'fill')).toEqual(fits(FILL));
    expect(readPictureFits(null, 'fit')).toEqual(fits(FIT));
  });

  it('reads choices kept before there were two kinds as they were, its last for both', () => {
    const raw = JSON.stringify({
      last: 'fill',
      titles: [
        ['tt1', 'fill'],
        ['tt2', 'fit'],
      ],
    });
    expect(readPictureFits(raw, null)).toEqual(
      fits(FILL, [
        ['tt1', FILL],
        ['tt2', FIT],
      ]),
    );
  });

  it('reads back what was written, in the order chosen', () => {
    const kept = fits(
      TOP_KEPT,
      [
        ['tt1', FILL],
        ['tt2', FIT],
        ['tt3', BETWEEN],
        ['tt4', TOP_KEPT],
      ],
      BETWEEN,
    );
    const read = readPictureFits(writePictureFits(kept), null);
    expect(read).toEqual(kept);
    expect([...read.titles.keys()]).toEqual(['tt1', 'tt2', 'tt3', 'tt4']);
  });

  it('keeps ids that look like numbers in the order chosen', () => {
    const kept = fits(FIT, [
      ['300', FILL],
      ['20', FIT],
      ['tt1', FILL],
    ]);
    expect([...readPictureFits(writePictureFits(kept), null).titles.keys()]).toEqual([
      '300',
      '20',
      'tt1',
    ]);
  });

  it('pays no attention to the earlier choice once choices are kept', () => {
    expect(readPictureFits(writePictureFits(fits(FIT)), 'fill')).toEqual(fits(FIT));
  });

  it('falls back to the earlier choice when what is kept cannot be read', () => {
    expect(readPictureFits('{not json', 'fill')).toEqual(fits(FILL));
    expect(readPictureFits('null', 'fill')).toEqual(fits(FILL));
    expect(readPictureFits('"fill"', null)).toEqual(fits(FIT));
    expect(readPictureFits('{"last":"fill","titles":{"tt1":"fill"}}', null)).toEqual(fits(FIT));
  });

  it('skips entries it cannot read, and takes an unknown frame as the whole picture', () => {
    const raw = JSON.stringify({
      last: 'cover',
      live: { size: 'big' },
      titles: [
        ['tt1', 'fill'],
        'tt2',
        [3, 'fill'],
        ['tt4', 'zoom'],
        ['tt5'],
        ['tt6', { size: 1, x: 0 }],
        ['tt7', { size: 1, x: 0, y: -1 }],
      ],
    });
    expect(readPictureFits(raw, null)).toEqual(
      fits(FIT, [
        ['tt1', FILL],
        ['tt4', FIT],
        ['tt5', FIT],
        ['tt6', FIT],
        ['tt7', TOP_KEPT],
      ]),
    );
  });

  it("takes live's last choice as fit when it is there but cannot be read", () => {
    const raw = JSON.stringify({ last: 'fill', live: 'cover', titles: [] });
    expect(readPictureFits(raw, null)).toEqual(fits(FILL, [], FIT));
  });

  it('keeps only the newest titles of a longer list', () => {
    const titles = Array.from({ length: MAX_FIT_TITLES + 5 }, (_, n) => [`tt${n}`, 'fill']);
    const read = readPictureFits(JSON.stringify({ last: 'fill', titles }), null);
    expect(read.titles.size).toBe(MAX_FIT_TITLES);
    expect(read.titles.has('tt4')).toBe(false);
    expect(read.titles.has('tt5')).toBe(true);
    expect(read.titles.has(`tt${MAX_FIT_TITLES + 4}`)).toBe(true);
  });
});

describe('writePictureFits', () => {
  it("keeps films' last choice where earlier updates look for their one", () => {
    expect(JSON.parse(writePictureFits(fits(FILL, [['tt1', FIT]], TOP_KEPT)))).toEqual({
      last: 'fill',
      live: { size: 1, x: 0, y: -1 },
      titles: [['tt1', 'fit']],
    });
  });

  it('reads on an earlier update as fit and fill did, and anything new as fit', () => {
    const kept = fits(
      FILL,
      [
        ['tt1', FILL],
        ['tt2', FIT],
        ['tt3', TOP_KEPT],
        ['tt4', BETWEEN],
      ],
      TOP_KEPT,
    );
    expect(earlierUpdateReads(writePictureFits(kept))).toEqual({
      last: 'fill',
      titles: [
        ['tt1', 'fill'],
        ['tt2', 'fit'],
        ['tt3', 'fit'],
        ['tt4', 'fit'],
      ],
    });
  });
});

describe('fitFor', () => {
  it('opens a title as it was left, and one never chosen for as the last of its kind', () => {
    const kept = fits(FILL, [['tt1', FIT]], TOP_KEPT);
    expect(fitFor(kept, 'tt1', 'film')).toEqual(FIT);
    expect(fitFor(kept, 'tt1', 'live')).toEqual(FIT);
    expect(fitFor(kept, 'tt2', 'film')).toEqual(FILL);
    expect(fitFor(kept, 'tt2', 'live')).toEqual(TOP_KEPT);
  });
});

describe('chooseFit', () => {
  it("keeps the title's choice and makes it the last one of its kind", () => {
    const next = chooseFit(fits(FIT), 'tt1', FILL, 'film');
    expect(next).toEqual(fits(FILL, [['tt1', FILL]], FIT));
    expect(fitFor(next, 'tt2', 'film')).toEqual(FILL);
    expect(fitFor(next, 'match', 'live')).toEqual(FIT);
  });

  it("carries a match's framing to the next match, and leaves films as they open", () => {
    const next = chooseFit(fits(FIT), 'match1', TOP_KEPT, 'live');
    expect(fitFor(next, 'match2', 'live')).toEqual(TOP_KEPT);
    expect(fitFor(next, 'film', 'film')).toEqual(FIT);
  });

  it("leaves other titles' choices as they were", () => {
    const next = chooseFit(fits(FILL, [['tt1', FILL]]), 'tt2', FIT, 'film');
    expect(fitFor(next, 'tt1', 'film')).toEqual(FILL);
    expect(fitFor(next, 'tt2', 'film')).toEqual(FIT);
    expect(next.last.film).toEqual(FIT);
  });

  it('makes a title chosen for again the newest', () => {
    const kept = fits(FIT, [
      ['tt1', FILL],
      ['tt2', FIT],
    ]);
    expect([...chooseFit(kept, 'tt1', FIT, 'film').titles.keys()]).toEqual(['tt2', 'tt1']);
  });

  it('changes nothing when the title already has the choice and it was the last made', () => {
    const kept = fits(FILL, [['tt1', FILL]]);
    expect(chooseFit(kept, 'tt1', { ...FILL }, 'film')).toBe(kept);
  });

  it('keeps a frame as it is stored: in range and to a thousandth', () => {
    const next = chooseFit(fits(FIT), 'tt1', { size: 0.66666, x: 0, y: -3 }, 'film');
    expect(fitFor(next, 'tt1', 'film')).toEqual({ size: 0.667, x: 0, y: -1 });
  });

  it('keeps the choice of a title that was following the last one', () => {
    // The same fit it showed, now its own: a later choice for another title leaves it.
    const kept = chooseFit(fits(FILL), 'tt1', FILL, 'film');
    expect(fitFor(chooseFit(kept, 'tt2', FIT, 'film'), 'tt1', 'film')).toEqual(FILL);
  });

  it('lets the oldest title go past the limit, which then opens with the last choice', () => {
    let kept = fits(FIT);
    for (let n = 0; n < MAX_FIT_TITLES; n++) kept = chooseFit(kept, `tt${n}`, FILL, 'film');
    kept = chooseFit(kept, 'tt0', FIT, 'film');
    kept = chooseFit(kept, 'new', FIT, 'film');
    expect(kept.titles.size).toBe(MAX_FIT_TITLES);
    // tt0 was chosen for again, so tt1 was the oldest.
    expect(kept.titles.has('tt0')).toBe(true);
    expect(kept.titles.has('tt1')).toBe(false);
    expect(fitFor(kept, 'tt1', 'film')).toEqual(FIT);
  });

  it('leaves the choices it was given as they were', () => {
    const kept = fits(FIT, [['tt1', FIT]]);
    chooseFit(kept, 'tt1', FILL, 'film');
    expect(kept).toEqual(fits(FIT, [['tt1', FIT]]));
  });
});

describe('pictureFitStore', () => {
  it('starts every title with the whole picture on a phone that never chose', () => {
    const { items, storage } = memory();
    expect(pictureFitStore(storage).title('tt1', 'film').get()).toEqual(FIT);
    expect(pictureFitStore(storage).title('match', 'live').get()).toEqual(FIT);
    // Nothing is written until something is chosen.
    expect(items.size).toBe(0);
  });

  it('keeps each title its own choice, for the next launch too', () => {
    const { storage } = memory();
    const memoryOf = pictureFitStore(storage);
    memoryOf.title('film', 'film').set(FILL);
    memoryOf.title('show', 'film').set(FIT);
    memoryOf.title('match', 'live').set(TOP_KEPT);
    expect(memoryOf.title('film', 'film').get()).toEqual(FILL);
    expect(memoryOf.title('show', 'film').get()).toEqual(FIT);
    const next = pictureFitStore(storage);
    expect(next.title('film', 'film').get()).toEqual(FILL);
    expect(next.title('show', 'film').get()).toEqual(FIT);
    expect(next.title('match', 'live').get()).toEqual(TOP_KEPT);
  });

  it('opens a title never chosen for with the last choice made for its kind', () => {
    const { storage } = memory();
    const memoryOf = pictureFitStore(storage);
    memoryOf.title('film', 'film').set(FILL);
    expect(memoryOf.title('other', 'film').get()).toEqual(FILL);
    memoryOf.title('match', 'live').set(TOP_KEPT);
    expect(memoryOf.title('other', 'film').get()).toEqual(FILL);
    expect(memoryOf.title('next match', 'live').get()).toEqual(TOP_KEPT);
    memoryOf.title('show', 'film').set(FIT);
    expect(memoryOf.title('other', 'film').get()).toEqual(FIT);
    const next = pictureFitStore(storage);
    expect(next.title('other', 'film').get()).toEqual(FIT);
    expect(next.title('next match', 'live').get()).toEqual(TOP_KEPT);
  });

  it("moves the one choice for every film over once, as every title's starting point", () => {
    const { items, storage } = memory({ [EARLIER_FIT_KEY]: 'fill' });
    const memoryOf = pictureFitStore(storage);
    expect(memoryOf.title('tt1', 'film').get()).toEqual(FILL);
    expect(memoryOf.title('match', 'live').get()).toEqual(FILL);
    expect(stored(items)).toEqual({ last: 'fill', live: 'fill', titles: [] });
    memoryOf.title('tt1', 'film').set(FIT);
    expect(pictureFitStore(storage).title('tt1', 'film').get()).toEqual(FIT);
    expect(pictureFitStore(storage).title('tt2', 'film').get()).toEqual(FIT);
    expect(pictureFitStore(storage).title('match', 'live').get()).toEqual(FILL);
  });

  it('leaves the earlier choice for an earlier update to read, and reads it no more', () => {
    const { items, storage } = memory({ [EARLIER_FIT_KEY]: 'fill' });
    pictureFitStore(storage).title('tt1', 'film').set(FIT);
    // A phone put back on the earlier update still opens films filled, as it had them.
    expect(items.get(EARLIER_FIT_KEY)).toBe('fill');
    // Once this update is back, the choices it kept count, not that one.
    const back = pictureFitStore(storage);
    expect(back.title('tt1', 'film').get()).toEqual(FIT);
    expect(back.title('tt2', 'film').get()).toEqual(FIT);
    expect(stored(items)).toEqual({ last: 'fit', live: 'fill', titles: [['tt1', 'fit']] });
  });

  it('reads the earlier choice no more once choices are kept', () => {
    const { storage } = memory({
      [PICTURE_FITS_KEY]: writePictureFits(fits(FIT)),
      [EARLIER_FIT_KEY]: 'fill',
    });
    expect(pictureFitStore(storage).title('tt1', 'film').get()).toEqual(FIT);
  });

  it('tells those watching when a choice changes, and takes an update as well', () => {
    const { storage } = memory();
    const film = pictureFitStore(storage).title('film', 'film');
    let calls = 0;
    const stop = film.subscribe(() => calls++);
    film.set((frame) => (isFill(frame) ? FIT : FILL));
    expect(film.get()).toEqual(FILL);
    expect(calls).toBe(1);
    // The same choice again changes nothing.
    film.set({ ...FILL });
    expect(calls).toBe(1);
    stop();
    film.set(FIT);
    expect(calls).toBe(1);
  });

  it('gives the same frame until it changes, as a screen reading it needs', () => {
    const { storage } = memory();
    const film = pictureFitStore(storage).title('film', 'film');
    film.set(TOP_KEPT);
    expect(film.get()).toBe(film.get());
  });

  it('keeps the newest titles only', () => {
    const { items, storage } = memory();
    const memoryOf = pictureFitStore(storage);
    for (let n = 0; n < MAX_FIT_TITLES + 5; n++)
      memoryOf.title(`tt${n}`, 'film').set(n % 2 ? FIT : FILL);
    const { titles } = stored(items) as { titles: [string, unknown][] };
    expect(titles).toHaveLength(MAX_FIT_TITLES);
    expect(titles[0]![0]).toBe('tt5');
    expect(titles[MAX_FIT_TITLES - 1]![0]).toBe(`tt${MAX_FIT_TITLES + 4}`);
  });

  it('works without storage, for as long as the app is open', () => {
    const broken: FitStorage = {
      getItem: () => {
        throw new Error('no storage');
      },
      setItem: () => {
        throw new Error('no storage');
      },
    };
    const memoryOf = pictureFitStore(broken);
    const film = memoryOf.title('film', 'film');
    expect(film.get()).toEqual(FIT);
    film.set(FILL);
    expect(film.get()).toEqual(FILL);
    expect(memoryOf.title('other', 'film').get()).toEqual(FILL);
  });

  it('keeps the earlier choice where it was if the new one cannot be written', () => {
    const { items, storage } = memory({ [EARLIER_FIT_KEY]: 'fill' });
    const full: FitStorage = {
      ...storage,
      setItem: () => {
        throw new Error('full');
      },
    };
    expect(pictureFitStore(full).title('tt1', 'film').get()).toEqual(FILL);
    expect(items.get(EARLIER_FIT_KEY)).toBe('fill');
  });
});
