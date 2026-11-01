import { metahubAtSize } from '@bannertv/core';
import type { MetaPreview } from '@bannertv/protocol';
import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Artwork } from './Artwork';
import { phone } from '@brand/tokens/design';
import { colors, radius, space, type } from './theme';

export const POSTER = { width: phone.tilePosterW, height: phone.tilePosterH } as const;
export const LANDSCAPE = { width: phone.tileWideW, height: phone.tileWideH } as const;

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
      <View>
        <Artwork
          src={phoneArt(src)}
          retrySrc={src}
          seed={item.id}
          style={{
            width: tileWidth,
            height,
            borderRadius: shape === 'poster' ? radius.m : 12,
          }}
          fallback={
            <View style={styles.fallback}>
              <Text style={styles.fallbackName} numberOfLines={3}>
                {item.name}
              </Text>
            </View>
          }
        />
        {progress !== undefined ? (
          <View style={styles.track} pointerEvents="none">
            <View style={[styles.fill, { width: `${Math.round(Math.min(1, progress) * 100)}%` }]} />
          </View>
        ) : null}
      </View>
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
  // Along the picture's bottom edge, as the design's Continue Watching cards.
  track: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: phone.progress,
    backgroundColor: colors.barTrack,
    borderBottomLeftRadius: 12,
    borderBottomRightRadius: 12,
    overflow: 'hidden',
  },
  fill: { height: phone.progress, backgroundColor: colors.accent },
  caption: { paddingTop: 6, gap: 1 },
  name: { ...type.label, color: colors.text },
  note: { ...type.meta, color: colors.textMuted },
});
