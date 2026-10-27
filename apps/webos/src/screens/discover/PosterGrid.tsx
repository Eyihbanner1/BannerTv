import type { PagerState } from '@bannertv/core';
import type { MetaPreview } from '@bannertv/protocol';
import { FocusContext, useFocusable } from '@noriginmedia/norigin-spatial-navigation';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/Button';
import { Tile } from '../../components/Tile';
import {
  recallFocus,
  recallScroll,
  rememberFocus,
  rememberScroll,
} from '../../navigation/focus-memory';
import { canSlide } from '../../platform/input-mode';
import styles from './PosterGrid.module.css';

const GRID_COLUMNS = 7;
const COLUMN_STEP = 220 + 24;
const ROW_STEP = 330 + 40;
// Rows drawn above and below the two in view.
const ROWS_BEFORE = 1;
const ROWS_AFTER = 3;
/** The next page is asked for when focus gets this many rows from the end. */
const ROWS_BEFORE_END = 2;

export const gridTileKey = (index: number) => `discover-tile-${index}`;

interface PosterGridProps {
  /** Where the grid keeps its scroll and last tile, per catalog and genre. */
  memoryKey: string;
  state: PagerState;
  errorMessage: string;
  emptyMessage: string;
  onLoadMore: () => void;
  onRetry: () => void;
  onPress: (item: MetaPreview) => void;
  onFocusTile: (index: number) => void;
}

/**
 * Posters seven across. The focused row slides to the top, as on Home, and
 * only rows near the view are drawn: a catalog can page on for thousands of
 * titles. Tiles are placed absolutely, so Up and Down land on the poster
 * straight above or below.
 */
export function PosterGrid(props: PosterGridProps) {
  const { memoryKey, state, errorMessage, emptyMessage, onLoadMore, onRetry, onPress } = props;
  const { t } = useTranslation();
  const { ref, focusKey } = useFocusable<object, HTMLDivElement>({
    focusKey: 'discover-grid',
    saveLastFocusedChild: true,
    preferredChildFocusKey: recallFocus(memoryKey),
  });
  const [anchorRow, setAnchorRow] = useState(() => recallScroll(memoryKey));
  const { items, status } = state;

  if (items.length === 0 && (status === 'error' || status === 'done')) {
    return (
      <FocusContext.Provider value={focusKey}>
        <div ref={ref} className={styles.message}>
          <p>{status === 'error' ? errorMessage : emptyMessage}</p>
          {status === 'error' && (
            <Button focusKey={gridTileKey(0)} label={t('common.tryAgain')} onPress={onRetry} />
          )}
        </div>
      </FocusContext.Provider>
    );
  }

  // Two rows of placeholders while the first page loads, so the remote has somewhere to go.
  const count = items.length > 0 ? items.length : GRID_COLUMNS * 2;
  const rows = Math.ceil(count / GRID_COLUMNS);
  const firstRow = Math.max(0, anchorRow - ROWS_BEFORE);
  const lastRow = Math.min(rows, anchorRow + ROWS_AFTER + 1);
  const tiles = [];
  for (
    let index = firstRow * GRID_COLUMNS;
    index < Math.min(count, lastRow * GRID_COLUMNS);
    index++
  ) {
    const row = Math.floor(index / GRID_COLUMNS);
    const item = items[index];
    const tileKey = gridTileKey(index);
    tiles.push(
      <Tile
        key={index}
        focusKey={tileKey}
        item={item}
        shape="poster"
        index={index}
        loadingLabel={t('home.loadingTile')}
        style={{ left: (index % GRID_COLUMNS) * COLUMN_STEP, top: row * ROW_STEP }}
        onPress={() => item && onPress(item)}
        onFocus={() => {
          rememberFocus(memoryKey, tileKey);
          props.onFocusTile(index);
          if (canSlide() && row !== anchorRow) {
            setAnchorRow(row);
            rememberScroll(memoryKey, row);
          }
          if (row >= rows - ROWS_BEFORE_END) onLoadMore();
        }}
      />,
    );
  }

  return (
    <FocusContext.Provider value={focusKey}>
      <div ref={ref} className={styles.grid}>
        <div
          className={styles.track}
          style={{ transform: `translateY(${-anchorRow * ROW_STEP}px)` }}
        >
          {tiles}
          {status === 'error' && items.length > 0 && (
            <div className={styles.more} style={{ top: rows * ROW_STEP }}>
              <p>{errorMessage}</p>
              <Button
                focusKey="discover-more-retry"
                label={t('common.tryAgain')}
                onPress={onRetry}
              />
            </div>
          )}
        </div>
      </div>
    </FocusContext.Provider>
  );
}
