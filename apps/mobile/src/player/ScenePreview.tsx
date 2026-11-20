import { formatTime } from '@tv/player/media';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import type { VideoThumbnail } from 'expo-video';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Platform,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { colors, radius, space, type } from '../ui/theme';
import { phonePlayer } from './phone-host';
import { createFrameSource } from './scene-frames';

/** The largest frame asked for: enough for a sharp card, small enough to come quickly. */
const FRAME_MAX_W = 320;
const FRAME_MAX_H = 180;
/** One pass of the shimmer over an empty frame. */
const SHIMMER_MS = 1100;

/**
 * Frames of the stream playing, taken by Android from the file itself (expo-video's thumbnails,
 * which read the file the way the player does, with its link and headers). So they work for
 * any addon stream that is a file, such as a debrid link, with no thumbnail track in it.
 * Broadcasts and HLS links give none, and the card then shows the time alone.
 */
export const sceneFrames = createFrameSource<VideoThumbnail>(async (seconds) => {
  if (Platform.OS !== 'android') throw new Error('Frames are taken on Android only');
  const [frame] = await phonePlayer().generateThumbnailsAsync(seconds, {
    maxWidth: FRAME_MAX_W,
    maxHeight: FRAME_MAX_H,
  });
  if (!frame) throw new Error('No frame');
  return frame;
});

/**
 * The scene a swipe or a drag along the bar will land on: a still from that place in the
 * video, the time there and how far that is from now. A swipe also gets its own slim bar,
 * since the controls stay hidden; dragging the bar uses the real one. It takes no touches.
 */
export function ScenePreview({
  at,
  origin,
  duration,
  tag,
  swiping,
}: {
  /** Where the player will go, in seconds. */
  at: number;
  /** Where it was when the swipe or drag began. */
  origin: number;
  duration: number;
  /** "Intro" or "Recap", when it lands in one. */
  tag?: string;
  /** A swipe over the picture, rather than a drag along the bar. */
  swiping: boolean;
}) {
  const { t } = useTranslation();
  const screen = useWindowDimensions();
  useSyncExternalStore(sceneFrames.subscribe, sceneFrames.version);
  useEffect(() => sceneFrames.want(at), [at]);
  const near = sceneFrames.near(at);
  // Room for the frame without crowding the controls on a phone held sideways.
  const frameWidth = Math.round(
    Math.min(FRAME_MAX_W - 20, screen.width * 0.36, (screen.height * 0.36 * 16) / 9),
  );
  const framed = near !== undefined || (Platform.OS === 'android' && sceneFrames.works());
  const delta = Math.round(at - origin);
  const sign = delta < 0 ? '−' : '+';
  const fraction = duration > 0 ? Math.max(0, Math.min(1, at / duration)) : 0;
  const from = duration > 0 ? Math.max(0, Math.min(1, origin / duration)) : 0;

  return (
    <View
      style={[styles.layer, swiping ? styles.dim : styles.raised]}
      pointerEvents="none"
      accessibilityLiveRegion="polite"
      accessibilityLabel={t('phone.seekingTo', { time: formatTime(at) })}
    >
      <View style={styles.card}>
        {framed ? (
          <View style={[styles.frame, { width: frameWidth, height: (frameWidth * 9) / 16 }]}>
            {near ? (
              <Image
                source={near.frame}
                style={StyleSheet.absoluteFill}
                contentFit="cover"
                transition={90}
                cachePolicy="none"
              />
            ) : (
              <FrameShimmer width={frameWidth} />
            )}
            {tag ? <Text style={styles.tag}>{tag}</Text> : null}
          </View>
        ) : null}
        <View style={styles.times}>
          <Text style={styles.time}>{formatTime(at)}</Text>
          <Text style={styles.delta}>
            {sign}
            {formatTime(Math.abs(delta))}
          </Text>
          {!framed && tag ? <Text style={styles.inlineTag}>{tag}</Text> : null}
        </View>
        {swiping && duration > 0 ? (
          <View style={[styles.track, { width: framed ? frameWidth : 200 }]}>
            <View
              style={[
                styles.span,
                {
                  left: `${Math.min(from, fraction) * 100}%`,
                  width: `${Math.abs(fraction - from) * 100}%`,
                },
              ]}
            />
            <View style={[styles.mark, { left: `${fraction * 100}%` }]} />
          </View>
        ) : null}
      </View>
    </View>
  );
}

/**
 * What an empty frame shows while its picture is on its way: a soft light sweeping across, so
 * it reads as coming rather than broken. Still, with Android's remove animations on.
 */
function FrameShimmer({ width }: { width: number }) {
  const [sweep] = useState(() => new Animated.Value(0));
  useEffect(() => {
    let live = true;
    let loop: Animated.CompositeAnimation | undefined;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((still) => {
        if (!live || still) return;
        loop = Animated.loop(
          Animated.timing(sweep, {
            toValue: 1,
            duration: SHIMMER_MS,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: Platform.OS !== 'web',
          }),
        );
        loop.start();
      })
      .catch(() => undefined);
    return () => {
      live = false;
      loop?.stop();
    };
  }, [sweep]);
  const band = Math.round(width * 0.6);
  const translateX = sweep.interpolate({ inputRange: [0, 1], outputRange: [-band, width] });
  return (
    <View style={[StyleSheet.absoluteFill, styles.shimmer]}>
      <Animated.View style={[styles.shimmerBand, { width: band, transform: [{ translateX }] }]}>
        <LinearGradient
          colors={['rgba(255,255,255,0)', 'rgba(255,255,255,0.09)', 'rgba(255,255,255,0)']}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  layer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // A swipe darkens the picture a little, so the card reads; the bar's drag has the controls'.
  dim: { backgroundColor: 'rgba(0,0,0,0.32)' },
  // Clear of the seek bar under it.
  raised: { paddingBottom: 56 },
  card: { alignItems: 'center', gap: space.s },
  frame: {
    borderRadius: radius.m,
    overflow: 'hidden',
    backgroundColor: colors.playerBg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.barBuffer,
  },
  // A little lighter than the player's black, so the empty frame reads as a place for a picture.
  shimmer: { backgroundColor: colors.surface2, overflow: 'hidden' },
  shimmerBand: { position: 'absolute', top: 0, bottom: 0, left: 0 },
  tag: {
    position: 'absolute',
    left: space.s,
    top: space.s,
    ...type.small,
    fontWeight: '700',
    color: colors.text,
    backgroundColor: colors.scrim,
    paddingHorizontal: space.s,
    paddingVertical: 2,
    borderRadius: radius.s,
    overflow: 'hidden',
  },
  times: { flexDirection: 'row', alignItems: 'baseline', gap: space.s },
  time: {
    ...type.heading,
    color: colors.text,
    fontVariant: ['tabular-nums'],
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  delta: {
    ...type.meta,
    fontWeight: '600',
    color: colors.textSoft,
    fontVariant: ['tabular-nums'],
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  inlineTag: { ...type.small, fontWeight: '700', color: colors.accent },
  track: { height: 3, borderRadius: 2, backgroundColor: colors.barTrack, marginTop: 2 },
  span: { position: 'absolute', top: 0, bottom: 0, backgroundColor: colors.text },
  mark: {
    position: 'absolute',
    top: -3,
    width: 9,
    height: 9,
    marginLeft: -4.5,
    borderRadius: 4.5,
    backgroundColor: colors.text,
  },
});
