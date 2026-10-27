/**
 * LG remote key codes. Arrows and OK match a PC keyboard, so the app also runs
 * in a desktop browser. Escape stands in for Back there.
 *
 * Source: https://webostv.developer.lge.com/develop/guides/magic-remote
 */
export const KeyCode = {
  Left: 37,
  Up: 38,
  Right: 39,
  Down: 40,
  Ok: 13,
  Back: 461,
  Red: 403,
  Green: 404,
  Yellow: 405,
  Blue: 406,
  Play: 415,
  Pause: 19,
  Stop: 413,
  FastForward: 417,
  Rewind: 412,
} as const;

/** Arrow and OK keys for spatial navigation. */
export const SPATIAL_KEY_MAP = {
  left: [KeyCode.Left],
  up: [KeyCode.Up],
  right: [KeyCode.Right],
  down: [KeyCode.Down],
  enter: [KeyCode.Ok],
};

export function isBackKey(event: Pick<KeyboardEvent, 'keyCode' | 'key'>): boolean {
  return (
    event.keyCode === KeyCode.Back ||
    event.key === 'GoBack' ||
    event.key === 'BrowserBack' ||
    event.key === 'Escape'
  );
}
