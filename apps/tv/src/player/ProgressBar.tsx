import { formatTime } from '@tv/player/media';
import { StyleSheet, Text, View } from 'react-native';
import { Focusable } from '../ui/Focusable';
import { color, controls, px, spacing, type } from '../ui/theme';
import { fraction } from './clock';

/**
 * The seek bar: thin, with a round thumb that appears when the remote is on it, where left and
 * right move by ten seconds. `target` is where a run of presses will land, shown before it is sent.
 */
export function ProgressBar({
  position,
  duration,
  target,
  label,
  onFocus,
  onBlur,
}: {
  position: number;
  duration: number;
  target: number | null;
  label: string;
  onFocus: () => void;
  onBlur: () => void;
}) {
  const shown = target ?? position;
  const done = fraction(shown, duration);
  return (
    <View style={styles.wrap}>
      <Focusable
        onFocus={onFocus}
        onBlur={onBlur}
        showRing={false}
        accessibilityLabel={label}
        style={styles.hit}
      >
        {(focused) => (
          <View style={styles.hitInner}>
            <View style={[styles.track, focused && styles.trackFocused]}>
              <View style={[styles.fill, { width: `${done * 100}%` }]} />
            </View>
            {focused ? (
              <View style={[styles.thumb, { left: `${done * 100}%` }]} pointerEvents="none" />
            ) : null}
          </View>
        )}
      </Focusable>
      <View style={styles.times}>
        <Text style={[styles.time, target !== null && styles.timeMoving]}>{formatTime(shown)}</Text>
        <Text style={styles.time}>{duration > 0 ? formatTime(duration) : ''}</Text>
      </View>
    </View>
  );
}

const THUMB = px(28);
const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  hit: { height: px(40) },
  hitInner: { flex: 1, justifyContent: 'center' },
  track: {
    height: controls.bar,
    borderRadius: controls.bar / 2,
    backgroundColor: color.barTrack,
    overflow: 'hidden',
  },
  trackFocused: { height: controls.bar * 1.5 },
  fill: { height: '100%', backgroundColor: color.focus },
  thumb: {
    position: 'absolute',
    top: (px(40) - THUMB) / 2,
    width: THUMB,
    height: THUMB,
    marginLeft: -THUMB / 2,
    borderRadius: THUMB / 2,
    backgroundColor: color.text,
  },
  times: { flexDirection: 'row', justifyContent: 'space-between' },
  time: { ...type.meta, color: color.textSoft },
  timeMoving: { color: color.text },
});
