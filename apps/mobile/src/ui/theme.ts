import { color, font as fontToken, phone, phoneType, touch } from '@brand/tokens/design';

/**
 * The phone's palette, from the redesign's shared tokens (brand/tokens/design.json, which the
 * TV apps read too). The older names stay so every screen keeps working; new screens use the
 * token names (`sheet`, `raised`, `textSoft` and so on).
 */
export const colors = {
  bg: color.bg,
  surface1: color.sheet,
  surface2: color.surface,
  surface3: color.raised,
  sheet: color.sheet,
  raised: color.raised,
  text: color.text,
  textSoft: color.textSoft,
  textMuted: color.textMuted,
  textSubtle: color.textFaint,
  accent: color.accent,
  action: color.brand,
  actionPressed: color.brandBright,
  prismTop: color.focus,
  /** The light "Play" fill and the text on it. */
  playFill: color.focusFill,
  onPlay: color.onFocus,
  playerBg: color.playerBg,
  playerDim: color.playerDim,
  controlPress: color.controlPress,
  barTrack: color.barTrack,
  barBuffer: color.barBuffer,
  danger: '#FF8A8A',
  scrim: 'rgba(11, 8, 21, 0.72)',
} as const;

export const font = fontToken.family;

export const type = {
  display: {
    fontFamily: font,
    fontWeight: '800',
    fontSize: phoneType.display,
    lineHeight: 36,
  },
  title: { fontFamily: font, fontWeight: '800', fontSize: phoneType.heroTitle, lineHeight: 32 },
  heading: { fontFamily: font, fontWeight: '700', fontSize: phoneType.heading, lineHeight: 24 },
  body: { fontFamily: font, fontWeight: '500', fontSize: phoneType.body, lineHeight: 22 },
  label: { fontFamily: font, fontWeight: '700', fontSize: phoneType.label, lineHeight: 18 },
  meta: { fontFamily: font, fontWeight: '500', fontSize: phoneType.meta, lineHeight: 18 },
  small: { fontFamily: font, fontWeight: '500', fontSize: phoneType.small, lineHeight: 16 },
  /** The small capitals over a group of settings or a sheet's column. */
  overline: {
    fontFamily: font,
    fontWeight: '700',
    fontSize: phoneType.small,
    lineHeight: 16,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
} as const;

export const space = { xs: 4, s: 8, m: 12, l: 16, xl: 24, xxl: 32 } as const;

/** The page's side margin. */
export const gutter = phone.gutter;

export const radius = { s: 6, m: 10, l: 16, xl: 20, pill: 999 } as const;

/** Every tap target is at least `touch.min` high and wide. */
export { touch };

/** Six violet pairs for tiles with no artwork (as the TV's Tile.tsx). */
export const FALLBACK_ART: ReadonlyArray<readonly [string, string]> = [
  ['#2A1F4D', '#4B23C8'],
  ['#1F2650', '#3D4FC8'],
  ['#3B1F4D', '#8A2BB8'],
  ['#1F3A4D', '#2B7FB8'],
  ['#2D1F40', '#6A3BF0'],
  ['#40203A', '#B8327F'],
];

/** The six profile colours, as gradients. */
export const PROFILE_ART: ReadonlyArray<readonly [string, string]> = [
  ['#7B4DFF', '#C9B5FF'],
  ['#2B7FB8', '#7FD3FF'],
  ['#B8327F', '#FF8AC4'],
  ['#2E9E6A', '#8AF0BE'],
  ['#C86A1E', '#FFC07A'],
  ['#4B23C8', '#A98BFF'],
];

export function fallbackArt(seed: string): readonly [string, string] {
  let hash = 0;
  for (let index = 0; index < seed.length; index++) hash = (hash * 31 + seed.charCodeAt(index)) | 0;
  return FALLBACK_ART[Math.abs(hash) % FALLBACK_ART.length]!;
}
