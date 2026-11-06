import { sinceActivity } from '../navigation/activity';
import { mark } from '../platform/marks';
import { tuning } from '../platform/tuning';

/**
 * Art bigger than this many times its drawn size is left alone. Decoding
 * ahead decodes at full size; a tile drawn at about full size (posters,
 * logos) then draws from that same copy, but wide art, drawn at 0.4 of its
 * 1920 px, would cost a full-size copy where drawing it keeps a half-size one.
 * With `aheadOversize` 2 the browser's own rule decides instead.
 */
const MAX_OVERSIZE = 1.5;
/** No decode starts until the remote has been still this long, so a press's own frames go first. */
const QUIET_MS = 150;
/** Frames closer than this count as flowing again: the last press has been drawn. */
const FLOWING_MS = 25;
/**
 * Art asked within this long is not asked again, so going back over rows
 * whose art was just decoded costs nothing. Later, its decoded copy may
 * have been dropped, and asking again is cheap if it was not.
 */
const ASK_AGAIN_MS = 20000;
/**
 * With `aheadMode` raster, the most images kept drawn under the rail. Each
 * holds its decoded copy in graphics memory while it is drawn (a wide tile's
 * about 2 MB), on a TV with little to spare, so the oldest goes first.
 */
export const MAX_WARM = 10;

/** When each address was asked, oldest first. Addresses, not elements: a row drawn again has new ones. */
const asked = new Map<string, number>();
const watched = new WeakSet<HTMLElement>();
/**
 * The key of the row a stack last moved to. A key, not the element, so a
 * screen that has closed is not kept in memory.
 */
let currentKey: string | null = null;
let movedUp = false;
/**
 * With `gridAhead`, the tiles of a poster grid that its next press brings
 * into view, nearest first, standing in for the rows after the current one.
 * The grid hands them over each time it moves and lets go when it closes;
 * a stack of rows that moves to another row takes over from them. One that
 * only lays out again where it was does not: Home does that under See all
 * when Continue Watching or the live row changes.
 */
let grid: { track: HTMLElement; key: string; tiles: HTMLElement[] } | null = null;
let decoding = false;
let frame = 0;
let lastFrameAt = 0;
let flowingFrames = 0;

/** The box under the rail that raster mode draws art in, while the rail is drawn. */
let warmBox: HTMLElement | null = null;
/**
 * The art drawn there, oldest first, with the number of slides there had
 * been when it was drawn, and whether it was a poster grid's.
 */
const warm: { image: HTMLImageElement; slide: number; grid: boolean }[] = [];
/** Row changes so far: art drawn ahead goes once the view has moved on past the row it was for. */
let slides = 0;
/** Art was just drawn under the rail, for this row, and the frames after it have yet to flow. */
let warming = false;
let warmingKey: string | null = null;

interface Size {
  width: number;
  height: number;
}

/**
 * Whether art of its natural size, drawn at `drawn` device px, is worth
 * decoding ahead at full size. With `aheadOversize` 1.5, art up to 1.5 times
 * its drawn width. With 2, the browser's own rule: it draws from a half-size
 * copy only when that copy, rounded up, still covers the drawn size, also
 * rounded up, both ways, and from the full-size copy whenever the art is
 * cropped. Any other art is decoded at full size when drawn anyway.
 */
export function worthDecodingAt(
  natural: Size,
  drawn: Size,
  oversize: 1.5 | 2,
  cropped: boolean,
): boolean {
  if (oversize !== 2) return natural.width <= drawn.width * MAX_OVERSIZE;
  return (
    cropped ||
    Math.ceil(natural.width / 2) < Math.ceil(drawn.width) ||
    Math.ceil(natural.height / 2) < Math.ceil(drawn.height)
  );
}

/**
 * Where art lands in its box, by its object-fit, in whole device px as the
 * page is drawn: `cover` fills the box and crops what is left over, if any
 * is once rounded; `contain` fits inside it; anything else fills it.
 */
export function fitArt(fit: string, natural: Size, box: Size): { drawn: Size; cropped: boolean } {
  const edge = whole(box);
  if (fit !== 'cover' && fit !== 'contain') return { drawn: edge, cropped: false };
  const across = box.width / natural.width;
  const down = box.height / natural.height;
  const scale = fit === 'cover' ? Math.max(across, down) : Math.min(across, down);
  const drawn = whole({ width: natural.width * scale, height: natural.height * scale });
  const cropped = fit === 'cover' && (drawn.width > edge.width || drawn.height > edge.height);
  return { drawn: cropped ? edge : drawn, cropped };
}

function whole(size: Size): Size {
  return { width: Math.round(size.width), height: Math.round(size.height) };
}

/** Art is got ready by drawing it under the rail, which App then draws a box for. */
export const RASTER_AHEAD = tuning.decodeAhead && tuning.aheadMode === 'raster';
/** Poster grids hand over the tiles their next press shows. */
export const GRID_AHEAD = tuning.decodeAhead && tuning.gridAhead;

/** Decoding ahead is on, and this browser can do it the way asked. */
function canGetReady(): boolean {
  return (
    tuning.decodeAhead && (RASTER_AHEAD || typeof HTMLImageElement.prototype.decode === 'function')
  );
}

function isRow(element: Element | null | undefined): element is HTMLElement {
  return element instanceof HTMLElement && element.hasAttribute('data-row-key');
}

function rowElement(key: string | null): Element | null {
  return key ? document.querySelector(`[data-row-key="${key}"]`) : null;
}

/**
 * The row after next, which the next Down brings into view (the next row
 * already shows its top), and after an Up, first the row above. Looked up
 * each time: a row far from focus is an empty box until it is drawn, and
 * drawing it puts a new element in its place.
 */
function targets(): HTMLElement[] {
  if (grid) return grid.tiles;
  const current = rowElement(currentKey);
  if (!current) return [];
  const next = current.nextElementSibling;
  const afterNext = next && next.nextElementSibling;
  return (movedUp ? [current.previousElementSibling, afterNext] : [afterNext]).filter(isRow);
}

function wasAsked(src: string, now: number): boolean {
  const at = asked.get(src);
  return at !== undefined && now - at < ASK_AGAIN_MS;
}

function noteAsked(src: string, now: number): void {
  asked.delete(src);
  asked.set(src, now);
  // Oldest first, so the stale ones are at the front.
  for (const [old, at] of asked) {
    if (now - at < ASK_AGAIN_MS) break;
    asked.delete(old);
  }
}

/**
 * Where the art is drawn, if it is loaded, drawn across the screen (not a
 * tile drawn past the row's edge), and worth getting ready. Decoding takes
 * art about its drawn size (see `aheadOversize`); drawing it under the rail
 * takes any, as the browser draws that from the copy its size needs.
 */
function drawnBox(image: HTMLImageElement, now: number): DOMRect | null {
  if (!image.complete || image.naturalWidth === 0 || wasAsked(image.src, now)) return null;
  const box = image.getBoundingClientRect();
  if (box.width === 0 || box.right <= 0 || box.left >= window.innerWidth) return null;
  if (RASTER_AHEAD) return box;
  const ratio = window.devicePixelRatio || 1;
  const natural = { width: image.naturalWidth, height: image.naturalHeight };
  const shown = { width: box.width * ratio, height: box.height * ratio };
  if (tuning.aheadOversize !== 2) return worthDecodingAt(natural, shown, 1.5, false) ? box : null;
  const { drawn, cropped } = fitArt(getComputedStyle(image).objectFit, natural, shown);
  return worthDecodingAt(natural, drawn, 2, cropped) ? box : null;
}

interface Next {
  image: HTMLImageElement;
  box: DOMRect;
  key: string | null;
}

/** The first art across the screen, left to right, of the first target row (or tile) that has some. */
function nextImage(now: number): Next | null {
  for (const row of targets()) {
    const found = row.getElementsByTagName('img');
    for (let i = 0; i < found.length; i++) {
      const box = drawnBox(found[i]!, now);
      if (box) {
        return { image: found[i]!, box, key: grid ? grid.key : row.getAttribute('data-row-key') };
      }
    }
  }
  return null;
}

function decode({ image, key }: Next): void {
  decoding = true;
  const settled = () => {
    decoding = false;
    mark(`ahead-done:${key}`);
    schedule();
  };
  image.decode().then(settled, settled);
}

function unwarm(image: HTMLImageElement): void {
  if (image.parentNode) image.parentNode.removeChild(image);
}

/**
 * Draws a copy of the art under the rail, at the size and with the classes
 * of the art itself, so its fit and filtering match. The two share the
 * address and so the browser's decoded copy: drawing the copy decodes and
 * uploads it at the size the tile will draw it.
 *
 * The art was measured on the screen, and the page may be scaled down to
 * fit a smaller window (main.tsx), as a 1080p Android TV's is by half. The
 * box, 1 px wide in the page, measures by how much, so the copy is sized in
 * the page's own px and is then scaled just as the tile is.
 */
function drawWarm(box: HTMLElement, { image, box: drawn, key }: Next): void {
  const scale = box.getBoundingClientRect().width || 1;
  const copy = document.createElement('img');
  copy.className = image.className;
  const decodingAttribute = image.getAttribute('decoding');
  if (decodingAttribute) copy.setAttribute('decoding', decodingAttribute);
  copy.alt = '';
  copy.draggable = false;
  copy.style.cssText = `position:absolute;left:0;top:0;right:auto;bottom:auto;width:${drawn.width / scale}px;height:${drawn.height / scale}px;max-width:none;max-height:none`;
  copy.src = image.src;
  box.appendChild(copy);
  warm.push({ image: copy, slide: slides, grid: grid !== null });
  while (warm.length > MAX_WARM) unwarm(warm.shift()!.image);
  // The frame that draws it is this one; wait for those after it to flow.
  warming = true;
  warmingKey = key;
  flowingFrames = 0;
  schedule();
}

/** A row change: the art drawn ahead before the one before it has had its row brought into view. */
function slid(): void {
  slides++;
  while (warm.length > 0 && warm[0]!.slide < slides - 1) unwarm(warm.shift()!.image);
}

/**
 * Each frame while there is art to decode: starts one decode once the
 * remote is quiet and frames flow, and stops asking for frames when there
 * is nothing left. While a decode runs it asks for none: the decode's end
 * asks again, and the frames after it have to flow before the next. Art
 * drawn under the rail instead counts as done once two frames after the
 * one that drew it have flowed.
 */
function tick(time: number): void {
  frame = 0;
  flowingFrames = lastFrameAt > 0 && time - lastFrameAt < FLOWING_MS ? flowingFrames + 1 : 0;
  lastFrameAt = time;
  if (decoding) return;
  if (warming) {
    if (flowingFrames < 2) return schedule();
    warming = false;
    mark(`ahead-done:${warmingKey}`);
  }
  if (flowingFrames < 2 || sinceActivity() < QUIET_MS) return schedule();
  // Nowhere to draw while the rail is not drawn (the player): the box's return asks again.
  const box = RASTER_AHEAD ? warmBox : null;
  const now = Date.now();
  const next = !RASTER_AHEAD || box ? nextImage(now) : null;
  if (next) {
    noteAsked(next.image.src, now);
    mark(`ahead:${next.key}`);
    if (box) drawWarm(box, next);
    else decode(next);
  } else lastFrameAt = 0;
}

function schedule(): void {
  if (frame === 0) frame = requestAnimationFrame(tick);
}

/** Art that loads in a target row after its slide: it joins the queue. */
function onLoad(event: Event): void {
  const image = event.target;
  if (!(image instanceof HTMLImageElement)) return;
  if (targets().some((row) => row.contains(image))) schedule();
}

function watch(track: HTMLElement): void {
  if (watched.has(track)) return;
  watched.add(track);
  // Load events do not bubble, but they can be caught on the way down.
  track.addEventListener('load', onLoad, true);
}

/**
 * The ref of the box raster mode draws art in: 1 px, drawn just before the
 * rail, whose opaque backdrop covers it, and only while the rail is drawn.
 * Its art goes with it.
 */
export function warmBoxRef(element: HTMLElement | null): void {
  warmBox = element;
  warm.length = 0;
  if (element) schedule();
}

/**
 * With the `decodeAhead` switch, decodes the posters and logos across the
 * screen of the row the next press will show, once it has loaded: the row
 * after next, and after an Up the row above too. Rows clipped out of view
 * are never drawn, so their art would otherwise decode in the frame that
 * first shows it. The decoded copy is kept for drawing, so that frame only
 * has to upload it. With `aheadMode` raster the art, wide art too, is drawn
 * under the rail instead, which uploads it as well.
 *
 * One image at a time, and only while the remote is still and frames flow:
 * the browser decodes in the order asked and cannot drop a decode once
 * asked, so a press never waits behind more than one. Holding an arrow
 * decodes nothing until it is let go.
 */
export function decodeAheadOf(track: HTMLElement, row: HTMLElement | null): void {
  if (!canGetReady()) return;
  const key = row ? row.getAttribute('data-row-key') : null;
  if (key !== currentKey) {
    grid = null;
    const before = rowElement(currentKey);
    movedUp = !!(
      row &&
      before &&
      row.compareDocumentPosition(before) & Node.DOCUMENT_POSITION_FOLLOWING
    );
    currentKey = key;
    slid();
  }
  if (!currentKey) return;
  watch(track);
  schedule();
}

/**
 * With `gridAhead` too, the same for a poster grid, which slides its own
 * track and has no rows of its own: `tiles` are those its next press brings
 * into view, nearest first, and `key` says where the grid is, for marks. A
 * new key is a move, as a new row is for a stack.
 */
export function decodeAheadOfTiles(track: HTMLElement, key: string, tiles: HTMLElement[]): void {
  if (!GRID_AHEAD || !canGetReady()) return;
  if (!grid || grid.track !== track || grid.key !== key) slid();
  grid = { track, key, tiles };
  watch(track);
  schedule();
}

/**
 * A grid that closes lets go of its tiles, and its art drawn under the rail
 * goes at once: no press will show those rows now, and the screen under it
 * may never slide again. That screen's own art stays, as its view has not
 * moved: Home's, for the Down after See all closes.
 */
export function leaveGrid(track: HTMLElement | null): void {
  if (!grid || grid.track !== track) return;
  grid = null;
  for (let n = warm.length - 1; n >= 0; n--) {
    if (warm[n]!.grid) unwarm(warm.splice(n, 1)[0]!.image);
  }
}
