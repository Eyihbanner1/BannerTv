import type { Focus, HomeRow, Title } from './model';

/** One way of drawing Home. Both modes take the same calls, so only the drawing differs. */
export interface HomeView {
  /** Draws the rows with the given focus, without animating. Resolves once the first frame is up. */
  mount(rows: readonly HomeRow[], focus: Focus): Promise<void>;
  /** Moves to a new focus with the trial's motion: rows slide, the tile grows. */
  focus(next: Focus): void;
  /** Cross-fades the hero to a title. */
  hero(title: Title | undefined): void;
  /** Graphics and memory figures this mode can report, for the results. */
  report(): Record<string, number | string | null>;
  destroy(): void;
}

export type Mode = 'lightning' | 'lightning-1080' | 'html';

export const MODES: readonly Mode[] = ['lightning', 'lightning-1080', 'html'];

export const MODE_LABELS: Record<Mode, string> = {
  lightning: 'Lightning, sharp (full TV resolution)',
  'lightning-1080': 'Lightning, lighter (1080p, upscaled)',
  html: 'HTML, same motion (like today, motion on)',
};

export const COLORS = {
  bg: '#0B0815',
  surface1: '#120E20',
  surface2: '#1B1430',
  surface3: '#261C42',
  text: '#F1EDFF',
  textMuted: '#B9B0D6',
  focus: '#C9B5FF',
  accent: '#A98BFF',
} as const;

/** '#RRGGBB' and an alpha of 0 to 1 as Lightning's 0xRRGGBBAA. */
export function rgba(hex: string, alpha = 1): number {
  const rgb = parseInt(hex.slice(1), 16);
  return ((rgb << 8) | Math.round(alpha * 255)) >>> 0;
}
