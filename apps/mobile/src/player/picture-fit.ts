import { createStore, type Store } from '@bannertv/core';

/**
 * How the picture sits on the phone's screen. Phones are wider than the 16:9 frame films and
 * series are made in for TV (about 19.5:9 to 16:9), and many film files keep a wide film's
 * black bars inside that 16:9 frame. Fitted whole, such a film shows bars on all four sides.
 *
 * - fit: the whole frame shows, with bars where its shape and the screen's differ.
 * - fill: the frame covers the screen and what overhangs is cut off. The bars a file carries go
 *   first, so a wide film framed that way fills the width and loses nothing of the picture.
 *
 * Kept on the phone for each title, not with the profile or the account: it is about how this
 * screen shows that film or series, and one film's frame is not another's. Every episode of a
 * series shares its show's choice, so the next episode opens the way the last was left. A title
 * never chosen for opens with the last choice made on this phone. Pure, so it is unit-tested;
 * the player screen does the touches and the drawing.
 */
export type PictureFit = 'fit' | 'fill';

/** Where the choices are kept, in the phone's own storage. */
export const PICTURE_FITS_KEY = 'bannertv.phone.pictureFits';
/** Where the phone kept one choice for every film before; read once, as the starting default. */
export const EARLIER_FIT_KEY = 'bannertv.phone.pictureFit';
/** Titles that keep their own choice: the most recently chosen, so the storage stays small. */
export const MAX_FIT_TITLES = 200;

/** Two fingers must spread (or close) to this many times as far apart as they were... */
export const PINCH_RATIO = 1.2;
/** ...and move this many points, so fingers set down close together do not flicker it. */
export const PINCH_MIN_PX = 24;

/** The stored choice; anything else is fit, the whole picture. */
export function readPictureFit(raw: unknown): PictureFit {
  return raw === 'fill' ? 'fill' : 'fit';
}

/** expo-video's contentFit for a fit: contain shows the whole frame, cover fills the screen. */
export function contentFitFor(fit: PictureFit): 'contain' | 'cover' {
  return fit === 'fill' ? 'cover' : 'contain';
}

/** This phone's choices: each title's own, and the last one made, for a title never chosen for. */
export interface PictureFits {
  last: PictureFit;
  /** By the title's id (a film's, or a series' for all its episodes), the oldest choice first. */
  titles: ReadonlyMap<string, PictureFit>;
}

/**
 * The choices as stored (`raw`). With none kept yet, or none that can be read, the phone starts
 * from the one choice it kept for every film before (`earlier`), so nobody loses theirs.
 */
export function readPictureFits(raw: string | null, earlier: string | null): PictureFits {
  const titles = new Map<string, PictureFit>();
  let saved: unknown;
  try {
    saved = raw === null ? undefined : JSON.parse(raw);
  } catch {
    saved = undefined;
  }
  const list = (saved as { titles?: unknown } | null | undefined)?.titles;
  if (!Array.isArray(list)) return { last: readPictureFit(earlier), titles };
  for (const entry of list.slice(-MAX_FIT_TITLES) as unknown[]) {
    if (!Array.isArray(entry) || typeof entry[0] !== 'string') continue;
    titles.delete(entry[0]);
    titles.set(entry[0], readPictureFit(entry[1]));
  }
  return { last: readPictureFit((saved as { last?: unknown }).last), titles };
}

/** The choices as they are stored: a list keeps the titles' order, as an object's keys may not. */
export function writePictureFits(fits: PictureFits): string {
  return JSON.stringify({ last: fits.last, titles: Array.from(fits.titles) });
}

/** How a title opens: as it was left, or as the last title chosen for was left. */
export function fitFor(fits: PictureFits, title: string): PictureFit {
  return fits.titles.get(title) ?? fits.last;
}

/**
 * The choices once `fit` is chosen for `title`: its own, the newest, and the last one made.
 * Past MAX_FIT_TITLES the oldest goes, and opens with the last choice again.
 */
export function chooseFit(fits: PictureFits, title: string, fit: PictureFit): PictureFits {
  if (fits.titles.get(title) === fit && fits.last === fit) return fits;
  const titles = new Map(fits.titles);
  titles.delete(title);
  titles.set(title, fit);
  while (titles.size > MAX_FIT_TITLES) titles.delete(titles.keys().next().value!);
  return { last: fit, titles };
}

export interface TouchPoint {
  pageX: number;
  pageY: number;
}

/** How far apart the first two fingers on the screen are, or null with fewer than two. */
export function touchSpread(touches: readonly TouchPoint[] | undefined): number | null {
  const a = touches?.[0];
  const b = touches?.[1];
  if (!a || !b) return null;
  return Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY);
}

/**
 * What two fingers going from `from` to `to` points apart ask for: fill as they spread, fit as
 * they close, and null while the change is too small to tell.
 */
export function pinchFit(from: number, to: number): PictureFit | null {
  if (to - from >= PINCH_MIN_PX && to >= from * PINCH_RATIO) return 'fill';
  if (from - to >= PINCH_MIN_PX && from >= to * PINCH_RATIO) return 'fit';
  return null;
}

/** The part of Web Storage the choices need. */
export interface FitStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** The phone's choices, read from `storage` and saved there whenever one changes. */
export interface PictureFitMemory {
  /** One title's fit, to show and to change: a film's id, or a series' for every episode. */
  title(id: string): Store<PictureFit>;
}

export function pictureFitStore(storage: FitStorage): PictureFitMemory {
  let initial = readPictureFits(null, null);
  try {
    const raw = storage.getItem(PICTURE_FITS_KEY);
    const earlier = raw === null ? storage.getItem(EARLIER_FIT_KEY) : null;
    initial = readPictureFits(raw, earlier);
    // The one choice moves over once; from then on each title's choice is what counts.
    if (earlier !== null) {
      storage.setItem(PICTURE_FITS_KEY, writePictureFits(initial));
      storage.removeItem(EARLIER_FIT_KEY);
    }
  } catch {
    // Without storage the picture starts whole.
  }
  const store = createStore<PictureFits>(initial);
  store.subscribe(() => {
    try {
      storage.setItem(PICTURE_FITS_KEY, writePictureFits(store.get()));
    } catch {
      // Then the choices last until the app closes.
    }
  });
  return {
    title: (id) => ({
      get: () => fitFor(store.get(), id),
      set: (next) =>
        store.set((fits) =>
          chooseFit(fits, id, typeof next === 'function' ? next(fitFor(fits, id)) : next),
        ),
      subscribe: store.subscribe,
    }),
  };
}
