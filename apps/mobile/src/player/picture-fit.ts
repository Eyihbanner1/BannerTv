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
 * Two fingers pinch the picture to any size from fit to a little past fill, and where it
 * overhangs they move it, so the viewer chooses what is cut off: a match filled with the top
 * kept, so the score stays on the screen, or a wide film with bars in its frame trimmed past
 * fill.
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
 *   (on a scale where each step makes it the same share bigger). Past fill it grows on, to
 *   BEYOND_FILL times the fill size at MAX_SIZE, for black bars a file carries in its frame.
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

/** What More's switch says the picture is: fit, fill (centred), or a size or place pinched. */
export function pictureChoice(frame: PictureFrame): 'fit' | 'fill' | 'custom' {
  if (isFit(frame)) return 'fit';
  return isFill(frame) ? 'fill' : 'custom';
}

/**
 * What More's switch makes of the picture: fit fills the screen, and anything else goes back to
 * the whole picture. A size or place pinched by hand goes back whole too rather than to fill,
 * because whole is the one choice that never cuts anything off; a second tap fills.
 */
export function switchedFrame(frame: PictureFrame): PictureFrame {
  return isFit(frame) ? FILL : FIT;
}

export interface Size {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

/** A rectangle on the screen, in the screen's own points, from its top left corner. */
export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** The shape taken for a picture until its own size is known: the TV's 16:9. */
export const ASSUMED_VIDEO: Size = { width: 16, height: 9 };

/** A picture's own size, when its player has said: two whole, positive numbers, or null. */
export function videoSizeOf(width: unknown, height: unknown): Size | null {
  const positive = (value: unknown): value is number =>
    typeof value === 'number' && Number.isFinite(value) && value > 0;
  return positive(width) && positive(height) ? { width, height } : null;
}

/** Standard definition's heights, and the widths its pictures are stored at. */
const SD_HEIGHTS = [576, 480];
const SD_WIDTHS = [720, 704, 544, 528, 480, 352];

/**
 * The shape a picture shows at, from the size Android's player says it is stored at. Media3
 * draws a picture whose pixels are not square at its true shape, but the size expo-video passes
 * on is the stored one, without that. So the sizes stored that way are taken as the 16:9 they
 * show at:
 * - standard definition, 720 by 576 or 480 and the narrower widths it is squeezed to, which is
 *   never stored with square pixels;
 * - HD squeezed to 1280 or 960 by 1080, which is never square either;
 * - for live sport and live channels (`live`), 1440 by 1080 and 960 by 720, which broadcasts
 *   squeeze HD to. A film or series of those sizes is usually a 4:3 picture with square pixels,
 *   so it keeps its size: taken as 16:9, it would jump as a pinch reached fill.
 *
 * A true 4:3 picture taken as 16:9 shows bars at its sides inside its rectangle, rather than
 * being cut off. Other pixels that are not square, and a file turned on its side, are still
 * shaped by their stored size. Not for the web build, whose <video> gives the shape it shows.
 */
export function shownShape(stored: Size, live: boolean): Size {
  const { width, height } = stored;
  const sd = SD_HEIGHTS.includes(height) && SD_WIDTHS.includes(width);
  const squeezedHd = height === 1080 && (width === 1280 || width === 960);
  const broadcastHd = (width === 1440 && height === 1080) || (width === 960 && height === 720);
  return sd || squeezedHd || (live && broadcastHd) ? ASSUMED_VIDEO : stored;
}

/**
 * The picture's size whole on this screen (fit) and covering it (fill). Worked out by
 * multiplying before dividing, so a size that comes out whole is exactly whole.
 */
function fitAndFill(screen: Size, video: Size): { fit: Size; fill: Size } {
  const byHeight = { width: (screen.height * video.width) / video.height, height: screen.height };
  const byWidth = { width: screen.width, height: (screen.width * video.height) / video.width };
  // A screen wider than the picture's shape fits it by its height and fills it by its width.
  return screen.width * video.height >= screen.height * video.width
    ? { fit: byHeight, fill: byWidth }
    : { fit: byWidth, fill: byHeight };
}

/** How many times its whole size the picture is at fill on this screen: 1 when the shapes match. */
export function fillZoom(screen: Size, video: Size): number {
  const { fit, fill } = fitAndFill(screen, video);
  return fill.width / fit.width;
}

/** How many times its whole size a picture of `size` is, when fill is `fill` times. */
export function zoomAt(size: number, fill: number): number {
  if (size <= 0) return 1;
  if (size <= 1) return fill ** size;
  return fill * BEYOND_FILL ** ((Math.min(size, MAX_SIZE) - 1) / (MAX_SIZE - 1));
}

/** The size of a picture `zoom` times its whole size: zoomAt the other way round. */
export function sizeAt(zoom: number, fill: number): number {
  if (zoom <= 1) return 0;
  if (zoom < fill) return Math.log(zoom) / Math.log(fill);
  return Math.min(MAX_SIZE, 1 + ((MAX_SIZE - 1) * Math.log(zoom / fill)) / Math.log(BEYOND_FILL));
}

/**
 * Where a picture `length` long starts along a side of the screen `screen` long, at `at`: as
 * PictureFrame's x and y say where it overhangs, and centred where it does not.
 */
function place(screen: number, length: number, at: number): number {
  const share = length > screen ? 1 + at : 1;
  return ((screen - length) * share) / 2 + 0;
}

/**
 * The picture's rectangle on the screen for `frame`, in the screen's points: the whole frame of
 * the video, which may be bigger than the screen, and the screen shows the part on it.
 */
export function pictureRect(screen: Size, video: Size, frame: PictureFrame): Rect {
  const { fit, fill } = fitAndFill(screen, video);
  let { width, height } = fit;
  if (frame.size === 1) ({ width, height } = fill);
  else if (frame.size > 0) {
    const zoom = zoomAt(frame.size, fill.width / fit.width);
    width = fit.width * zoom;
    height = fit.height * zoom;
  }
  return {
    left: place(screen.width, width, frame.x),
    top: place(screen.height, height, frame.y),
    width,
    height,
  };
}

/**
 * How the player screen draws the picture: its view across the screen (`rect` null) with
 * `contentFit` placing the picture in it, or its view laid out as the picture's own rectangle
 * (`rect`, possibly bigger than the screen, which shows the part on it) with the whole frame in
 * it. On Android expo-video draws into a SurfaceView, which does not follow a view's scale
 * reliably, so the picture is sized by its layout and never scaled; growing past the screen is
 * what fill does inside expo-video anyway.
 *
 * Fit, and fill centred, draw across the screen as they always have. Any other size or place
 * is laid out as its rectangle, taking the picture to be 16:9 until its own size is known, and
 * the view covers the screen until the screen has been measured. At every size and place the
 * subtitles Media3 draws itself (picture subtitles, PGS and DVB) stay on the screen where they
 * would be with the picture fitted: modules/banner-cues fits them to the screen as the window
 * shows it, not to the picture's view, and again whenever the picture changes size or moves.
 */
export interface PictureLayout {
  contentFit: 'contain' | 'cover';
  rect: Rect | null;
}

export function pictureLayout(
  frame: PictureFrame,
  screen: Size | null,
  video: Size | null,
): PictureLayout {
  const measured = screen !== null && screen.width > 0 && screen.height > 0;
  if (!measured || isFit(frame) || isFill(frame)) {
    return { contentFit: contentFitFor(frame), rect: null };
  }
  return { contentFit: 'contain', rect: pictureRect(screen, video ?? ASSUMED_VIDEO, frame) };
}

/** What the note says while the picture changes: fit, fill, or how big it is. */
export type PictureNote =
  | { kind: 'fit' }
  | { kind: 'fill' }
  | {
      kind: 'zoom';
      /** How big the picture is, as a share of its whole size: fit is 100. */
      percent: number;
    };

export function pictureNote(frame: PictureFrame, screen: Size | null, video: Size): PictureNote {
  if (isFit(frame)) return { kind: 'fit' };
  if (frame.size === 1) return { kind: 'fill' };
  const fill = screen && screen.width > 0 && screen.height > 0 ? fillZoom(screen, video) : 1;
  return { kind: 'zoom', percent: Math.round(zoomAt(frame.size, fill) * 100) };
}

/** Fit or fill when a frame is exactly one of the two sizes, for the buzz as a pinch reaches it. */
export function snapOf(frame: PictureFrame): 'fit' | 'fill' | null {
  if (frame.size === 0) return 'fit';
  return frame.size === 1 ? 'fill' : null;
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

/** The first two fingers on the screen, or null with fewer than two. */
export interface Fingers {
  a: Point;
  b: Point;
}

export function fingersOf(touches: readonly TouchPoint[] | undefined): Fingers | null {
  const a = touches?.[0];
  const b = touches?.[1];
  if (!a || !b) return null;
  return { a: { x: a.pageX, y: a.pageY }, b: { x: b.pageX, y: b.pageY } };
}

/**
 * Two fingers must spread or close this many points before the size changes, so fingers set
 * down, resting or settling never flicker it. It changes from there, so it never jumps.
 */
export const PINCH_MIN_PX = 24;
/** Both fingers must move this many points together before the picture moves with them. */
export const PAN_MIN_PX = 16;
/**
 * How far one finger's own movement, that the other has not made yet, counts towards the two
 * moving together. Two fingers dragged together never move exactly alike from one touch to the
 * next: one moves a little more, or not at all, and the next touch makes up for it. Carried
 * over, that keeps the picture under the fingers point for point. Fingers pinching move apart
 * for good, and past this many points what one moved alone is let go, so a drag after a pinch
 * trails the fingers by this much at most, and a pinch never moves the picture.
 */
export const PAN_SLACK_PX = 2;
/** Within this share of fit or fill (4 percent), a pinch lands on it exactly. */
export const SNAP = 0.04;
/**
 * A pinch landed on fit or fill stays there until it is this share away (5 percent), a little
 * further than it came in from. Fingers held still at the edge are never quite still, and would
 * otherwise make the picture jump on and off it, with a buzz each time.
 */
export const SNAP_OUT = 0.05;

/** A pinch on the picture, from the fingers coming down to the first of them lifting. */
export interface Pinch {
  /** The frame as the fingers came down. */
  from: PictureFrame;
  /** How far apart they came down. */
  spread: number;
  /**
   * How far apart they were as they first spread or closed past PINCH_MIN_PX: from there the
   * size follows them, as many times bigger as they are further apart. Null until then.
   */
  zoomFrom: number | null;
  /** Where the fingers were at the last move. */
  fingers: Fingers;
  /**
   * What each finger has moved that the other has not moved with it yet, each way, within
   * PAN_SLACK_PX: it counts as moving together once the other catches up.
   */
  left: Fingers;
  /** How far both have moved together so far, until it passes PAN_MIN_PX; then null. */
  drift: Point | null;
  /** Fit or fill when the pinch has landed on it, until it leaves by SNAP_OUT; else null. */
  snapped: 'fit' | 'fill' | null;
  /** The frame now. */
  frame: PictureFrame;
}

const STILL: Fingers = { a: { x: 0, y: 0 }, b: { x: 0, y: 0 } };

export function startPinch(frame: PictureFrame, fingers: Fingers): Pinch {
  const spread = Math.hypot(fingers.a.x - fingers.b.x, fingers.a.y - fingers.b.y);
  return {
    from: frame,
    spread,
    zoomFrom: null,
    fingers,
    left: STILL,
    drift: { x: 0, y: 0 },
    snapped: snapOf(frame),
    frame,
  };
}

/**
 * How far two fingers moved the same way along one direction: as far as the one that moved
 * less, and not at all when they went opposite ways. A pinch with one finger still, or both
 * spreading, moves nothing; two fingers dragged together move the picture.
 */
function together(a: number, b: number): number {
  if (a > 0 && b > 0) return Math.min(a, b);
  if (a < 0 && b < 0) return Math.max(a, b);
  return 0;
}

/**
 * What one finger moved along one direction (`moved`, with what it had left over) less what the
 * two moved together (`shared`), kept for the next touch within PAN_SLACK_PX.
 */
function leftOver(moved: number, shared: number): number {
  return clamp(moved - shared, -PAN_SLACK_PX, PAN_SLACK_PX) + 0;
}

/**
 * Whether a pinch at `zoom` (fill being `fill` times the whole picture) lands on fit or fill:
 * within SNAP of either, or still within SNAP_OUT of the one it had landed on (`snapped`).
 */
function snapAt(zoom: number, fill: number, snapped: Pinch['snapped']): Pinch['snapped'] {
  if (snapped === 'fit' && zoom <= 1 + SNAP_OUT) return 'fit';
  if (snapped === 'fill' && Math.abs(zoom / fill - 1) <= SNAP_OUT) return 'fill';
  if (zoom <= 1 + SNAP) return 'fit';
  if (Math.abs(zoom / fill - 1) <= SNAP) return 'fill';
  return null;
}

/**
 * Where the picture sits along one side once moved `by` points (x or y): moved as far as the
 * fingers, and kept covering the screen, so it never shows a gap where it overhangs. Centred
 * where it does not overhang.
 */
function moveAlong(screen: number, length: number, at: number, by: number): number {
  const over = length - screen;
  if (over <= 0) return 0;
  return Math.min(1, Math.max(-1, at - (2 * by) / over)) + 0;
}

/**
 * The pinch once the fingers are at `fingers`, on a screen `screen` big showing a picture of
 * `video`'s shape. The size follows how far apart the fingers are, from the size it had as they
 * came down, between fit and MAX_SIZE, and lands exactly on fit or fill within SNAP of them,
 * staying there until SNAP_OUT. The place follows the fingers as they move together, where the
 * picture overhangs.
 */
export function movePinch(pinch: Pinch, fingers: Fingers, screen: Size, video: Size): Pinch {
  const fill = fillZoom(screen, video);
  const spread = Math.hypot(fingers.a.x - fingers.b.x, fingers.a.y - fingers.b.y);
  let zoomFrom = pinch.zoomFrom;
  if (zoomFrom === null && Math.abs(spread - pinch.spread) >= PINCH_MIN_PX) zoomFrom = spread;
  let size = pinch.frame.size;
  let snapped = pinch.snapped;
  if (zoomFrom !== null && zoomFrom > 0) {
    const raw = (zoomAt(pinch.from.size, fill) * spread) / zoomFrom;
    const zoom = clamp(raw, 1, fill * BEYOND_FILL);
    snapped = snapAt(zoom, fill, snapped);
    size = snapped === 'fit' ? 0 : snapped === 'fill' ? 1 : sizeAt(zoom, fill);
  }
  // What each finger has moved since the picture last moved with both, each way: this touch's
  // movement and what was left over from the ones before.
  const a = {
    x: pinch.left.a.x + fingers.a.x - pinch.fingers.a.x,
    y: pinch.left.a.y + fingers.a.y - pinch.fingers.a.y,
  };
  const b = {
    x: pinch.left.b.x + fingers.b.x - pinch.fingers.b.x,
    y: pinch.left.b.y + fingers.b.y - pinch.fingers.b.y,
  };
  const moved = { x: together(a.x, b.x), y: together(a.y, b.y) };
  const left = {
    a: { x: leftOver(a.x, moved.x), y: leftOver(a.y, moved.y) },
    b: { x: leftOver(b.x, moved.x), y: leftOver(b.y, moved.y) },
  };
  let drift = pinch.drift;
  let by = { x: 0, y: 0 };
  if (drift === null) by = moved;
  else {
    drift = { x: drift.x + moved.x, y: drift.y + moved.y };
    // From here on the picture moves with the fingers; what they moved to get here does not count.
    if (Math.hypot(drift.x, drift.y) >= PAN_MIN_PX) drift = null;
  }
  // Fingers resting, or not yet past either dead zone, leave the frame exactly as it was.
  if (size === pinch.frame.size && by.x === 0 && by.y === 0) {
    return { ...pinch, zoomFrom, fingers, left, drift, snapped };
  }
  const rect = pictureRect(screen, video, { ...pinch.frame, size });
  const frame = {
    size,
    x: moveAlong(screen.width, rect.width, pinch.frame.x, by.x),
    y: moveAlong(screen.height, rect.height, pinch.frame.y, by.y),
  };
  return {
    ...pinch,
    zoomFrom,
    fingers,
    left,
    drift,
    snapped,
    frame: sameFrame(frame, pinch.frame) ? pinch.frame : frame,
  };
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
