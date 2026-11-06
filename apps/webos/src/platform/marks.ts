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

const made = new Set<string>();

/**
 * A step of the launch, marked once per page load as `mark` does: the first
 * call for a name wins. `startTime` (a performance.now() reading) puts the
 * mark at an earlier moment, such as the bundle starting to run before the
 * switches were read. webOS 5's engine ignores it and marks the call.
 */
export function bootMark(name: string, startTime?: number): void {
  if (!tuning.marks || made.has(name) || typeof performance.mark !== 'function') return;
  made.add(name);
  if (startTime === undefined) performance.mark(name);
  else performance.mark(name, { startTime });
}
