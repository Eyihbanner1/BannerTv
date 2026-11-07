// Built from brand/tokens/design.json by tools/scripts/build-tokens.mjs. Do not edit.

export const color = {
  bg: '#0B0815',
  rail: '#110C1F',
  surface: '#1B1430',
  raised: '#2A2050',
  sheet: '#140F26',
  track: '#3A3160',
  text: '#F1EDFF',
  textSoft: '#D9D2F2',
  textMuted: '#B8AEDB',
  textFaint: '#8E82B8',
  accent: '#A98BFF',
  focus: '#C9B5FF',
  focusGlow: 'rgba(201, 181, 255, 0.55)',
  focusFill: '#F1EDFF',
  onFocus: '#0B0815',
  brand: '#6A3BF0',
  brandDeep: '#4B23C8',
  brandBright: '#7B4DFF',
  playerBg: '#05030A',
  playerScrim: 'rgba(5, 3, 10, 0.62)',
  controlIdle: 'rgba(241, 237, 255, 0.10)',
  barTrack: 'rgba(241, 237, 255, 0.22)',
  barBuffer: 'rgba(241, 237, 255, 0.32)',
  kidsBg: '#1F3A2E',
  kidsText: '#BFEBD6',
  playerDim: 'rgba(5, 3, 10, 0.45)',
  controlPress: 'rgba(241, 237, 255, 0.14)',
} as const;

export const font = {
  family: 'Urbanist',
  weightMedium: 500,
  weightSemibold: 600,
  weightBold: 700,
  weightHeavy: 800,
} as const;

export const tvType = {
  heroTitle: 84,
  detailsTitle: 80,
  heading: 40,
  rowTitle: 32,
  body: 28,
  label: 26,
  meta: 24,
  small: 22,
} as const;

export const space = {
  xs: 8,
  sm: 12,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
  tvSafe: 96,
} as const;

export const radius = {
  sm: 8,
  md: 14,
  lg: 16,
  sheet: 32,
  pill: 999,
} as const;

export const focused = {
  ringWidth: 5,
  glowWidth: 4,
  tileScale: 1.08,
} as const;

export const motion = {
  fast: 120,
  base: 200,
  slide: 240,
  heroFade: 320,
  heroDelay: 250,
  controlsHide: 4000,
} as const;

export const ease = {
  standard: [0.2, 0, 0, 1] as [number, number, number, number],
  decelerate: [0, 0, 0.2, 1] as [number, number, number, number],
  accelerate: [0.4, 0, 1, 1] as [number, number, number, number],
} as const;

export const tv = {
  navHeight: 120,
  heroLeft: 96,
  heroTop: 210,
  heroWidth: 820,
  tileWideW: 360,
  tileWideH: 202,
  tileWideFocusedW: 400,
  tileWideFocusedH: 225,
  tilePosterW: 200,
  tilePosterH: 300,
  rowGap: 24,
  settingsRail: 600,
  settingsRowH: 96,
  toggleW: 84,
  toggleH: 46,
  detailsResumeW: 520,
  avatar: 220,
  sheetH: 560,
} as const;

export const player = {
  button: 76,
  bar: 6,
  scrim: 300,
  seekStep: 10,
} as const;

export const phoneType = {
  display: 30,
  heroTitle: 26,
  wordmark: 22,
  heading: 18,
  body: 15,
  label: 14,
  meta: 13,
  small: 12,
} as const;

export const touch = {
  min: 48,
  chip: 40,
  row: 52,
  play: 52,
  skip: 52,
  playBig: 72,
} as const;

export const phone = {
  gutter: 20,
  heroH: 300,
  heroRadius: 20,
  backdropH: 260,
  tilePosterW: 104,
  tilePosterH: 156,
  tileWideW: 200,
  tileWideH: 112,
  resultPosterW: 72,
  resultPosterH: 108,
  progress: 4,
  sideSheetW: 424,
  sideSheetRadius: 24,
} as const;
