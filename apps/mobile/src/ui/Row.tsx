import type { MetaPreview } from '@bannertv/protocol';
import type { ReactNode } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { type TileShape, LANDSCAPE, POSTER, Tile } from './Tile';
import { colors, radius, space, type } from './theme';

export interface RowItem {
  item: MetaPreview;
  key: string;
  note?: string;
  progress?: number;
}

/** A titled, side-scrolling row of tiles, as Home's rows. */
export function Row({
  title,
  tag,
  items,
  shape,
  onPress,
  onSeeAll,
  seeAllLabel,
  footer,
}: {
  title: string;
  tag?: string;
  items: readonly RowItem[] | null;
  shape: TileShape;
  onPress: (item: RowItem) => void;
  onSeeAll?: () => void;
  seeAllLabel?: string;
  /** Shown instead of tiles: an error with Try again, for example. */
  footer?: ReactNode;
}) {
  const box = shape === 'poster' ? POSTER : LANDSCAPE;
  return (
    <View style={styles.row}>
      <View style={styles.header}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        {tag ? (
          <Text style={styles.tag} numberOfLines={1}>
            {tag}
          </Text>
        ) : null}
        <View style={styles.spacer} />
        {onSeeAll && seeAllLabel ? (
          <Pressable onPress={onSeeAll} accessibilityRole="button" hitSlop={12}>
            <Text style={styles.seeAll}>{seeAllLabel}</Text>
          </Pressable>
        ) : null}
      </View>
      {footer ? (
        footer
      ) : items === null ? (
        <View style={styles.placeholders}>
          {[0, 1, 2, 3].map((index) => (
            <View key={index} style={[styles.placeholder, box]} />
          ))}
        </View>
      ) : (
        <FlatList
          horizontal
          data={items}
          keyExtractor={(entry) => entry.key}
          renderItem={({ item: entry }) => (
            <Tile
              item={entry.item}
              shape={shape}
              {...(entry.note ? { note: entry.note } : {})}
              {...(entry.progress !== undefined ? { progress: entry.progress } : {})}
              onPress={() => onPress(entry)}
            />
          )}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={Separator}
          initialNumToRender={4}
          windowSize={3}
          removeClippedSubviews
        />
      )}
    </View>
  );
}

function Separator() {
  return <View style={styles.separator} />;
}

const styles = StyleSheet.create({
  row: { paddingTop: space.l, gap: space.s },
  header: {
    flexDirection: 'row',
    alignItems: 'baseline',
    paddingHorizontal: space.l,
    gap: space.s,
  },
  title: { ...type.heading, color: colors.text, flexShrink: 1 },
  tag: { ...type.small, color: colors.textSubtle, flexShrink: 1 },
  spacer: { flex: 1 },
  seeAll: { ...type.label, color: colors.accent },
  list: { paddingHorizontal: space.l },
  separator: { width: space.m },
  placeholders: { flexDirection: 'row', gap: space.m, paddingHorizontal: space.l },
  placeholder: { backgroundColor: colors.surface2, borderRadius: radius.m },
});
