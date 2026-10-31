/** The brand's dark palette (brand/tokens/tokens.json), sized for a phone held upright. */
export const colors = {
  bg: '#0B0815',
  surface1: '#120E20',
  surface2: '#1B1430',
  surface3: '#261C42',
  text: '#F1EDFF',
  textMuted: '#B9B0D6',
  textSubtle: '#9A90BD',
  accent: '#A98BFF',
  action: '#6A3BF0',
  actionPressed: '#7B4DFF',
  prismTop: '#C9B5FF',
  danger: '#FF8A8A',
  scrim: 'rgba(11, 8, 21, 0.72)',
} as const;

export const font = 'Urbanist';

export const type = {
  display: { fontFamily: font, fontWeight: '800', fontSize: 28, lineHeight: 34 },
  title: { fontFamily: font, fontWeight: '700', fontSize: 22, lineHeight: 28 },
  heading: { fontFamily: font, fontWeight: '700', fontSize: 18, lineHeight: 24 },
  body: { fontFamily: font, fontWeight: '500', fontSize: 15, lineHeight: 21 },
  label: { fontFamily: font, fontWeight: '600', fontSize: 14, lineHeight: 18 },
  small: { fontFamily: font, fontWeight: '500', fontSize: 12, lineHeight: 16 },
} as const;

export const space = { xs: 4, s: 8, m: 12, l: 16, xl: 24, xxl: 32 } as const;

export const radius = { s: 6, m: 10, l: 16, pill: 999 } as const;

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
