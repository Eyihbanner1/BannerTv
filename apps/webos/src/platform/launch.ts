import { bootMark } from './marks';

let homeFocusedAt: number | undefined;

/**
 * Home has placed its first focus since the page loaded: the launch is
 * usable. Later showings of Home change nothing.
 */
export function noteHomeFocused(): void {
  if (homeFocusedAt !== undefined) return;
  homeFocusedAt = Date.now();
  bootMark('boot:first-focus');
}
