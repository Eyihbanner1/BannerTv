import {
  color,
  ease,
  focused,
  font,
  motion,
  player,
  radius,
  space,
  tv,
  tvType,
} from '@brand/tokens/design';
import { Dimensions, Easing, type TextStyle } from 'react-native';
import { scaled, scaleFor } from './scale';

export { color, focused, motion };

// A TV doesn't turn, so the scale is read once.
const SCALE = scaleFor(Dimensions.get('window').width);

/** A size from the 1920x1080 design, in this TV's layout pixels. */
export function px(value: number): number {
  return scaled(value, SCALE);
}

const sized = <T extends Record<string, number>>(values: T): { [K in keyof T]: number } =>
  Object.fromEntries(Object.entries(values).map(([key, value]) => [key, px(value)])) as {
    [K in keyof T]: number;
  };

export const spacing = sized(space);
export const radii = { ...sized(radius), pill: 999 };
export const layout = sized(tv);
export const controls = { ...sized(player), seekStep: player.seekStep };
export const ring = { width: px(focused.ringWidth), glow: px(focused.glowWidth) };

/** The design's easing curves, ready for Animated.timing. */
export const easing = {
  standard: Easing.bezier(...ease.standard),
  decelerate: Easing.bezier(...ease.decelerate),
  accelerate: Easing.bezier(...ease.accelerate),
};

const FAMILY = font.family;
const text = (size: number, weight: number, lineHeight = 1.25): TextStyle => ({
  fontFamily: FAMILY,
  fontWeight: String(weight) as TextStyle['fontWeight'],
  fontSize: px(size),
  lineHeight: Math.round(px(size) * lineHeight),
});

export const type = {
  heroTitle: text(tvType.heroTitle, font.weightHeavy, 1.05),
  detailsTitle: text(tvType.detailsTitle, font.weightHeavy, 1.05),
  heading: text(tvType.heading, font.weightBold),
  rowTitle: text(tvType.rowTitle, font.weightBold),
  body: text(tvType.body, font.weightMedium, 1.4),
  label: text(tvType.label, font.weightSemibold),
  meta: text(tvType.meta, font.weightSemibold),
  small: text(tvType.small, font.weightMedium),
} as const;
