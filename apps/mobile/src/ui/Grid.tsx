import type { MetaPreview } from '@bannertv/protocol';
import type { ReactElement } from 'react';
import {
  FlatList,
  type RefreshControlProps,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { FIRST_RENDER_TILES, GRID_WINDOW_SCREENS, rowsForTiles } from './grid-window';
import { Tile } from './Tile';
import { gutter, space } from './theme';

const COLUMNS = 3;
/** FlatList counts rows here, not tiles: see grid-window.ts. */
const FIRST_RENDER_ROWS = rowsForTiles(FIRST_RENDER_TILES, COLUMNS);

/** A grid of posters that fills the phone's width. */
export function Grid({
  items,
  onPress,
  header,
  footer,
  onEndReached,
  refreshControl,
}: {
  items: readonly MetaPreview[];
  onPress: (item: MetaPreview) => void;
  header?: ReactElement;
  footer?: ReactElement;
  onEndReached?: () => void;
  /** Pull to refresh, from usePullRefresh. */
  refreshControl?: ReactElement<RefreshControlProps>;
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
      {...(refreshControl ? { refreshControl } : {})}
      columnWrapperStyle={styles.columns}
      contentContainerStyle={styles.content}
      {...(onEndReached ? { onEndReached, onEndReachedThreshold: 1.5 } : {})}
      initialNumToRender={FIRST_RENDER_ROWS}
      windowSize={GRID_WINDOW_SCREENS}
    />
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: space.xxl },
  columns: { gap: space.m, paddingHorizontal: gutter },
  cell: { marginBottom: space.m },
});
