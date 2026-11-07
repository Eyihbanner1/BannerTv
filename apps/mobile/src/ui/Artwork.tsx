import { Image, type ImageContentFit } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { type ReactNode, useState } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { fallbackArt } from './theme';

/**
 * An addon's picture, with the original address as a second try (Metahub's resized copies
 * often 404) and a violet gradient when neither loads, as the TV's Artwork does.
 */
export function Artwork({
  src,
  retrySrc,
  seed,
  style,
  contentFit = 'cover',
  fallback,
  transition = 150,
  backdrop = true,
}: {
  src?: string;
  retrySrc?: string;
  seed: string;
  style?: ViewStyle;
  contentFit?: ImageContentFit;
  fallback?: ReactNode;
  transition?: number;
  /** The violet gradient under the picture; off for logos. */
  backdrop?: boolean;
}) {
  const [attempt, setAttempt] = useState(0);
  const sources = [src, retrySrc].filter((value, index, all): value is string => {
    return typeof value === 'string' && value !== '' && all.indexOf(value) === index;
  });
  const current = sources[attempt];
  const [from, to] = fallbackArt(seed);
  return (
    <View style={[styles.box, style]}>
      {backdrop ? <LinearGradient colors={[from, to]} style={StyleSheet.absoluteFill} /> : null}
      {current === undefined ? (
        fallback
      ) : (
        <Image
          key={current}
          source={{ uri: current }}
          style={StyleSheet.absoluteFill}
          contentFit={contentFit}
          transition={transition}
          cachePolicy="memory-disk"
          recyclingKey={current}
          onError={() => setAttempt((value) => value + 1)}
          accessible={false}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { overflow: 'hidden' },
});
