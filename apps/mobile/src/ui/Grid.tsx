import type { MetaPreview } from '@bannertv/protocol';
import type { ReactElement } from 'react';
import { FlatList, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Tile } from './Tile';
import { gutter, space } from './theme';

const COLUMNS = 3;

/** A grid of posters that fills the phone's width. */
export function Grid({
  items,
  onPress,
  header,
  footer,
  onEndReached,
}: {
  items: readonly MetaPreview[];
  onPress: (item: MetaPreview) => void;
  header?: ReactElement;
  footer?: ReactElement;
  onEndReached?: () => void;
}) {
  const { width } = useWindowDimensions();
  const tileWidth = Math.floor((width - gutter * 2 - space.m * (COLUMNS - 1)) / COLUMNS);
  return (
    <FlatList
      data={items}
      numColumns={COLUMNS}
      keyExtractor={(item, index) => `${index}:${item.id}`}
      renderItem={({ item }) => (
        <View style={styles.cell}>
          <Tile item={item} shape="poster" width={tileWidth} onPress={onPress} />
        </View>
      )}
      {...(header ? { ListHeaderComponent: header } : {})}
      {...(footer ? { ListFooterComponent: footer } : {})}
      columnWrapperStyle={styles.columns}
      contentContainerStyle={styles.content}
      {...(onEndReached ? { onEndReached, onEndReachedThreshold: 1.5 } : {})}
      initialNumToRender={12}
    />
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: space.xxl },
  columns: { gap: space.m, paddingHorizontal: gutter },
  cell: { marginBottom: space.m },
});
