import { metahubAtSize } from '@bannertv/core';
import type { MetaPreview } from '@bannertv/protocol';
import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Artwork } from './Artwork';
import { colors, radius, space, type } from './theme';

export const POSTER = { width: 112, height: 168 } as const;
export const LANDSCAPE = { width: 248, height: 140 } as const;

export type TileShape = 'poster' | 'landscape';

/** A Metahub picture at a phone's size; other addons' pictures as they are. */
export function phoneArt(url: string | undefined, size: 'small' | 'medium' = 'medium') {
  return url ? metahubAtSize(url, size) : undefined;
}

export const Tile = memo(function Tile({
  item,
  shape,
  note,
  progress,
  onPress,
  width,
}: {
  item: MetaPreview;
  shape: TileShape;
  note?: string;
  progress?: number;
  onPress: (item: MetaPreview) => void;
  /** Overrides the shape's width (grids); the height keeps the shape's proportions. */
  width?: number;
}) {
  const box = shape === 'poster' ? POSTER : LANDSCAPE;
  const tileWidth = width ?? box.width;
  const height = (tileWidth * box.height) / box.width;
  const src = shape === 'poster' ? item.poster : (item.background ?? item.poster);
  const label = [item.name, note ?? item.releaseInfo].filter(Boolean).join(', ');
  return (
    <Pressable
      onPress={() => onPress(item)}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [{ width: tileWidth }, pressed && styles.pressed]}
    >
      <Artwork
        src={phoneArt(src)}
        retrySrc={src}
        seed={item.id}
        style={{ width: tileWidth, height, borderRadius: radius.m }}
        fallback={
          <View style={styles.fallback}>
            <Text style={styles.fallbackName} numberOfLines={3}>
              {item.name}
            </Text>
          </View>
        }
      />
      {progress !== undefined ? (
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${Math.round(Math.min(1, progress) * 100)}%` }]} />
        </View>
      ) : null}
      {shape === 'landscape' || note ? (
        <View style={styles.caption}>
          {shape === 'landscape' ? (
            <Text style={styles.name} numberOfLines={1}>
              {item.name}
            </Text>
          ) : null}
          {note ? (
            <Text style={styles.note} numberOfLines={1}>
              {note}
            </Text>
          ) : null}
        </View>
      ) : null}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  pressed: { opacity: 0.7, transform: [{ scale: 0.98 }] },
  fallback: { flex: 1, justifyContent: 'flex-end', padding: space.s },
  fallbackName: { ...type.label, color: colors.text },
  track: {
    height: 3,
    marginTop: -3,
    marginHorizontal: space.s,
    backgroundColor: 'rgba(255,255,255,0.25)',
    borderRadius: 2,
    overflow: 'hidden',
  },
  fill: { height: 3, backgroundColor: colors.accent },
  caption: { paddingTop: space.xs, gap: 1 },
  name: { ...type.label, color: colors.text },
  note: { ...type.small, color: colors.textMuted },
});
