import { formatTime } from '@tv/player/media';
import { useRef, useState } from 'react';
import { type LayoutChangeEvent, StyleSheet, Text, View } from 'react-native';
import { colors, space, type } from '../ui/theme';

/** The position bar: drag or tap to choose a place, and the player goes there on release. */
export function SeekBar({
  position,
  duration,
  onSeek,
  onScrubbing,
}: {
  position: number;
  duration: number;
  onSeek: (seconds: number) => void;
  /** True while a finger is on the bar, so the controls stay up. */
  onScrubbing: (scrubbing: boolean) => void;
}) {
  const width = useRef(1);
  const [scrub, setScrub] = useState<number | null>(null);
  const known = duration > 0;
  const shown = scrub ?? position;
  const fraction = known ? Math.max(0, Math.min(1, shown / duration)) : 0;

  const at = (x: number) => Math.max(0, Math.min(1, x / width.current)) * duration;

  return (
    <View style={styles.wrap}>
      <Text style={styles.time}>{formatTime(shown)}</Text>
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
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${fraction * 100}%` }]} />
        </View>
        {known ? <View style={[styles.thumb, { left: `${fraction * 100}%` }]} /> : null}
      </View>
      <Text style={styles.time}>{known ? formatTime(duration) : '--:--'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', gap: space.m },
  time: { ...type.label, color: colors.text, minWidth: 56, textAlign: 'center' },
  touch: { flex: 1, height: 36, justifyContent: 'center' },
  track: {
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.3)',
    overflow: 'hidden',
  },
  fill: { height: 4, backgroundColor: colors.accent },
  thumb: {
    position: 'absolute',
    width: 16,
    height: 16,
    marginLeft: -8,
    borderRadius: 8,
    backgroundColor: colors.prismTop,
  },
});
