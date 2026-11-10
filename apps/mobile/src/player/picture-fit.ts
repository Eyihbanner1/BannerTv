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
 * never chosen for opens with the last choice made on this phone for its kind: one for live
 * sport and live channels, one for films and series. Pure, so it is unit-tested; the player
 * screen does the touches and the drawing.
 */

/**
 * A picture's size and where it sits, in numbers that mean the same on any screen.
 *
 * - size: 0 is fit and 1 is fill. In between, the picture is that far from one to the other
 *   (on a scale where each step makes it the same share bigger). Past fill it grows on to
 *   BEYOND_FILL times the fill size at MAX_SIZE, to trim black bars a file carries inside its frame.
 * - x and y: where the picture sits in the part of it that overhangs the screen, from -1 (its
 *   left or top edge on the screen's) through 0 (centred) to 1 (its right or bottom edge). Where
 *   nothing overhangs, the picture is centred whatever they say.
 */
export interface PictureFrame {
  size: number;
  x: number;
  y: number;
}

/** The whole frame, centred. */
export const FIT: PictureFrame = { size: 0, x: 0, y: 0 };
/** The frame covering the screen, centred: what overhangs is cut off evenly on both sides. */
export const FILL: PictureFrame = { size: 1, x: 0, y: 0 };
/** The biggest size: BEYOND_FILL times the fill size. */
export const MAX_SIZE = 2;
/** How much bigger than fill the picture can grow. */
export const BEYOND_FILL = 1.35;

/** Whether the picture shows whole. */
export function isFit(frame: PictureFrame): boolean {
  return frame.size === 0;
}

/** Whether the picture covers the screen exactly, centred. */
export function isFill(frame: PictureFrame): boolean {
  return frame.size === 1 && frame.x === 0 && frame.y === 0;
}

export function sameFrame(a: PictureFrame | undefined, b: PictureFrame | undefined): boolean {
  return !!a && !!b && a.size === b.size && a.x === b.x && a.y === b.y;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/** To a thousandth, which is under a pixel on any phone; adding 0 turns -0 into 0. */
function round(value: number): number {
  return Math.round(value * 1000) / 1000 + 0;
}

/**
 * A frame as it is kept: in range, to a thousandth, and with no position at fit, where nothing
 * overhangs on any screen.
 */
export function keptFrame(frame: PictureFrame): PictureFrame {
  const size = round(clamp(frame.size, 0, MAX_SIZE));
  if (size === 0) return FIT;
  return { size, x: round(clamp(frame.x, -1, 1)), y: round(clamp(frame.y, -1, 1)) };
}

/** Where the choices are kept, in the phone's own storage. */
export const PICTURE_FITS_KEY = 'bannertv.phone.pictureFits';
/** Where the phone kept one choice for every film before; read once, as the starting default. */
export const EARLIER_FIT_KEY = 'bannertv.phone.pictureFit';
/** Titles that keep their own choice: the most recently chosen, so the storage stays small. */
export const MAX_FIT_TITLES = 200;

/**
 * A frame as stored: 'fit' or 'fill' as earlier updates kept them, and anything else as its
 * numbers. A phone put back on an earlier update (as expo-updates does when an update fails to
 * start) reads 'fit' and 'fill' as it always did, and takes the numbers for fit.
 */
export type StoredFrame = 'fit' | 'fill' | PictureFrame;

/** The stored frame; anything that cannot be read is fit, the whole picture. */
export function readPictureFrame(raw: unknown): PictureFrame {
  if (raw === 'fill') return FILL;
  if (typeof raw !== 'object' || raw === null) return FIT;
  const { size, x, y } = raw as Partial<Record<keyof PictureFrame, unknown>>;
  const number = (value: unknown): value is number =>
    typeof value === 'number' && Number.isFinite(value);
  if (!number(size) || !number(x) || !number(y)) return FIT;
  return keptFrame({ size, x, y });
}

export function writePictureFrame(frame: PictureFrame): StoredFrame {
  if (isFit(frame)) return 'fit';
  if (isFill(frame)) return 'fill';
  return { size: frame.size, x: frame.x, y: frame.y };
}

/**
 * The kinds of title that keep a last choice of their own. A match is framed the way the last
 * match was (the score in a corner kept on the screen, say), and that should not change how the
 * next film opens.
 * - live: live sport, a match's replay, and live channels;
 * - film: films and series.
 */
export type PictureKind = 'live' | 'film';

/** This phone's choices: each title's own, and the last one made of each kind. */
export interface PictureFits {
  last: Readonly<Record<PictureKind, PictureFrame>>;
  /** By the title's id (a film's, or a series' for all its episodes), the oldest choice first. */
  titles: ReadonlyMap<string, PictureFrame>;
}

/**
 * The choices as stored (`raw`). With none kept yet, or none that can be read, the phone starts
 * from the one choice it kept for every film before (`earlier`), so nobody loses theirs. Choices
 * kept before there were two kinds had one last choice, and it starts both.
 */
export function readPictureFits(raw: string | null, earlier: string | null): PictureFits {
  const titles = new Map<string, PictureFrame>();
  let saved: unknown;
  try {
    saved = raw === null ? undefined : JSON.parse(raw);
  } catch {
    saved = undefined;
  }
  const list = (saved as { titles?: unknown } | null | undefined)?.titles;
  if (!Array.isArray(list)) {
    const start = readPictureFrame(earlier);
    return { last: { live: start, film: start }, titles };
  }
  for (const entry of list.slice(-MAX_FIT_TITLES) as unknown[]) {
    if (!Array.isArray(entry) || typeof entry[0] !== 'string') continue;
    titles.delete(entry[0]);
    titles.set(entry[0], readPictureFrame(entry[1]));
  }
  const { last, live } = saved as { last?: unknown; live?: unknown };
  const film = readPictureFrame(last);
  return { last: { live: live === undefined ? film : readPictureFrame(live), film }, titles };
}

/**
 * The choices as they are stored: a list keeps the titles' order, as an object's keys may not.
 * `last` is the films' and series', where an earlier update looks for its one last choice.
 */
export function writePictureFits(fits: PictureFits): string {
  return JSON.stringify({
    last: writePictureFrame(fits.last.film),
    live: writePictureFrame(fits.last.live),
    titles: Array.from(fits.titles, ([id, frame]) => [id, writePictureFrame(frame)]),
  });
}

/** How a title opens: as it was left, or as the last title of its kind chosen for was left. */
export function fitFor(fits: PictureFits, title: string, kind: PictureKind): PictureFrame {
  return fits.titles.get(title) ?? fits.last[kind];
}

/**
 * The choices once `frame` is chosen for `title`: its own, the newest, and the last one made for
 * its kind. Past MAX_FIT_TITLES the oldest goes, and opens with its kind's last choice again.
 */
export function chooseFit(
  fits: PictureFits,
  title: string,
  frame: PictureFrame,
  kind: PictureKind,
): PictureFits {
  const kept = keptFrame(frame);
  if (sameFrame(fits.titles.get(title), kept) && sameFrame(fits.last[kind], kept)) return fits;
  const titles = new Map(fits.titles);
  titles.delete(title);
  titles.set(title, kept);
  while (titles.size > MAX_FIT_TITLES) titles.delete(titles.keys().next().value!);
  return { last: { ...fits.last, [kind]: kept }, titles };
}

/** expo-video's contentFit for a frame: contain shows the whole frame, cover fills the screen. */
export function contentFitFor(frame: PictureFrame): 'contain' | 'cover' {
  return frame.size >= 1 ? 'cover' : 'contain';
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

/** Two fingers must spread (or close) to this many times as far apart as they were... */
export const PINCH_RATIO = 1.2;
/** ...and move this many points, so fingers set down close together do not flicker it. */
export const PINCH_MIN_PX = 24;

/**
 * What two fingers going from `from` to `to` points apart ask for: fill as they spread, fit as
 * they close, and null while the change is too small to tell.
 */
export function pinchFit(from: number, to: number): PictureFrame | null {
  if (to - from >= PINCH_MIN_PX && to >= from * PINCH_RATIO) return FILL;
  if (from - to >= PINCH_MIN_PX && from >= to * PINCH_RATIO) return FIT;
  return null;
}

/** The part of Web Storage the choices need. */
export interface FitStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** The phone's choices, read from `storage` and saved there whenever one changes. */
export interface PictureFitMemory {
  /**
   * One title's frame, to show and to change: a film's id, or a series' for every episode, and
   * the kind of title it is, for its last choice.
   */
  title(id: string, kind: PictureKind): Store<PictureFrame>;
}

export function pictureFitStore(storage: FitStorage): PictureFitMemory {
  let initial = readPictureFits(null, null);
  try {
    const raw = storage.getItem(PICTURE_FITS_KEY);
    const earlier = raw === null ? storage.getItem(EARLIER_FIT_KEY) : null;
    initial = readPictureFits(raw, earlier);
    // The one choice moves over once; from then on each title's choice is what counts. The
    // earlier key stays as it was, so a phone put back on an earlier update (as expo-updates
    // does when an update fails to start) still opens films the way they were left.
    if (earlier !== null) storage.setItem(PICTURE_FITS_KEY, writePictureFits(initial));
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
    title: (id, kind) => ({
      get: () => fitFor(store.get(), id, kind),
      set: (next) =>
        store.set((fits) =>
          chooseFit(
            fits,
            id,
            typeof next === 'function' ? next(fitFor(fits, id, kind)) : next,
            kind,
          ),
        ),
      subscribe: store.subscribe,
    }),
  };
}
