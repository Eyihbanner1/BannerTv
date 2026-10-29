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

/** Loaded, drawn across the screen (not a tile drawn past the row's edge), and about its drawn size. */
function worthDecoding(image: HTMLImageElement, now: number): boolean {
  if (!image.complete || image.naturalWidth === 0 || wasAsked(image.src, now)) return false;
  const box = image.getBoundingClientRect();
  if (box.width === 0 || box.right <= 0 || box.left >= window.innerWidth) return false;
  return image.naturalWidth <= box.width * (window.devicePixelRatio || 1) * MAX_OVERSIZE;
}

/** The first art across the screen, left to right, of the first target row that has some. */
function nextImage(now: number): { image: HTMLImageElement; row: HTMLElement } | null {
  for (const row of targets()) {
    const found = row.getElementsByTagName('img');
    for (let i = 0; i < found.length; i++) {
      if (worthDecoding(found[i]!, now)) return { image: found[i]!, row };
    }
  }
  return null;
}

function decode(image: HTMLImageElement, row: HTMLElement, now: number): void {
  const key = row.getAttribute('data-row-key');
  decoding = true;
  noteAsked(image.src, now);
  mark(`ahead:${key}`);
  const settled = () => {
    decoding = false;
    mark(`ahead-done:${key}`);
    schedule();
  };
  image.decode().then(settled, settled);
}

/**
 * Each frame while there is art to decode: starts one decode once the
 * remote is quiet and frames flow, and stops asking for frames when there
 * is nothing left. While a decode runs it asks for none: the decode's end
 * asks again, and the frames after it have to flow before the next.
 */
function tick(time: number): void {
  frame = 0;
  flowingFrames = lastFrameAt > 0 && time - lastFrameAt < FLOWING_MS ? flowingFrames + 1 : 0;
  lastFrameAt = time;
  if (decoding) return;
  if (flowingFrames < 2 || sinceActivity() < QUIET_MS) return schedule();
  const now = Date.now();
  const next = nextImage(now);
  if (next) decode(next.image, next.row, now);
  else lastFrameAt = 0;
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
 * With the `decodeAhead` switch, decodes the posters and logos across the
 * screen of the row the next press will show, once it has loaded: the row
 * after next, and after an Up the row above too. Rows clipped out of view
 * are never drawn, so their art would otherwise decode in the frame that
 * first shows it. The decoded copy is kept for drawing, so that frame only
 * has to upload it.
 *
 * One image at a time, and only while the remote is still and frames flow:
 * the browser decodes in the order asked and cannot drop a decode once
 * asked, so a press never waits behind more than one. Holding an arrow
 * decodes nothing until it is let go.
 */
export function decodeAheadOf(track: HTMLElement, row: HTMLElement | null): void {
  if (!tuning.decodeAhead || typeof HTMLImageElement.prototype.decode !== 'function') return;
  const key = row ? row.getAttribute('data-row-key') : null;
  if (key !== currentKey) {
    const before = rowElement(currentKey);
    movedUp = !!(
      row &&
      before &&
      row.compareDocumentPosition(before) & Node.DOCUMENT_POSITION_FOLLOWING
    );
    currentKey = key;
  }
  if (!currentKey) return;
  if (!watched.has(track)) {
    watched.add(track);
    // Load events do not bubble, but they can be caught on the way down.
    track.addEventListener('load', onLoad, true);
  }
  schedule();
}
