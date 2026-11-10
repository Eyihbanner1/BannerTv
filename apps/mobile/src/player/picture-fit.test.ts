import { describe, expect, it } from 'vitest';
import {
  ASSUMED_VIDEO,
  BEYOND_FILL,
  chooseFit,
  contentFitFor,
  EARLIER_FIT_KEY,
  FILL,
  fillZoom,
  fingersOf,
  FIT,
  type Fingers,
  type FitStorage,
  fitFor,
  isFill,
  isFit,
  keptFrame,
  MAX_FIT_TITLES,
  MAX_SIZE,
  movePinch,
  PAN_MIN_PX,
  PAN_SLACK_PX,
  type Pinch,
  PINCH_MIN_PX,
  pictureChoice,
  type PictureFits,
  type PictureFrame,
  PICTURE_FITS_KEY,
  pictureFitStore,
  pictureLayout,
  pictureNote,
  pictureRect,
  readPictureFits,
  readPictureFrame,
  shownShape,
  sizeAt,
  SNAP,
  SNAP_OUT,
  snapOf,
  startPinch,
  switchedFrame,
  touchSpread,
  videoSizeOf,
  writePictureFits,
  writePictureFrame,
  zoomAt,
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

// The owner's phone (3120 by 1440, 19.5:9) showing a 16:9 hockey broadcast.
const PHONE = { width: 3120, height: 1440 };
const HOCKEY = { width: 1920, height: 1080 };
/** How many times its whole size the hockey is at fill on that phone. */
const HOCKEY_FILL = 3120 / 2560;

describe('pictureRect', () => {
  it('fits the hockey whole, with bars left and right', () => {
    expect(pictureRect(PHONE, HOCKEY, FIT)).toEqual({
      left: 280,
      top: 0,
      width: 2560,
      height: 1440,
    });
  });

  it('fills the screen with the hockey, cutting as much off the top as the bottom', () => {
    expect(pictureRect(PHONE, HOCKEY, FILL)).toEqual({
      left: 0,
      top: -157.5,
      width: 3120,
      height: 1755,
    });
  });

  it('keeps the top edge, and the score with it, at y -1, and the bottom at 1', () => {
    expect(pictureRect(PHONE, HOCKEY, TOP_KEPT)).toEqual({
      left: 0,
      top: 0,
      width: 3120,
      height: 1755,
    });
    expect(pictureRect(PHONE, HOCKEY, { size: 1, x: 0, y: 1 }).top).toBe(-315);
    expect(pictureRect(PHONE, HOCKEY, { size: 1, x: 0, y: -0.5 }).top).toBe(-78.75);
  });

  it('stays centred where nothing overhangs, whatever the place says', () => {
    expect(pictureRect(PHONE, HOCKEY, { size: 1, x: 1, y: 0 }).left).toBe(0);
    expect(pictureRect(PHONE, HOCKEY, { size: 0, x: -1, y: 1 })).toEqual(
      pictureRect(PHONE, HOCKEY, FIT),
    );
    // Halfway, the hockey is still narrower than the screen, and overhangs only top and bottom.
    const half = pictureRect(PHONE, HOCKEY, { size: 0.5, x: 1, y: -1 });
    expect(half.left).toBeCloseTo((3120 - half.width) / 2);
    expect(half.top).toBe(0);
  });

  it('grows by the same share at each step of size between fit and fill', () => {
    const half = pictureRect(PHONE, HOCKEY, { size: 0.5, x: 0, y: 0 });
    expect(half.width).toBeCloseTo(2560 * Math.sqrt(HOCKEY_FILL));
    expect(half.height).toBeCloseTo(1440 * Math.sqrt(HOCKEY_FILL));
    expect(half.width / half.height).toBeCloseTo(16 / 9);
  });

  it('grows past fill to BEYOND_FILL times its size', () => {
    const most = pictureRect(PHONE, HOCKEY, { size: MAX_SIZE, x: -1, y: 1 });
    expect(most.width).toBeCloseTo(3120 * BEYOND_FILL);
    expect(most.height).toBeCloseTo(1755 * BEYOND_FILL);
    expect(most.left).toBe(0);
    expect(most.top).toBeCloseTo(1440 - 1755 * BEYOND_FILL);
    expect(pictureRect(PHONE, HOCKEY, { size: 9, x: 0, y: 0 }).width).toBeCloseTo(
      3120 * BEYOND_FILL,
    );
  });

  it('fits by the width and fills by the height on a screen narrower than the picture', () => {
    const upright = { width: 1440, height: 3120 };
    expect(pictureRect(upright, HOCKEY, FIT)).toEqual({
      left: 0,
      top: 1155,
      width: 1440,
      height: 810,
    });
    const filled = pictureRect(upright, HOCKEY, FILL);
    expect(filled.height).toBe(3120);
    expect(filled.width).toBeCloseTo(5546.667);
    expect(filled.left).toBeCloseTo((1440 - filled.width) / 2);
    expect(pictureRect(upright, HOCKEY, { size: 1, x: -1, y: 0 }).left).toBe(0);
  });

  it("fits and fills alike on a screen of the picture's own shape", () => {
    const tv = { width: 1920, height: 1080 };
    expect(pictureRect(tv, HOCKEY, FIT)).toEqual({ left: 0, top: 0, width: 1920, height: 1080 });
    expect(pictureRect(tv, HOCKEY, FILL)).toEqual({ left: 0, top: 0, width: 1920, height: 1080 });
  });
});

describe('fillZoom, zoomAt and sizeAt', () => {
  it('says how many times its whole size the picture is at fill', () => {
    expect(fillZoom(PHONE, HOCKEY)).toBe(HOCKEY_FILL);
    expect(fillZoom({ width: 1920, height: 1080 }, HOCKEY)).toBe(1);
    expect(fillZoom({ width: 1440, height: 3120 }, HOCKEY)).toBeCloseTo(3120 / 810);
  });

  it('gives fit, fill and the most exactly', () => {
    expect(zoomAt(0, HOCKEY_FILL)).toBe(1);
    expect(zoomAt(1, HOCKEY_FILL)).toBe(HOCKEY_FILL);
    expect(zoomAt(MAX_SIZE, HOCKEY_FILL)).toBeCloseTo(HOCKEY_FILL * BEYOND_FILL);
    expect(zoomAt(-1, HOCKEY_FILL)).toBe(1);
    expect(zoomAt(MAX_SIZE + 1, HOCKEY_FILL)).toBeCloseTo(HOCKEY_FILL * BEYOND_FILL);
    expect(sizeAt(1, HOCKEY_FILL)).toBe(0);
    expect(sizeAt(0.5, HOCKEY_FILL)).toBe(0);
    expect(sizeAt(HOCKEY_FILL, HOCKEY_FILL)).toBe(1);
    expect(sizeAt(100, HOCKEY_FILL)).toBe(MAX_SIZE);
  });

  it('goes back and forth between size and zoom', () => {
    for (const size of [0.1, 0.5, 0.9, 1.2, 1.5, 1.99]) {
      expect(sizeAt(zoomAt(size, HOCKEY_FILL), HOCKEY_FILL)).toBeCloseTo(size);
    }
  });
});

describe('pictureLayout', () => {
  it('draws fit and fill centred across the screen as they always were', () => {
    for (const video of [HOCKEY, null]) {
      expect(pictureLayout(FIT, PHONE, video)).toEqual({ contentFit: 'contain', rect: null });
      expect(pictureLayout(FILL, PHONE, video)).toEqual({ contentFit: 'cover', rect: null });
    }
  });

  it('lays any other size or place out as its own rectangle, the whole frame in it', () => {
    expect(pictureLayout(TOP_KEPT, PHONE, HOCKEY)).toEqual({
      contentFit: 'contain',
      rect: { left: 0, top: 0, width: 3120, height: 1755 },
    });
    expect(pictureLayout(BETWEEN, PHONE, HOCKEY)).toEqual({
      contentFit: 'contain',
      rect: pictureRect(PHONE, HOCKEY, BETWEEN),
    });
    // A 4:3 picture is laid out by its own shape.
    expect(pictureLayout(TOP_KEPT, PHONE, { width: 640, height: 480 }).rect).toEqual({
      left: 0,
      top: 0,
      width: 3120,
      height: 2340,
    });
  });

  it('takes the picture to be 16:9 until its size is known', () => {
    expect(pictureLayout(TOP_KEPT, PHONE, null)).toEqual({
      contentFit: 'contain',
      rect: pictureRect(PHONE, ASSUMED_VIDEO, TOP_KEPT),
    });
    expect(pictureLayout(TOP_KEPT, PHONE, null).rect).toEqual({
      left: 0,
      top: 0,
      width: 3120,
      height: 1755,
    });
  });

  it('draws across the screen until the screen is measured', () => {
    expect(pictureLayout(TOP_KEPT, null, HOCKEY)).toEqual({ contentFit: 'cover', rect: null });
    expect(pictureLayout(BETWEEN, { width: 0, height: 0 }, HOCKEY)).toEqual({
      contentFit: 'contain',
      rect: null,
    });
  });
});

describe('pictureNote', () => {
  it('says fit and fill by name, and anything else as a share of the whole picture', () => {
    expect(pictureNote(FIT, PHONE, HOCKEY)).toEqual({ kind: 'fit' });
    expect(pictureNote(FILL, PHONE, HOCKEY)).toEqual({ kind: 'fill' });
    // Filled with the top kept is still the fill size.
    expect(pictureNote(TOP_KEPT, PHONE, HOCKEY)).toEqual({ kind: 'fill' });
    expect(pictureNote(BETWEEN, PHONE, HOCKEY)).toEqual({ kind: 'zoom', percent: 110 });
    expect(pictureNote({ size: MAX_SIZE, x: 0, y: 0 }, PHONE, HOCKEY)).toEqual({
      kind: 'zoom',
      percent: 165,
    });
  });
});

describe('snapOf', () => {
  it('names fit and fill, whatever the place, and nothing between', () => {
    expect(snapOf(FIT)).toBe('fit');
    expect(snapOf(FILL)).toBe('fill');
    expect(snapOf(TOP_KEPT)).toBe('fill');
    expect(snapOf(BETWEEN)).toBeNull();
  });
});

describe("More's switch", () => {
  it('says fit, fill, or custom for any other size or place', () => {
    expect(pictureChoice(FIT)).toBe('fit');
    expect(pictureChoice(FILL)).toBe('fill');
    expect(pictureChoice(TOP_KEPT)).toBe('custom');
    expect(pictureChoice(BETWEEN)).toBe('custom');
  });

  it('fills a fitted picture, and takes anything else back to the whole picture', () => {
    expect(switchedFrame(FIT)).toBe(FILL);
    expect(switchedFrame(FILL)).toBe(FIT);
    expect(switchedFrame(TOP_KEPT)).toBe(FIT);
    expect(switchedFrame(BETWEEN)).toBe(FIT);
  });
});

describe('videoSizeOf', () => {
  it("takes a player's size only when both sides are there", () => {
    expect(videoSizeOf(1920, 1080)).toEqual(HOCKEY);
    expect(videoSizeOf(0, 0)).toBeNull();
    expect(videoSizeOf(-1, -1)).toBeNull();
    expect(videoSizeOf(1920, undefined)).toBeNull();
    expect(videoSizeOf(Number.NaN, 1080)).toBeNull();
  });
});

describe('shownShape', () => {
  const sixteenNine = (size: { width: number; height: number }, live: boolean) =>
    expect(shownShape(size, live)).toEqual(ASSUMED_VIDEO);

  it('takes standard definition, never stored with square pixels, as 16:9', () => {
    for (const live of [true, false]) {
      sixteenNine({ width: 720, height: 576 }, live);
      sixteenNine({ width: 720, height: 480 }, live);
      sixteenNine({ width: 704, height: 576 }, live);
      sixteenNine({ width: 544, height: 576 }, live);
      sixteenNine({ width: 352, height: 480 }, live);
      // HD squeezed to these widths is never square either.
      sixteenNine({ width: 1280, height: 1080 }, live);
      sixteenNine({ width: 960, height: 1080 }, live);
    }
  });

  it("takes a broadcast's squeezed HD as 16:9, and keeps a film's as it is stored", () => {
    sixteenNine({ width: 1440, height: 1080 }, true);
    sixteenNine({ width: 960, height: 720 }, true);
    expect(shownShape({ width: 1440, height: 1080 }, false)).toEqual({ width: 1440, height: 1080 });
    expect(shownShape({ width: 960, height: 720 }, false)).toEqual({ width: 960, height: 720 });
  });

  it('keeps any other size as it is stored', () => {
    for (const live of [true, false]) {
      expect(shownShape(HOCKEY, live)).toBe(HOCKEY);
      const hd = { width: 1280, height: 720 };
      expect(shownShape(hd, live)).toBe(hd);
      const wide = { width: 1920, height: 800 };
      expect(shownShape(wide, live)).toBe(wide);
      const square = { width: 640, height: 480 };
      expect(shownShape(square, live)).toBe(square);
    }
  });

  it('frames a match on a standard definition channel as it does in HD', () => {
    const sd = shownShape({ width: 720, height: 576 }, true);
    expect(pictureRect(PHONE, sd, TOP_KEPT)).toEqual({
      left: 0,
      top: 0,
      width: 3120,
      height: 1755,
    });
    expect(pictureLayout(TOP_KEPT, PHONE, sd)).toEqual(pictureLayout(TOP_KEPT, PHONE, HOCKEY));
  });
});

describe('fingersOf', () => {
  it('takes the first two fingers, and none with fewer', () => {
    expect(
      fingersOf([
        { pageX: 1, pageY: 2 },
        { pageX: 3, pageY: 4 },
        { pageX: 5, pageY: 6 },
      ]),
    ).toEqual({ a: { x: 1, y: 2 }, b: { x: 3, y: 4 } });
    expect(fingersOf([{ pageX: 1, pageY: 2 }])).toBeNull();
    expect(fingersOf(undefined)).toBeNull();
  });
});

describe('pinching', () => {
  /** Two fingers on a line across the middle of the screen, `spread` apart, moved by `down`. */
  const apart = (spread: number, down = 0, across = 0): Fingers => ({
    a: { x: 1560 - spread / 2 + across, y: 720 + down },
    b: { x: 1560 + spread / 2 + across, y: 720 + down },
  });
  /** Two fingers one above the other in the middle of the screen, `spread` apart, moved by `down`. */
  const above = (spread: number, down = 0): Fingers => ({
    a: { x: 1560, y: 720 - spread / 2 + down },
    b: { x: 1560, y: 720 + spread / 2 + down },
  });
  const move = (pinch: Pinch, ...steps: Fingers[]) =>
    steps.reduce((now, fingers) => movePinch(now, fingers, PHONE, HOCKEY), pinch);
  /** The same numbers between 0 and 1 on every run, for fingers that are never quite steady. */
  const seeded = (seed: number) => {
    let state = seed >>> 0;
    return () => {
      state = (state + 0x6d2b79f5) >>> 0;
      let mixed = Math.imul(state ^ (state >>> 15), state | 1);
      mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
      return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
    };
  };
  /** How far the picture's top edge is below where it is at fill, centred. */
  const loweredBy = (pinch: Pinch) => pictureRect(PHONE, HOCKEY, pinch.frame).top + 157.5;

  it('leaves the picture as it was while two fingers rest, settle or barely move', () => {
    const start = startPinch(FILL, apart(400));
    const rested = move(
      start,
      apart(400 + PINCH_MIN_PX - 1),
      apart(400 - PINCH_MIN_PX + 1),
      apart(400, PAN_MIN_PX - 1),
      apart(400, 0, PAN_MIN_PX - 1),
    );
    expect(rested.frame).toBe(FILL);
  });

  it('starts from where the fingers passed the dead zone, so the size never jumps', () => {
    const passed = move(startPinch(FIT, apart(400)), apart(424));
    expect(passed.frame).toBe(FIT);
    expect(passed.zoomFrom).toBe(424);
  });

  it('changes the size smoothly, as many times bigger as the fingers are further apart', () => {
    const pinch = move(startPinch(FIT, apart(400)), apart(424), apart(424 * 1.1));
    expect(pinch.frame.size).toBeCloseTo(Math.log(1.1) / Math.log(HOCKEY_FILL));
    expect(pictureRect(PHONE, HOCKEY, pinch.frame).width).toBeCloseTo(2560 * 1.1);
    // Closing them a little takes it part of the way back, from the size it had at the start.
    const back = move(pinch, apart(424 * 1.05));
    expect(pictureRect(PHONE, HOCKEY, back.frame).width).toBeCloseTo(2560 * 1.05);
  });

  it('grows on from the size the picture had as the fingers came down', () => {
    const pinch = move(startPinch(FILL, apart(400)), apart(424), apart(424 * 1.1));
    expect(pinch.frame.size).toBeCloseTo(1 + Math.log(1.1) / Math.log(BEYOND_FILL));
    expect(pictureRect(PHONE, HOCKEY, pinch.frame).width).toBeCloseTo(3120 * 1.1);
  });

  it('lands exactly on fill and on fit within a few percent of them', () => {
    const nearFill = move(startPinch(FIT, apart(400)), apart(424), apart(424 * 1.19));
    expect(nearFill.frame).toEqual(FILL);
    const pastFill = move(startPinch(FIT, apart(400)), apart(424), apart(424 * 1.25));
    expect(pastFill.frame).toEqual(FILL);
    const nearFit = move(
      startPinch(FILL, apart(400)),
      apart(376),
      apart((376 * 1.03) / HOCKEY_FILL),
    );
    expect(nearFit.frame).toEqual(FIT);
    // Further from them, the size is what the fingers make it.
    const between = move(startPinch(FIT, apart(400)), apart(424), apart(424 * 1.06));
    expect(between.frame.size).toBeGreaterThan(0);
    expect(between.frame.size).toBeLessThan(1);
  });

  it('lands once as fingers held at the edge of fill shake, and stays', () => {
    // As far apart as takes the picture just to SNAP from fill.
    const edge = 424 * HOCKEY_FILL * (1 - SNAP);
    let pinch = move(startPinch(FIT, apart(400)), apart(424), apart(edge - 1));
    expect(snapOf(pinch.frame)).toBeNull();
    const random = seeded(4);
    let landings = 0;
    let changes = 0;
    for (let step = 0; step < 100; step++) {
      const next = movePinch(pinch, apart(edge + (random() - 0.5) * 0.3), PHONE, HOCKEY);
      if (snapOf(next.frame) !== snapOf(pinch.frame)) {
        changes++;
        if (snapOf(next.frame)) landings++;
      }
      pinch = next;
    }
    expect(landings).toBe(1);
    expect(changes).toBe(1);
    expect(pinch.frame).toEqual(FILL);
  });

  it('leaves fit or fill only once the fingers take it SNAP_OUT away', () => {
    const fit = startPinch(FIT, apart(400));
    expect(move(fit, apart(424), apart(424 * (1 + (SNAP + SNAP_OUT) / 2))).frame).toBe(FIT);
    expect(move(fit, apart(424), apart(424 * (1 + SNAP_OUT + 0.005))).frame.size).toBeGreaterThan(
      0,
    );

    const filled = move(fit, apart(424), apart(424 * HOCKEY_FILL));
    expect(filled.frame).toEqual(FILL);
    const held = move(filled, apart(424 * HOCKEY_FILL * (1 + (SNAP + SNAP_OUT) / 2)));
    expect(held.frame).toBe(filled.frame);
    const out = move(held, apart(424 * HOCKEY_FILL * (1 + SNAP_OUT + 0.005)));
    expect(out.frame.size).toBeGreaterThan(1);
    // Back towards fill, it lands again only within SNAP of it.
    const near = move(out, apart(424 * HOCKEY_FILL * (1 + (SNAP + SNAP_OUT) / 2)));
    expect(near.frame.size).toBeGreaterThan(1);
    expect(move(near, apart(424 * HOCKEY_FILL * (1 + SNAP / 2))).frame).toEqual(FILL);
  });

  it('never goes smaller than the whole picture, nor past the biggest size', () => {
    expect(move(startPinch(FILL, apart(800)), apart(700), apart(100)).frame).toEqual(FIT);
    expect(move(startPinch(FIT, apart(100)), apart(130), apart(2000)).frame.size).toBe(MAX_SIZE);
  });

  it('moves the picture with two fingers dragged together, past a dead zone', () => {
    const start = startPinch(FILL, apart(400));
    // The first PAN_MIN_PX points start it; the picture moves from there, as far as they go.
    const moved = move(start, apart(400, 20), apart(400, 120));
    expect(moved.frame.size).toBe(1);
    expect(moved.frame.y).toBeCloseTo(-200 / 315);
    expect(pictureRect(PHONE, HOCKEY, moved.frame).top).toBeCloseTo(-157.5 + 100);
  });

  it('follows two fingers dragged together point for point, however unevenly each touch moves them', () => {
    const start = apart(400);
    // Each touch moves one finger and then the other, 1.5 points at a time, 120 points in all.
    const turns: Fingers[] = [];
    for (let step = 1; step <= 160; step++) {
      const a = 1.5 * Math.ceil(step / 2);
      const b = 1.5 * Math.floor(step / 2);
      turns.push({ a: { ...start.a, y: start.a.y + a }, b: { ...start.b, y: start.b.y + b } });
    }
    const turned = move(startPinch(FILL, start), ...turns);
    expect(Math.abs(loweredBy(turned) - (120 - PAN_MIN_PX))).toBeLessThanOrEqual(1);

    // Each finger a fraction of a point off where it truly is at each touch, as a screen reads
    // it, while both move down 0.5 points a touch, 80 points in all.
    const random = seeded(56);
    const shaky = (at: { x: number; y: number }, down: number) => ({
      x: at.x + (random() - 0.5) * 0.5,
      y: at.y + down + (random() - 0.5) * 0.5,
    });
    const shakes: Fingers[] = [];
    for (let step = 1; step <= 160; step++) {
      shakes.push({ a: shaky(start.a, step * 0.5), b: shaky(start.b, step * 0.5) });
    }
    const shook = move(startPinch(FILL, start), ...shakes);
    expect(Math.abs(loweredBy(shook) - (80 - PAN_MIN_PX))).toBeLessThanOrEqual(1);
    expect(shook.frame.size).toBe(1);

    // And read to the screen's own steps of 0.29 points, with one finger a little lower than the
    // other, so each steps on touches of its own.
    const stepped = (at: { x: number; y: number }, down: number) => ({
      x: at.x,
      y: Math.round((at.y + down) / 0.29) * 0.29,
    });
    const lower = { ...start.b, y: start.b.y + 0.13 };
    const steps: Fingers[] = [];
    for (let step = 1; step <= 160; step++) {
      steps.push({ a: stepped(start.a, step * 0.25), b: stepped(lower, step * 0.25) });
    }
    const stepping = move(
      startPinch(FILL, { a: stepped(start.a, 0), b: stepped(lower, 0) }),
      ...steps,
    );
    expect(Math.abs(loweredBy(stepping) - (40 - PAN_MIN_PX))).toBeLessThanOrEqual(1);
  });

  it('moves the picture after a pinch, trailing the fingers by PAN_SLACK_PX at most', () => {
    const pinched = move(startPinch(FILL, above(400)), above(424), above(424 * 1.1));
    expect(pinched.frame.size).toBeGreaterThan(1);
    expect(pinched.frame.y).toBe(0);
    const top = pictureRect(PHONE, HOCKEY, pinched.frame).top;
    const drags: Fingers[] = [];
    for (let down = 1; down <= 100; down++) drags.push(above(424 * 1.1, down));
    const dragged = move(pinched, ...drags);
    expect(dragged.frame.size).toBe(pinched.frame.size);
    const lowered = pictureRect(PHONE, HOCKEY, dragged.frame).top - top;
    expect(lowered).toBeLessThanOrEqual(100 - PAN_MIN_PX + 0.001);
    expect(lowered).toBeGreaterThanOrEqual(100 - PAN_MIN_PX - PAN_SLACK_PX - 0.001);
  });

  it('leaves the picture where a drag put it as the fingers then pinch', () => {
    const dragged = move(startPinch(FILL, above(400)), above(400, 20), above(400, 120));
    expect(dragged.frame.y).toBeCloseTo(-200 / 315);
    const spreads: Fingers[] = [];
    for (let wider = 1; wider <= 100; wider++) spreads.push(above(400 + wider, 120));
    const pinched = move(dragged, ...spreads);
    expect(pinched.frame.size).toBeGreaterThan(1);
    expect(pinched.frame.y).toBe(dragged.frame.y);
  });

  it('keeps the picture covering the screen, and comes straight back from the edge', () => {
    const start = startPinch(FILL, apart(400));
    const kept = move(start, apart(400, 20), apart(400, 600));
    expect(kept.frame).toEqual(TOP_KEPT);
    expect(pictureRect(PHONE, HOCKEY, kept.frame).top).toBe(0);
    const back = move(kept, apart(400, 550));
    expect(pictureRect(PHONE, HOCKEY, back.frame).top).toBeCloseTo(-50);
    expect(move(kept, apart(400, -2000)).frame.y).toBe(1);
  });

  it('keeps the picture centred where it does not overhang', () => {
    // Filled on this phone, the hockey is exactly as wide as the screen.
    const sideways = move(startPinch(FILL, apart(400)), apart(400, 0, 20), apart(400, 0, 300));
    expect(sideways.frame).toBe(FILL);
  });

  it('moves nothing for a pinch made with one finger still', () => {
    const fingers = apart(400);
    const oneStill = (by: number): Fingers => ({
      a: fingers.a,
      b: { x: fingers.b.x, y: fingers.b.y + by },
    });
    const pinch = move(startPinch(FILL, fingers), oneStill(100), oneStill(300), oneStill(600));
    expect(pinch.frame.y).toBe(0);
    expect(pinch.frame.size).toBeGreaterThan(1);
  });

  it('keeps the top edge where it was as a picture with the top kept grows', () => {
    const pinch = move(startPinch(TOP_KEPT, apart(400)), apart(424), apart(424 * 1.2));
    expect(pinch.frame.y).toBe(-1);
    expect(pictureRect(PHONE, HOCKEY, pinch.frame).top).toBe(0);
  });

  it('remembers where the fingers came down, and what the frame was', () => {
    const pinch = move(startPinch(TOP_KEPT, apart(400)), apart(424), apart(500, 40));
    expect(pinch.from).toBe(TOP_KEPT);
    expect(pinch.spread).toBe(400);
  });
});
