import type { MetaPreview } from '@bannertv/protocol';
import { memo, useCallback, useRef } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { Tile, type TileShape, tileSize } from './Tile';
import { color, layout, spacing, type } from './theme';

export interface RowItem {
  key: string;
  item: MetaPreview;
  note?: string;
  progress?: number;
}

/**
 * A titled row of tiles. The focused tile slides to the row's start, as on the LG with motion on,
 * by scrolling a list whose tiles all have one width, so the offset is known without measuring.
 */
export const Row = memo(function Row({
  title,
  items,
  shape,
  onPress,
  onItemFocus,
  preferredFirst,
}: {
  title: string;
  items: readonly RowItem[];
  shape: TileShape;
  onPress: (entry: RowItem) => void;
  onItemFocus?: (entry: RowItem) => void;
  preferredFirst?: boolean;
}) {
  const list = useRef<FlatList<RowItem>>(null);
  const { width, height } = tileSize(shape);
  const step = width + layout.rowGap;
  const getItemLayout = useCallback(
    (_: unknown, index: number) => ({ length: step, offset: step * index, index }),
    [step],
  );
  return (
    <View style={styles.row}>
      <Text style={styles.title} numberOfLines={1}>
        {title}
      </Text>
      <FlatList
        ref={list}
        horizontal
        data={items}
        keyExtractor={(entry) => entry.key}
        getItemLayout={getItemLayout}
        showsHorizontalScrollIndicator={false}
        // Room for the focused tile to grow and its ring to show.
        style={{ height: height * 1.2 }}
        contentContainerStyle={styles.content}
        initialNumToRender={8}
        maxToRenderPerBatch={6}
        windowSize={5}
        removeClippedSubviews={false}
        renderItem={({ item: entry, index }) => (
          <View style={{ width: step }}>
            <Tile
              item={entry.item}
              shape={shape}
              {...(entry.note ? { note: entry.note } : {})}
              {...(entry.progress !== undefined ? { progress: entry.progress } : {})}
              {...(preferredFirst && index === 0 ? { preferred: true } : {})}
              onPress={() => onPress(entry)}
              onFocus={() => {
                list.current?.scrollToOffset({ offset: step * index, animated: true });
                onItemFocus?.(entry);
              }}
            />
          </View>
        )}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  row: { gap: spacing.sm },
  title: { ...type.rowTitle, color: color.textSoft, paddingLeft: layout.heroLeft },
  content: { paddingHorizontal: layout.heroLeft, alignItems: 'center' },
});
