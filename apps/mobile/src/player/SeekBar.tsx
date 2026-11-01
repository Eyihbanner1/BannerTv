import { formatTime } from '@tv/player/media';
import { type ReactNode, useRef, useState } from 'react';
import { type LayoutChangeEvent, StyleSheet, Text, View } from 'react-native';
import { colors, space, touch, type } from '../ui/theme';

/**
 * The position bar: drag or tap to choose a place, and the player goes there on release. The
 * time sits above it on the left ("4:21 / 7:44"), with room on the right for Next episode.
 */
export function SeekBar({
  position,
  duration,
  onSeek,
  onScrubbing,
  right,
}: {
  position: number;
  duration: number;
  onSeek: (seconds: number) => void;
  /** True while a finger is on the bar, so the controls stay up. */
  onScrubbing: (scrubbing: boolean) => void;
  right?: ReactNode;
}) {
  const width = useRef(1);
  const [scrub, setScrub] = useState<number | null>(null);
  const known = duration > 0;
  const shown = scrub ?? position;
  const fraction = known ? Math.max(0, Math.min(1, shown / duration)) : 0;

  const at = (x: number) => Math.max(0, Math.min(1, x / width.current)) * duration;

  return (
    <View style={styles.wrap}>
      <View style={styles.above}>
        <Text style={styles.time}>
          {formatTime(shown)} / {known ? formatTime(duration) : '--:--'}
        </Text>
        {right}
      </View>
      <View
        style={styles.touch}
        onLayout={(event: LayoutChangeEvent) => {
          width.current = Math.max(1, event.nativeEvent.layout.width);
        }}
        onStartShouldSetResponder={() => known}
        onMoveShouldSetResponder={() => known}
        onResponderTerminationRequest={() => false}
        onResponderGrant={(event) => {
          onScrubbing(true);
          setScrub(at(event.nativeEvent.locationX));
        }}
        onResponderMove={(event) => setScrub(at(event.nativeEvent.locationX))}
        onResponderRelease={(event) => {
          const target = at(event.nativeEvent.locationX);
          setScrub(null);
          onScrubbing(false);
          onSeek(target);
        }}
        onResponderTerminate={() => {
          setScrub(null);
          onScrubbing(false);
        }}
        accessibilityRole="adjustable"
        accessibilityValue={{ min: 0, max: Math.round(duration), now: Math.round(shown) }}
      >
        {/* Drawn parts take no touches, so every touch is measured from the bar itself. */}
        <View style={styles.track} pointerEvents="none">
          <View style={[styles.fill, { width: `${fraction * 100}%` }]} />
        </View>
        {known ? (
          <View pointerEvents="none" style={[styles.thumb, { left: `${fraction * 100}%` }]} />
        ) : null}
      </View>
    </View>
  );
}

const THUMB = 14;

const styles = StyleSheet.create({
  wrap: { gap: space.xs },
  above: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: touch.chip,
  },
  time: { ...type.meta, fontWeight: '600', color: colors.textSoft, fontVariant: ['tabular-nums'] },
  // The bar is 4 high; the finger gets 44 around it.
  touch: { height: 44, justifyContent: 'center' },
  track: {
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.barTrack,
    overflow: 'hidden',
  },
  fill: { height: 4, backgroundColor: colors.text },
  thumb: {
    position: 'absolute',
    width: THUMB,
    height: THUMB,
    marginLeft: -THUMB / 2,
    borderRadius: THUMB / 2,
    backgroundColor: colors.text,
  },
});
