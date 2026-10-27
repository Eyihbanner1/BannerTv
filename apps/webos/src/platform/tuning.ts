/**
 * Performance switches a tester can flip on the TV without a new build, so
 * several options can be compared in one session. From the web inspector:
 *
 *   localStorage.setItem('bannertv.tuning', JSON.stringify({ motion: 'jump' }));
 *   location.reload();
 *
 * Anything missing or unreadable takes its default, which is what ships, and
 * `localStorage.removeItem('bannertv.tuning')` goes back to all defaults.
 */
export interface Tuning {
  /** Home's rows and each row's tiles slide, slide on a layer kept between presses, or jump. */
  motion: 'slide' | 'layer' | 'jump';
  /** The focused tile grows over the motion time, at once, or not at all. */
  zoom: 'animate' | 'instant' | 'off';
  /** How long focus rests on a title before the hero shows it. */
  heroDelayMs: number;
  /** The hero backdrop's slow pan. */
  heroPan: boolean;
  /** Rows either side of the focused one that are drawn and fetched. */
  rowsAround: number;
  /** Tiles drawn past each edge of a row. */
  overscan: number;
}

export const TUNING_KEY = 'bannertv.tuning';

export const TUNING_DEFAULTS: Readonly<Tuning> = {
  motion: 'slide',
  zoom: 'animate',
  heroDelayMs: 250,
  heroPan: true,
  rowsAround: 2,
  overscan: 2,
};

function oneOf<T extends string>(value: unknown, options: readonly T[], fallback: T): T {
  return options.indexOf(value as T) >= 0 ? (value as T) : fallback;
}

function count(value: unknown, max: number, fallback: number): number {
  return typeof value === 'number' && value >= 0 && value <= max ? Math.round(value) : fallback;
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
    heroDelayMs: count(stored.heroDelayMs, 5000, d.heroDelayMs),
    heroPan: typeof stored.heroPan === 'boolean' ? stored.heroPan : d.heroPan,
    rowsAround: count(stored.rowsAround, 10, d.rowsAround),
    overscan: count(stored.overscan, 10, d.overscan),
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

/** The switches that work through CSS become classes on the root element. */
export function applyTuning(root: HTMLElement, value: Tuning = tuning): void {
  if (value.motion !== 'slide') root.classList.add(`tune-motion-${value.motion}`);
  if (value.zoom !== 'animate') root.classList.add(`tune-zoom-${value.zoom}`);
  if (!value.heroPan) root.classList.add('tune-no-pan');
}
