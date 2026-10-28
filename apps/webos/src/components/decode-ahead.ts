import { mark } from '../platform/marks';
import { tuning } from '../platform/tuning';

/**
 * Art bigger than this many times its drawn size is left alone. Decoding
 * ahead decodes at full size; a tile drawn at about full size (posters,
 * logos) then draws from that same copy, but wide art, drawn at 0.4 of its
 * 1920 px, would cost a full-size copy where drawing it keeps a half-size one.
 */
const MAX_OVERSIZE = 1.5;

const asked = new WeakSet<HTMLImageElement>();
const watched = new WeakSet<HTMLElement>();
/**
 * The key of the row a stack last moved to. A key, not the element, so a
 * screen that has closed is not kept in memory.
 */
let currentKey: string | null = null;
let frame = 0;

function noop(): void {}

function isRow(element: Element | null | undefined): element is HTMLElement {
  return element instanceof HTMLElement && element.hasAttribute('data-row-key');
}

/**
 * The row after next, which the next Down brings into view (the next row
 * already shows its top), and the row above, for Up. Looked up each time:
 * a row far from focus is an empty box until it is drawn, and drawing it
 * puts a new element in its place.
 */
function targets(): HTMLElement[] {
  const current = currentKey ? document.querySelector(`[data-row-key="${currentKey}"]`) : null;
  if (!current) return [];
  const next = current.nextElementSibling;
  return [next && next.nextElementSibling, current.previousElementSibling].filter(isRow);
}

/** Loaded, drawn across the screen (not a tile drawn past the row's edge), and about its drawn size. */
function worthDecoding(image: HTMLImageElement): boolean {
  if (asked.has(image) || !image.complete || image.naturalWidth === 0) return false;
  const box = image.getBoundingClientRect();
  if (box.width === 0 || box.right <= 0 || box.left >= window.innerWidth) return false;
  return image.naturalWidth <= box.width * (window.devicePixelRatio || 1) * MAX_OVERSIZE;
}

function decode(images: HTMLImageElement[], row: HTMLElement): void {
  if (images.length === 0) return;
  const key = row.getAttribute('data-row-key');
  mark(`ahead:${key}:${images.length}`);
  const done = images.map((image) => {
    asked.add(image);
    return image.decode().then(noop, noop);
  });
  if (tuning.marks) void Promise.all(done).then(() => mark(`ahead-done:${key}`));
}

function decodeRow(row: HTMLElement): void {
  const found = row.getElementsByTagName('img');
  const images: HTMLImageElement[] = [];
  for (let i = 0; i < found.length; i++) if (worthDecoding(found[i]!)) images.push(found[i]!);
  decode(images, row);
}

/** Artwork that loads in a target row after its batch went: decoded on its own. */
function onLoad(event: Event): void {
  const image = event.target;
  if (frame !== 0 || !(image instanceof HTMLImageElement)) return;
  for (const row of targets()) {
    if (row.contains(image)) {
      if (worthDecoding(image)) decode([image], row);
      return;
    }
  }
}

/**
 * With the `decodeAhead` switch, decodes the artwork of the rows either side
 * of the one a vertical stack of rows has just moved to (see targets), as it
 * loads. Rows clipped out of view are never drawn, so their art would
 * otherwise decode in the frame that first shows it. The decoded copy is
 * kept for drawing, so that frame only has to upload it.
 *
 * The batch waits two frames. The TV's Chromium starts no frame until the
 * last one is ready to draw, so it goes once the press has been drawn, not
 * alongside it, and a press in between takes its place.
 */
export function decodeAheadOf(track: HTMLElement, row: HTMLElement | null): void {
  if (!tuning.decodeAhead || typeof HTMLImageElement.prototype.decode !== 'function') return;
  cancelAnimationFrame(frame);
  frame = 0;
  currentKey = row ? row.getAttribute('data-row-key') : null;
  if (!currentKey) return;
  if (!watched.has(track)) {
    watched.add(track);
    // Load events do not bubble, but they can be caught on the way down.
    track.addEventListener('load', onLoad, true);
  }
  frame = requestAnimationFrame(() => {
    frame = requestAnimationFrame(() => {
      frame = 0;
      targets().forEach(decodeRow);
    });
  });
}
