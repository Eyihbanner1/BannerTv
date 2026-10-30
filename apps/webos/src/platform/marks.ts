import { tuning } from './tuning';

/**
 * A performance mark for a TV trace, when the `marks` tuning switch is on,
 * so a long frame can be put down to what started it: a key press, a row
 * slide, a row filling in, a hero change or decoding ahead. Read them from
 * the web inspector with `performance.getEntriesByType('mark')`. Names carry
 * focus keys and artwork kinds only, never an address.
 */
export function mark(name: string): void {
  if (tuning.marks && typeof performance.mark === 'function') performance.mark(name);
}
