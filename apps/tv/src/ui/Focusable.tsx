import { type ReactNode, useState } from 'react';
import { Animated, Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { color, easing, focused as focusTokens, motion, ring } from './theme';

/**
 * Anything the remote can land on. Focus grows it a little and draws the violet ring with its
 * soft glow, both on the native thread (Animated with the native driver), so moving along a row
 * never waits for JavaScript.
 */
export function Focusable({
  onPress,
  onFocus,
  onBlur,
  children,
  style,
  radius = 0,
  grow = false,
  showRing = true,
  preferred = false,
  disabled = false,
  accessibilityLabel,
}: {
  onPress?: () => void;
  onFocus?: () => void;
  onBlur?: () => void;
  /** Drawn with whether the remote is on it. */
  children: ReactNode | ((focused: boolean) => ReactNode);
  style?: StyleProp<ViewStyle>;
  radius?: number;
  /** Tiles grow when focused; buttons and rows keep their size. */
  grow?: boolean;
  showRing?: boolean;
  /** Takes focus when the screen opens. */
  preferred?: boolean;
  disabled?: boolean;
  accessibilityLabel?: string;
}) {
  const [isFocused, setFocused] = useState(false);
  const [progress] = useState(() => new Animated.Value(0));
  const animate = (to: number) =>
    Animated.timing(progress, {
      toValue: to,
      duration: to ? motion.fast : motion.base,
      easing: easing.standard,
      useNativeDriver: true,
    }).start();
  const scale = grow
    ? progress.interpolate({ inputRange: [0, 1], outputRange: [1, focusTokens.tileScale] })
    : 1;
  return (
    <Animated.View style={[style, { transform: [{ scale }] }]}>
      <Pressable
        onPress={onPress}
        onFocus={() => {
          setFocused(true);
          animate(1);
          onFocus?.();
        }}
        onBlur={() => {
          setFocused(false);
          animate(0);
          onBlur?.();
        }}
        hasTVPreferredFocus={preferred}
        disabled={disabled}
        focusable={!disabled}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        style={[styles.fill, { borderRadius: radius }]}
      >
        {typeof children === 'function' ? children(isFocused) : children}
      </Pressable>
      {showRing ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.glow,
            {
              opacity: progress,
              borderRadius: radius + ring.width + ring.glow,
              margin: -(ring.width + ring.glow),
              borderWidth: ring.glow,
            },
          ]}
        >
          <Animated.View
            style={[styles.ring, { borderRadius: radius + ring.width, borderWidth: ring.width }]}
          />
        </Animated.View>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  fill: { flexGrow: 1, overflow: 'hidden' },
  glow: { ...StyleSheet.absoluteFill, borderColor: color.focusGlow },
  ring: { flex: 1, borderColor: color.focus },
});
