import { motion } from '@brand/tokens/design';
import { formatTime } from '@tv/player/media';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Animated, StyleSheet, Text, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, type } from '../ui/theme';
import type { TapSide } from './tap-skip';

/**
 * How much of the picture's height the half-moon covers: the middle half, clear of the title
 * row and the seek bar.
 */
const RIPPLE_HEIGHT = 0.5;
/**
 * How far it reaches in from the edge, against half its height: a little more than a half
 * circle, so the total has room.
 */
const RIPPLE_DEPTH = 1.5;
/** Never more than this share of the width, as on a phone held upright. */
const RIPPLE_MAX_WIDTH = 0.35;

/**
 * A skip's total, such as "+30 s" or "−1:30", as the TV's note writes it. A total that has come
 * back to nothing reads "0 s", with no sign to suggest a way.
 */
function formatSkip(seconds: number): string {
  const amount = Math.abs(Math.round(seconds));
  if (amount === 0) return '0 s';
  const sign = seconds < 0 ? '−' : '+';
  return amount < 60 ? `${sign}${amount} s` : `${sign}${formatTime(amount)}`;
}

/**
 * The total a run of double taps or 10 s presses will skip, in a soft half-moon on the side it
 * goes, as quiet as the circle behind Play. It takes no touches, so every tap goes on reaching
 * the picture and the buttons beneath it, and it is no button.
 */
export function SkipRipple({
  side,
  total,
  target,
}: {
  side: TapSide;
  /** Seconds from where the video was: negative for back. */
  total: number;
  /** Where the skip lands, for a screen reader. */
  target: number;
}) {
  const { t } = useTranslation();
  const screen = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [fade] = useState(() => new Animated.Value(0));
  useEffect(() => {
    const animation = Animated.timing(fade, {
      toValue: 1,
      duration: motion.fast,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [fade]);

  const height = Math.round(screen.height * RIPPLE_HEIGHT);
  // Flat against the screen's edge, round on the side towards the middle.
  const curve = height / 2;
  // What a camera cutout hides at that edge is added on, and the total sits in the rest.
  const edge = side === 'left' ? insets.left : insets.right;
  const width = Math.min(
    Math.round(curve * RIPPLE_DEPTH) + edge,
    Math.round(screen.width * RIPPLE_MAX_WIDTH),
  );
  return (
    <Animated.View
      pointerEvents="none"
      accessibilityLiveRegion="polite"
      accessibilityLabel={t('phone.seekingTo', { time: formatTime(target) })}
      style={[
        styles.ripple,
        { width, height, top: (screen.height - height) / 2, opacity: fade },
        side === 'left'
          ? {
              left: 0,
              paddingLeft: edge,
              borderTopRightRadius: curve,
              borderBottomRightRadius: curve,
            }
          : {
              right: 0,
              paddingRight: edge,
              borderTopLeftRadius: curve,
              borderBottomLeftRadius: curve,
            },
      ]}
    >
      <Text style={styles.total}>{formatSkip(total)}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  ripple: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.controlPress,
  },
  total: {
    ...type.heading,
    color: colors.text,
    fontVariant: ['tabular-nums'],
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
});
