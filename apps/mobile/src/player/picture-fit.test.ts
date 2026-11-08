import { describe, expect, it } from 'vitest';
import {
  contentFitFor,
  type FitStorage,
  PICTURE_FIT_KEY,
  pictureFitStore,
  pinchFit,
  readPictureFit,
  touchSpread,
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

describe('pictureFitStore', () => {
  it('starts with the whole picture on a phone that never chose', () => {
    const { storage } = memory();
    expect(pictureFitStore(storage).get()).toBe('fit');
  });

  it('starts with what this phone chose before', () => {
    const { storage } = memory({ [PICTURE_FIT_KEY]: 'fill' });
    expect(pictureFitStore(storage).get()).toBe('fill');
  });

  it('keeps each change for the next film and the next launch', () => {
    const { items, storage } = memory();
    const store = pictureFitStore(storage);
    store.set('fill');
    expect(items.get(PICTURE_FIT_KEY)).toBe('fill');
    expect(pictureFitStore(storage).get()).toBe('fill');
    store.set('fit');
    expect(items.get(PICTURE_FIT_KEY)).toBe('fit');
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
    const store = pictureFitStore(broken);
    expect(store.get()).toBe('fit');
    store.set('fill');
    expect(store.get()).toBe('fill');
  });
});
