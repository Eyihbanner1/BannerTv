import { metahubAtSize } from '@bannertv/core';
import type { MetaPreview } from '@bannertv/protocol';
import { Artwork } from '@phone/ui/Artwork';
import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Focusable } from './Focusable';
import { color, layout, px, radii, spacing, type } from './theme';

export type TileShape = 'poster' | 'landscape';

export function tileSize(shape: TileShape): { width: number; height: number } {
  return shape === 'poster'
    ? { width: layout.tilePosterW, height: layout.tilePosterH }
    : { width: layout.tileWideW, height: layout.tileWideH };
}

/** A Metahub picture at the size a TV tile needs; other addons' pictures as they are. */
export function tvArt(url: string | undefined): string | undefined {
  return url ? metahubAtSize(url, 'medium') : undefined;
}

/** One title on a row: its picture only, as the hero above says what it is. */
export const Tile = memo(function Tile({
  item,
  shape,
  progress,
  note,
  onPress,
  onFocus,
  preferred,
}: {
  item: MetaPreview;
  shape: TileShape;
  progress?: number;
  note?: string;
  onPress: () => void;
  onFocus?: () => void;
  preferred?: boolean;
}) {
  const size = tileSize(shape);
  const art = shape === 'landscape' ? (item.background ?? item.poster) : item.poster;
  return (
    <Focusable
      onPress={onPress}
      {...(onFocus ? { onFocus } : {})}
      grow
      radius={radii.md}
      {...(preferred ? { preferred } : {})}
      accessibilityLabel={[item.name, note].filter(Boolean).join(', ')}
      style={size}
    >
      <Artwork
        src={tvArt(art)}
        retrySrc={art}
        seed={item.id}
        style={{ ...size, borderRadius: radii.md }}
        fallback={
          <View style={styles.fallback}>
            <Text style={styles.name} numberOfLines={3}>
              {item.name}
            </Text>
          </View>
        }
      />
      {note ? (
        <View style={styles.noteBox}>
          <Text style={styles.note} numberOfLines={1}>
            {note}
          </Text>
        </View>
      ) : null}
      {progress !== undefined ? (
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${Math.round(progress * 100)}%` }]} />
        </View>
      ) : null}
    </Focusable>
  );
});

const styles = StyleSheet.create({
  fallback: { flex: 1, justifyContent: 'flex-end', padding: spacing.md },
  name: { ...type.label, color: color.text },
  noteBox: {
    position: 'absolute',
    left: spacing.sm,
    bottom: spacing.lg,
    backgroundColor: color.playerScrim,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: px(4),
  },
  note: { ...type.small, color: color.text },
  track: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    bottom: spacing.sm,
    height: px(6),
    borderRadius: px(3),
    backgroundColor: color.barTrack,
  },
  fill: { height: '100%', borderRadius: px(3), backgroundColor: color.accent },
});
