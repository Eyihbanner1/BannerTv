import { sinceActivity } from '../navigation/activity';
import { mark } from '../platform/marks';
import { tuning } from '../platform/tuning';

/**
 * Art bigger than this many times its drawn size is left alone. Decoding
 * ahead decodes at full size; a tile drawn at about full size (posters,
 * logos) then draws from that same copy, but wide art, drawn at 0.4 of its
 * 1920 px, would cost a full-size copy where drawing it keeps a half-size one.
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
let decoding = false;
let frame = 0;
let lastFrameAt = 0;
let flowingFrames = 0;

/** The box under the rail that raster mode draws art in, while the rail is drawn. */
let warmBox: HTMLElement | null = null;
/** The art drawn there, oldest first, with the number of slides there had been when it was drawn. */
const warm: { image: HTMLImageElement; slide: number }[] = [];
/** Row changes so far: art drawn ahead goes once the view has moved on past the row it was for. */
let slides = 0;
/** Art was just drawn under the rail, for this row, and the frames after it have yet to flow. */
let warming = false;
let warmingKey: string | null = null;

/** Art is got ready by drawing it under the rail, which App then draws a box for. */
export const RASTER_AHEAD = tuning.decodeAhead && tuning.aheadMode === 'raster';

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
 * art about its drawn size; drawing it under the rail takes any, as the
 * browser draws that from the copy its size needs.
 */
function drawnBox(image: HTMLImageElement, now: number): DOMRect | null {
  if (!image.complete || image.naturalWidth === 0 || wasAsked(image.src, now)) return null;
  const box = image.getBoundingClientRect();
  if (box.width === 0 || box.right <= 0 || box.left >= window.innerWidth) return null;
  if (RASTER_AHEAD) return box;
  return image.naturalWidth <= box.width * (window.devicePixelRatio || 1) * MAX_OVERSIZE
    ? box
    : null;
}

interface Next {
  image: HTMLImageElement;
  box: DOMRect;
  key: string | null;
}

/** The first art across the screen, left to right, of the first target row that has some. */
function nextImage(now: number): Next | null {
  for (const row of targets()) {
    const found = row.getElementsByTagName('img');
    for (let i = 0; i < found.length; i++) {
      const box = drawnBox(found[i]!, now);
      if (box) return { image: found[i]!, box, key: row.getAttribute('data-row-key') };
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
 */
function drawWarm(box: HTMLElement, { image, box: drawn, key }: Next): void {
  const copy = document.createElement('img');
  copy.className = image.className;
  const decodingAttribute = image.getAttribute('decoding');
  if (decodingAttribute) copy.setAttribute('decoding', decodingAttribute);
  copy.alt = '';
  copy.draggable = false;
  copy.style.cssText = `position:absolute;left:0;top:0;right:auto;bottom:auto;width:${drawn.width}px;height:${drawn.height}px;max-width:none;max-height:none`;
  copy.src = image.src;
  box.appendChild(copy);
  warm.push({ image: copy, slide: slides });
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
  if (!tuning.decodeAhead) return;
  if (!RASTER_AHEAD && typeof HTMLImageElement.prototype.decode !== 'function') return;
  const key = row ? row.getAttribute('data-row-key') : null;
  if (key !== currentKey) {
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
  if (!watched.has(track)) {
    watched.add(track);
    // Load events do not bubble, but they can be caught on the way down.
    track.addEventListener('load', onLoad, true);
  }
  schedule();
}
