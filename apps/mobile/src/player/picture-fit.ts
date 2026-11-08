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
 * Kept on the phone, not with the profile or the account: it is about this screen. Pure, so it
 * is unit-tested; the player screen does the touches and the drawing.
 */
export type PictureFit = 'fit' | 'fill';

/** Where the choice is kept, in the phone's own storage. */
export const PICTURE_FIT_KEY = 'bannertv.phone.pictureFit';

/** Two fingers must spread (or close) to this many times as far apart as they were... */
export const PINCH_RATIO = 1.2;
/** ...and move this many points, so fingers set down close together do not flicker it. */
export const PINCH_MIN_PX = 24;

/** The stored choice; anything else is fit, the whole picture. */
export function readPictureFit(raw: string | null): PictureFit {
  return raw === 'fill' ? 'fill' : 'fit';
}

/** expo-video's contentFit for a fit: contain shows the whole frame, cover fills the screen. */
export function contentFitFor(fit: PictureFit): 'contain' | 'cover' {
  return fit === 'fill' ? 'cover' : 'contain';
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

/** The part of Web Storage the choice needs. */
export interface FitStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** The phone's fit, read from `storage` and saved there whenever it changes. */
export function pictureFitStore(storage: FitStorage): Store<PictureFit> {
  let initial: PictureFit = 'fit';
  try {
    initial = readPictureFit(storage.getItem(PICTURE_FIT_KEY));
  } catch {
    // Without storage the picture starts whole.
  }
  const store = createStore<PictureFit>(initial);
  store.subscribe(() => {
    try {
      storage.setItem(PICTURE_FIT_KEY, store.get());
    } catch {
      // Then the choice lasts until the app closes.
    }
  });
  return store;
}
