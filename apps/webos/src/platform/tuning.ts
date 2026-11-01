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
 * "heroArt":"large","heroPan":true,"mips":true}`. The comparison of 29 October
 * dropped the hero's fade (`"heroFade":true` before): the pauses of 1-1.5 s
 * moving along a row went to at most 50 ms. That of 30 October turned decoding
 * ahead on (`"decodeAhead":false` before): the first walk down Home had a p95
 * frame gap of 50-100 ms with it, against 83-167 ms without. On 1 November
 * every other screen took Home's lesson (`"screenMotion":"slide"` before):
 * their lists, grids, buttons and the rail move at once instead of sliding.
 */
export interface Tuning {
  /** Home's rows and each row's tiles slide, slide on a layer kept between presses, or jump. */
  motion: 'slide' | 'layer' | 'jump';
  /**
   * Every other screen's lists and grids (Search, Discover, Library,
   * Details, All streams, Settings, Add-ons, profiles), its buttons and
   * dialogs, and the rail's opening, slide over the motion time or jump.
   * Home's rows, Sports' rows and tiles keep their own switches, and the
   * player keeps its fades, so this changes nothing there.
   */
  screenMotion: 'slide' | 'jump';
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
  /**
   * Size of the wide tiles' art in Featured rows, drawn at 768 device px.
   * Medium is 1920x1080, the same image as the hero's; small is far fewer
   * pixels to decode (about 480 wide, not yet measured on the TV) and may
   * look soft.
   */
  wideArt: 'medium' | 'small';
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
  /**
   * Home's rows box is its own layer, so a Down moves it without drawing
   * again the rows already drawn: only the strip coming into view is drawn.
   */
  homeLayer: boolean;
  /**
   * Between presses, the posters and logos of the row the next Down brings
   * into view, and of the row above, are decoded, so the press only uploads
   * them. Art far bigger than it is drawn, like the wide tiles' medium art,
   * is left out: decoding ahead decodes at full size.
   */
  decodeAhead: boolean;
  /** A new hero backdrop fades in over the old one, or replaces it at once. */
  heroFade: boolean;
  /**
   * Performance marks for a TV trace: key presses, row slides, rows filling
   * in, hero changes and decoding ahead (performance.getEntriesByType('mark')).
   */
  marks: boolean;
  /**
   * Counts frame gaps while the remote is in use, per screen, for a TV
   * round: read `window.__bannertvFrames()` from the web inspector, and
   * `window.__bannertvFrames(true)` reads and starts again.
   */
  meter: boolean;
}

export const TUNING_KEY = 'bannertv.tuning';

export const TUNING_DEFAULTS: Readonly<Tuning> = {
  motion: 'jump',
  screenMotion: 'jump',
  zoom: 'instant',
  heroDelayMs: 250,
  heroBusyMs: 800,
  heroArt: 'medium',
  wideArt: 'medium',
  heroPan: false,
  rowsAround: 2,
  overscan: 2,
  decoding: 'auto',
  mips: false,
  homeLayer: false,
  decodeAhead: true,
  heroFade: false,
  marks: false,
  meter: false,
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
    screenMotion: oneOf(stored.screenMotion, ['slide', 'jump'], d.screenMotion),
    zoom: oneOf(stored.zoom, ['animate', 'instant', 'off'], d.zoom),
    heroDelayMs: count(stored.heroDelayMs, 0, 5000, d.heroDelayMs),
    heroBusyMs: count(stored.heroBusyMs, 0, 5000, d.heroBusyMs),
    heroArt: oneOf(stored.heroArt, ['large', 'medium'], d.heroArt),
    wideArt: oneOf(stored.wideArt, ['medium', 'small'], d.wideArt),
    heroPan: flag(stored.heroPan, d.heroPan),
    rowsAround: count(stored.rowsAround, 1, 10, d.rowsAround),
    overscan: count(stored.overscan, 1, 10, d.overscan),
    decoding: oneOf(stored.decoding, ['auto', 'async'], d.decoding),
    mips: flag(stored.mips, d.mips),
    homeLayer: flag(stored.homeLayer, d.homeLayer),
    decodeAhead: flag(stored.decodeAhead, d.decodeAhead),
    heroFade: flag(stored.heroFade, d.heroFade),
    marks: flag(stored.marks, d.marks),
    meter: flag(stored.meter, d.meter),
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
 * stylesheets draw rows and lists sliding, tiles zooming over the motion time, the hero
 * panning and fading, tile art with mipmaps, and Home's rows box without a
 * layer of its own; each class changes one of those.
 */
export function applyTuning(root: HTMLElement, value: Tuning = tuning): void {
  if (value.motion !== 'slide') root.classList.add(`tune-motion-${value.motion}`);
  if (value.zoom !== 'animate') root.classList.add(`tune-zoom-${value.zoom}`);
  if (!value.heroPan) root.classList.add('tune-no-pan');
  if (!value.mips) root.classList.add('tune-no-mips');
  if (value.homeLayer) root.classList.add('tune-home-layer');
  if (!value.heroFade) root.classList.add('tune-no-hero-fade');
  if (value.screenMotion === 'jump') root.classList.add('tune-screens-jump');
}
