/**
 * Performance switches a tester can flip on the TV without a new build, so
 * several options can be compared in one session. From the web inspector:
 *
 *   localStorage.setItem('bannertv.tuning', JSON.stringify({ motion: 'jump' }));
 *   location.reload();
 *
 * Anything missing or unreadable takes its default, which is what ships, and
 * `localStorage.removeItem('bannertv.tuning')` goes back to all defaults. The
 * defaults are the lightest set from the TV comparison of 28 October 2026:
 * moving along a row went from a p95 frame gap of 200-300 ms to about 17 ms.
 * Before that they were `{"motion":"slide","zoom":"animate","heroBusyMs":250,
 * "heroArt":"large","heroPan":true,"mips":true}`.
 */
export interface Tuning {
  /** Home's rows and each row's tiles slide, slide on a layer kept between presses, or jump. */
  motion: 'slide' | 'layer' | 'jump';
  /** The focused tile grows over the motion time, at once, or not at all. */
  zoom: 'animate' | 'instant' | 'off';
  /** How long focus rests on a title before the hero shows it. */
  heroDelayMs: number;
  /** The same, while presses come quickly; never shorter than `heroDelayMs`. */
  heroBusyMs: number;
  /**
   * Size of the hero's backdrop, which Details shares. Metahub's medium
   * backdrops measured 1920x1080 on the TV, the same as large ones did.
   */
  heroArt: 'large' | 'medium';
  /** The hero backdrop's slow pan. */
  heroPan: boolean;
  /** Rows either side of the focused one that are drawn and fetched, at least 1. */
  rowsAround: number;
  /** Tiles drawn past each edge of a row, at least 1 so the next press has a target. */
  overscan: number;
  /** Artwork decodes as part of its first draw, or is drawn blank and filled in once decoded. */
  decoding: 'auto' | 'async';
  /** Smaller copies of tile artwork for smoother downscaling; off saves graphics memory. */
  mips: boolean;
}

export const TUNING_KEY = 'bannertv.tuning';

export const TUNING_DEFAULTS: Readonly<Tuning> = {
  motion: 'jump',
  zoom: 'instant',
  heroDelayMs: 250,
  heroBusyMs: 800,
  heroArt: 'medium',
  heroPan: false,
  rowsAround: 2,
  overscan: 2,
  decoding: 'auto',
  mips: false,
};

function oneOf<T extends string>(value: unknown, options: readonly T[], fallback: T): T {
  return options.indexOf(value as T) >= 0 ? (value as T) : fallback;
}

function count(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && value >= min && value <= max ? Math.round(value) : fallback;
}

function flag(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/** Reads the stored switches, keeping the default for any that are missing or wrong. */
export function parseTuning(raw: string | null): Tuning {
  let stored: Record<string, unknown> = {};
  try {
    const value: unknown = raw ? JSON.parse(raw) : null;
    if (value && typeof value === 'object') stored = value as Record<string, unknown>;
  } catch {
    // Unreadable: defaults.
  }
  const d = TUNING_DEFAULTS;
  return {
    motion: oneOf(stored.motion, ['slide', 'layer', 'jump'], d.motion),
    zoom: oneOf(stored.zoom, ['animate', 'instant', 'off'], d.zoom),
    heroDelayMs: count(stored.heroDelayMs, 0, 5000, d.heroDelayMs),
    heroBusyMs: count(stored.heroBusyMs, 0, 5000, d.heroBusyMs),
    heroArt: oneOf(stored.heroArt, ['large', 'medium'], d.heroArt),
    heroPan: flag(stored.heroPan, d.heroPan),
    rowsAround: count(stored.rowsAround, 1, 10, d.rowsAround),
    overscan: count(stored.overscan, 1, 10, d.overscan),
    decoding: oneOf(stored.decoding, ['auto', 'async'], d.decoding),
    mips: flag(stored.mips, d.mips),
  };
}

function read(): Tuning {
  try {
    return parseTuning(localStorage.getItem(TUNING_KEY));
  } catch {
    return { ...TUNING_DEFAULTS };
  }
}

/** Read once at startup: a change takes effect on the next reload. */
export const tuning: Readonly<Tuning> = read();

/** The switches that differ from the defaults, for logs and Diagnostics. */
export function changedTuning(value: Tuning = tuning): Partial<Tuning> {
  const changed: Partial<Record<keyof Tuning, unknown>> = {};
  for (const key of Object.keys(TUNING_DEFAULTS) as (keyof Tuning)[]) {
    if (value[key] !== TUNING_DEFAULTS[key]) changed[key] = value[key];
  }
  return changed as Partial<Tuning>;
}

/**
 * The switches that work through CSS become classes on the root element. The
 * stylesheets draw rows sliding, tiles zooming over the motion time, the hero
 * panning and tile art with mipmaps; each class turns one of those off, and
 * the defaults turn them all off.
 */
export function applyTuning(root: HTMLElement, value: Tuning = tuning): void {
  if (value.motion !== 'slide') root.classList.add(`tune-motion-${value.motion}`);
  if (value.zoom !== 'animate') root.classList.add(`tune-zoom-${value.zoom}`);
  if (!value.heroPan) root.classList.add('tune-no-pan');
  if (!value.mips) root.classList.add('tune-no-mips');
}
