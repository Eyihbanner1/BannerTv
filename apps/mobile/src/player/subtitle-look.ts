import type { SubtitleStyle } from '@tv/data/preferences';

/**
 * The profile's subtitle style as the phone draws it, for addon files and the file's own
 * subtitles alike. The TV draws on a picture 1080 lines high (SubtitleLayer.module.css); the
 * phone draws the same sizes, colours and gaps scaled to its screen's shorter side, which is the
 * picture's height while the player holds the phone sideways.
 */

const TV_LINES = 1080;
const SIZES: Record<SubtitleStyle['size'], number> = { small: 40, medium: 52, large: 64, huge: 80 };
const COLOURS: Record<SubtitleStyle['colour'], string> = {
  white: '#ffffff',
  yellow: '#ffe45c',
  cyan: '#6ae4ff',
  green: '#8cf59a',
};
const BACKS: Partial<Record<SubtitleStyle['background'], string>> = {
  box: 'rgba(0,0,0,0.6)',
  solid: '#000000',
};
/** The TV's gaps from the edge of the picture, in its lines. */
const TV_BOTTOM = 72;
const TV_RAISED = 200;
const TV_TOP = 64;
/** The TV's gap above each cue, in its lines. */
const TV_CUE_GAP = 8;
/** While the controls show: bottom lines sit above the seek bar, top lines below the title. */
const ABOVE_CONTROLS = 0.26;
const BELOW_CONTROLS = 0.2;

type Percent = `${number}%`;

export interface SubtitleLook {
  /** Every line's text. */
  text: {
    fontSize: number;
    lineHeight: number;
    color: string;
    textShadowColor: string;
    textShadowOffset: { width: number; height: number };
    textShadowRadius: number;
  };
  /** Behind each line (box, solid), or null. Each line has a space at both ends inside it. */
  back: string | null;
  /** The gap above each cue. */
  cueGap: number;
  /** Where the lines go that the style places (bottom, raised or top). */
  main: { bottom: Percent } | { top: Percent };
  /** Where the lines go that the file itself places at the top of the picture. */
  upper: { top: Percent };
  /** Whether the style places every line at the top, the file's top lines among them. */
  allAtTop: boolean;
}

function percent(share: number): Percent {
  return `${Math.round(share * 1000) / 10}%`;
}

/**
 * `style` drawn on a screen `screen` big, with the player's controls showing or not.
 */
export function subtitleLook(
  style: SubtitleStyle,
  screen: { width: number; height: number },
  controls: boolean,
): SubtitleLook {
  const short = Math.min(screen.width, screen.height);
  const scale = short > 0 ? short / TV_LINES : 1;
  const fontSize = Math.round((SIZES[style.size] ?? SIZES.medium) * scale * 10) / 10;
  const back = BACKS[style.background] ?? null;
  const edge =
    back !== null
      ? { colour: 'transparent', offset: 0, radius: 0 }
      : style.background === 'shadow'
        ? {
            colour: 'rgba(0,0,0,0.9)',
            offset: Math.max(1.5, 3 * scale),
            radius: Math.max(3, 6 * scale),
          }
        : // outline: React Native draws one shadow, so the TV's black edge is a tight dark glow.
          { colour: 'rgba(0,0,0,0.95)', offset: 0, radius: Math.max(4, 8 * scale) };
  const upper = { top: percent(controls ? BELOW_CONTROLS : TV_TOP / TV_LINES) };
  const main =
    style.position === 'top'
      ? upper
      : {
          bottom: percent(
            controls
              ? Math.max(ABOVE_CONTROLS, TV_RAISED / TV_LINES)
              : (style.position === 'raised' ? TV_RAISED : TV_BOTTOM) / TV_LINES,
          ),
        };
  return {
    text: {
      fontSize,
      lineHeight: Math.round(fontSize * 1.25 * 10) / 10,
      color: COLOURS[style.colour] ?? COLOURS.white,
      textShadowColor: edge.colour,
      textShadowOffset: { width: edge.offset, height: edge.offset },
      textShadowRadius: edge.radius,
    },
    back,
    cueGap: Math.round(TV_CUE_GAP * scale * 10) / 10,
    main,
    upper,
    allAtTop: style.position === 'top',
  };
}
