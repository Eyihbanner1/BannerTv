import { describe, expect, it } from 'vitest';
import {
  chooseFit,
  contentFitFor,
  EARLIER_FIT_KEY,
  type FitStorage,
  fitFor,
  MAX_FIT_TITLES,
  type PictureFit,
  type PictureFits,
  PICTURE_FITS_KEY,
  pictureFitStore,
  pinchFit,
  readPictureFit,
  readPictureFits,
  touchSpread,
  writePictureFits,
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

function fits(last: PictureFit, titles: Array<[string, PictureFit]> = []): PictureFits {
  return { last, titles: new Map(titles) };
}

/** What is stored, as plain data. */
function stored(items: Map<string, string>): unknown {
  const raw = items.get(PICTURE_FITS_KEY);
  return raw === undefined ? undefined : JSON.parse(raw);
}

describe('readPictureFit', () => {
  it('fills only when fill was kept, and shows the whole picture otherwise', () => {
    expect(readPictureFit('fill')).toBe('fill');
    expect(readPictureFit('fit')).toBe('fit');
    expect(readPictureFit(null)).toBe('fit');
    expect(readPictureFit('cover')).toBe('fit');
    expect(readPictureFit('')).toBe('fit');
  });
});

describe('contentFitFor', () => {
  it('maps fit to contain and fill to cover', () => {
    expect(contentFitFor('fit')).toBe('contain');
    expect(contentFitFor('fill')).toBe('cover');
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
    expect(pinchFit(200, 260)).toBe('fill');
    expect(pinchFit(260, 200)).toBe('fit');
  });

  it('waits while the change is small', () => {
    expect(pinchFit(200, 200)).toBeNull();
    expect(pinchFit(200, 230)).toBeNull();
    expect(pinchFit(230, 200)).toBeNull();
  });

  it('needs a real movement, not just a big share, when the fingers start close together', () => {
    // Twice as far apart, but only 20 points: two fingers set down together.
    expect(pinchFit(20, 40)).toBeNull();
    expect(pinchFit(40, 20)).toBeNull();
    expect(pinchFit(20, 44)).toBe('fill');
    expect(pinchFit(44, 20)).toBe('fit');
  });

  it('needs a real share, not just points, when the fingers start far apart', () => {
    // 40 points, but only a tenth wider.
    expect(pinchFit(400, 440)).toBeNull();
    expect(pinchFit(440, 400)).toBeNull();
    expect(pinchFit(400, 480)).toBe('fill');
    expect(pinchFit(480, 400)).toBe('fit');
  });
});

describe('readPictureFits', () => {
  it('starts with the whole picture and no titles on a phone that never chose', () => {
    expect(readPictureFits(null, null)).toEqual(fits('fit'));
  });

  it('starts from the one choice the phone kept for every film before', () => {
    expect(readPictureFits(null, 'fill')).toEqual(fits('fill'));
    expect(readPictureFits(null, 'fit')).toEqual(fits('fit'));
  });

  it('reads back what was written, in the order chosen', () => {
    const kept = fits('fill', [
      ['tt1', 'fill'],
      ['tt2', 'fit'],
      ['tt3', 'fill'],
    ]);
    const read = readPictureFits(writePictureFits(kept), null);
    expect(read).toEqual(kept);
    expect([...read.titles.keys()]).toEqual(['tt1', 'tt2', 'tt3']);
  });

  it('keeps ids that look like numbers in the order chosen', () => {
    const kept = fits('fit', [
      ['300', 'fill'],
      ['20', 'fit'],
      ['tt1', 'fill'],
    ]);
    expect([...readPictureFits(writePictureFits(kept), null).titles.keys()]).toEqual([
      '300',
      '20',
      'tt1',
    ]);
  });

  it('pays no attention to the earlier choice once choices are kept', () => {
    expect(readPictureFits(writePictureFits(fits('fit')), 'fill')).toEqual(fits('fit'));
  });

  it('falls back to the earlier choice when what is kept cannot be read', () => {
    expect(readPictureFits('{not json', 'fill')).toEqual(fits('fill'));
    expect(readPictureFits('null', 'fill')).toEqual(fits('fill'));
    expect(readPictureFits('"fill"', null)).toEqual(fits('fit'));
    expect(readPictureFits('{"last":"fill","titles":{"tt1":"fill"}}', null)).toEqual(fits('fit'));
  });

  it('skips entries it cannot read, and takes an unknown fit as the whole picture', () => {
    const raw = JSON.stringify({
      last: 'cover',
      titles: [['tt1', 'fill'], 'tt2', [3, 'fill'], ['tt4', 'zoom'], ['tt5']],
    });
    expect(readPictureFits(raw, null)).toEqual(
      fits('fit', [
        ['tt1', 'fill'],
        ['tt4', 'fit'],
        ['tt5', 'fit'],
      ]),
    );
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

describe('fitFor', () => {
  it('opens a title as it was left, and one never chosen for as the last choice', () => {
    const kept = fits('fill', [['tt1', 'fit']]);
    expect(fitFor(kept, 'tt1')).toBe('fit');
    expect(fitFor(kept, 'tt2')).toBe('fill');
  });
});

describe('chooseFit', () => {
  it("keeps the title's choice and makes it the last one, for titles never chosen for", () => {
    const next = chooseFit(fits('fit'), 'tt1', 'fill');
    expect(next).toEqual(fits('fill', [['tt1', 'fill']]));
    expect(fitFor(next, 'tt2')).toBe('fill');
  });

  it("leaves other titles' choices as they were", () => {
    const next = chooseFit(fits('fill', [['tt1', 'fill']]), 'tt2', 'fit');
    expect(fitFor(next, 'tt1')).toBe('fill');
    expect(fitFor(next, 'tt2')).toBe('fit');
    expect(next.last).toBe('fit');
  });

  it('makes a title chosen for again the newest', () => {
    const kept = fits('fit', [
      ['tt1', 'fill'],
      ['tt2', 'fit'],
    ]);
    expect([...chooseFit(kept, 'tt1', 'fit').titles.keys()]).toEqual(['tt2', 'tt1']);
  });

  it('changes nothing when the title already has the choice and it was the last made', () => {
    const kept = fits('fill', [['tt1', 'fill']]);
    expect(chooseFit(kept, 'tt1', 'fill')).toBe(kept);
  });

  it('keeps the choice of a title that was following the last one', () => {
    // The same fit it showed, now its own: a later choice for another title leaves it.
    const kept = chooseFit(fits('fill'), 'tt1', 'fill');
    expect(fitFor(chooseFit(kept, 'tt2', 'fit'), 'tt1')).toBe('fill');
  });

  it('lets the oldest title go past the limit, which then opens with the last choice', () => {
    let kept = fits('fit');
    for (let n = 0; n < MAX_FIT_TITLES; n++) kept = chooseFit(kept, `tt${n}`, 'fill');
    kept = chooseFit(kept, 'tt0', 'fit');
    kept = chooseFit(kept, 'new', 'fit');
    expect(kept.titles.size).toBe(MAX_FIT_TITLES);
    // tt0 was chosen for again, so tt1 was the oldest.
    expect(kept.titles.has('tt0')).toBe(true);
    expect(kept.titles.has('tt1')).toBe(false);
    expect(fitFor(kept, 'tt1')).toBe('fit');
  });

  it('leaves the choices it was given as they were', () => {
    const kept = fits('fit', [['tt1', 'fit']]);
    chooseFit(kept, 'tt1', 'fill');
    expect(kept).toEqual(fits('fit', [['tt1', 'fit']]));
  });
});

describe('pictureFitStore', () => {
  it('starts every title with the whole picture on a phone that never chose', () => {
    const { items, storage } = memory();
    expect(pictureFitStore(storage).title('tt1').get()).toBe('fit');
    // Nothing is written until something is chosen.
    expect(items.size).toBe(0);
  });

  it('keeps each title its own choice, for the next launch too', () => {
    const { storage } = memory();
    const memoryOf = pictureFitStore(storage);
    memoryOf.title('film').set('fill');
    memoryOf.title('show').set('fit');
    expect(memoryOf.title('film').get()).toBe('fill');
    expect(memoryOf.title('show').get()).toBe('fit');
    const next = pictureFitStore(storage);
    expect(next.title('film').get()).toBe('fill');
    expect(next.title('show').get()).toBe('fit');
  });

  it('opens a title never chosen for with the last choice made on the phone', () => {
    const { storage } = memory();
    const memoryOf = pictureFitStore(storage);
    memoryOf.title('film').set('fill');
    expect(memoryOf.title('other').get()).toBe('fill');
    memoryOf.title('show').set('fit');
    expect(memoryOf.title('other').get()).toBe('fit');
    expect(pictureFitStore(storage).title('other').get()).toBe('fit');
  });

  it("moves the one choice for every film over once, as every title's starting point", () => {
    const { items, storage } = memory({ [EARLIER_FIT_KEY]: 'fill' });
    const memoryOf = pictureFitStore(storage);
    expect(memoryOf.title('tt1').get()).toBe('fill');
    expect(stored(items)).toEqual({ last: 'fill', titles: [] });
    memoryOf.title('tt1').set('fit');
    expect(pictureFitStore(storage).title('tt1').get()).toBe('fit');
    expect(pictureFitStore(storage).title('tt2').get()).toBe('fit');
  });

  it('leaves the earlier choice for an earlier update to read, and reads it no more', () => {
    const { items, storage } = memory({ [EARLIER_FIT_KEY]: 'fill' });
    pictureFitStore(storage).title('tt1').set('fit');
    // A phone put back on the earlier update still opens films filled, as it had them.
    expect(items.get(EARLIER_FIT_KEY)).toBe('fill');
    // Once this update is back, the choices it kept count, not that one.
    const back = pictureFitStore(storage);
    expect(back.title('tt1').get()).toBe('fit');
    expect(back.title('tt2').get()).toBe('fit');
    expect(stored(items)).toEqual({ last: 'fit', titles: [['tt1', 'fit']] });
  });

  it('reads the earlier choice no more once choices are kept', () => {
    const { storage } = memory({
      [PICTURE_FITS_KEY]: writePictureFits(fits('fit')),
      [EARLIER_FIT_KEY]: 'fill',
    });
    expect(pictureFitStore(storage).title('tt1').get()).toBe('fit');
  });

  it('tells those watching when a choice changes, and takes an update as well', () => {
    const { storage } = memory();
    const film = pictureFitStore(storage).title('film');
    let calls = 0;
    const stop = film.subscribe(() => calls++);
    film.set((fit) => (fit === 'fill' ? 'fit' : 'fill'));
    expect(film.get()).toBe('fill');
    expect(calls).toBe(1);
    // The same choice again changes nothing.
    film.set('fill');
    expect(calls).toBe(1);
    stop();
    film.set('fit');
    expect(calls).toBe(1);
  });

  it('keeps the newest titles only', () => {
    const { items, storage } = memory();
    const memoryOf = pictureFitStore(storage);
    for (let n = 0; n < MAX_FIT_TITLES + 5; n++)
      memoryOf.title(`tt${n}`).set(n % 2 ? 'fit' : 'fill');
    const { titles } = stored(items) as { titles: [string, PictureFit][] };
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
    const film = memoryOf.title('film');
    expect(film.get()).toBe('fit');
    film.set('fill');
    expect(film.get()).toBe('fill');
    expect(memoryOf.title('other').get()).toBe('fill');
  });

  it('keeps the earlier choice where it was if the new one cannot be written', () => {
    const { items, storage } = memory({ [EARLIER_FIT_KEY]: 'fill' });
    const full: FitStorage = {
      ...storage,
      setItem: () => {
        throw new Error('full');
      },
    };
    expect(pictureFitStore(full).title('tt1').get()).toBe('fill');
    expect(items.get(EARLIER_FIT_KEY)).toBe('fill');
  });
});
