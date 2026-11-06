import type { PagerState } from '@bannertv/core';
import type { MetaPreview } from '@bannertv/protocol';
import { FocusContext, useFocusable } from '@noriginmedia/norigin-spatial-navigation';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
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
import {
  COLUMN_STEP,
  drawnGridTile,
  GRID_COLUMNS,
  gridTileKey,
  nextGridTile,
  ROW_STEP,
} from './grid-nav';
import styles from './PosterGrid.module.css';

export { gridTileKey } from './grid-nav';

// Rows drawn above and below the two in view.
const ROWS_BEFORE = 1;
const ROWS_AFTER = 3;
/** The next page is asked for when focus gets this many rows from the end. */
const ROWS_BEFORE_END = 2;

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
  const { memoryKey, state, errorMessage, emptyMessage, onRetry } = props;
  const { t } = useTranslation();
  const [anchorRow, setAnchorRow] = useState(() => recallScroll(memoryKey));
  const { items, status } = state;
  // Two rows of placeholders while the first page loads, so the remote has somewhere to go.
  const count = items.length > 0 ? items.length : GRID_COLUMNS * 2;
  const rows = Math.ceil(count / GRID_COLUMNS);
  const firstRow = Math.max(0, anchorRow - ROWS_BEFORE);
  const lastRow = Math.min(rows, anchorRow + ROWS_AFTER + 1);
  const firstTile = firstRow * GRID_COLUMNS;
  const lastTile = Math.min(count, lastRow * GRID_COLUMNS);
  // The arrows move between tiles by index (grid-nav.ts), so spatial navigation
  // skips measuring them (navigation/spatial.ts). Not while a page has failed:
  // Try again then sits in the grid, and is found by position as before.
  const byIndex = status !== 'error';
  const { ref, focusKey } = useFocusable<object, HTMLDivElement>({
    focusKey: 'discover-grid',
    saveLastFocusedChild: true,
    // Always naming a drawn tile: the first drawn one is the one a search by
    // position picks, which unmeasured tiles cannot be searched for.
    preferredChildFocusKey:
      drawnGridTile(recallFocus(memoryKey), firstTile, lastTile) ?? gridTileKey(firstTile),
    measureChildrenLayout: !byIndex,
    nextFocusResolver: byIndex ? nextGridTile : undefined,
  });

  // Tiles get handlers that never change, so focusing one redraws two tiles, not the grid.
  const latest = useRef({ props, anchorRow, rows });
  useLayoutEffect(() => {
    latest.current = { props, anchorRow, rows };
  });
  const onTileFocus = useCallback((index: number) => {
    const { props: current, anchorRow: anchor, rows: total } = latest.current;
    const row = Math.floor(index / GRID_COLUMNS);
    rememberFocus(current.memoryKey, gridTileKey(index));
    current.onFocusTile(index);
    if (canSlide() && row !== anchor) {
      setAnchorRow(row);
      rememberScroll(current.memoryKey, row);
    }
    if (row >= total - ROWS_BEFORE_END) current.onLoadMore();
  }, []);
  const onTilePress = useCallback((index: number) => {
    const { props: current } = latest.current;
    const item = current.state.items[index];
    if (item) current.onPress(item);
  }, []);

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

  const loadingLabel = t('home.loadingTile');
  const tiles = [];
  for (let index = firstTile; index < lastTile; index++) {
    tiles.push(
      <Tile
        key={index}
        focusKey={gridTileKey(index)}
        item={items[index]}
        shape="poster"
        index={index}
        loadingLabel={loadingLabel}
        left={(index % GRID_COLUMNS) * COLUMN_STEP}
        top={Math.floor(index / GRID_COLUMNS) * ROW_STEP}
        onTileFocus={onTileFocus}
        onTilePress={onTilePress}
      />,
    );
  }

  return (
    <FocusContext.Provider value={focusKey}>
      <div ref={ref} className={styles.grid} data-index-nav={byIndex ? '' : undefined}>
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
