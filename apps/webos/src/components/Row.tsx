import type { MetaPreview } from '@bannertv/protocol';
import {
  type FocusableComponent,
  FocusContext,
  setFocus,
  useFocusable,
} from '@noriginmedia/norigin-spatial-navigation';
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  recallFocus,
  recallScroll,
  rememberFocus,
  rememberScroll,
} from '../navigation/focus-memory';
import { canSlide } from '../platform/input-mode';
import { Button } from './Button';
import { MoreTile, Tile, type TileShape } from './Tile';
import styles from './Row.module.css';

/** Tile pitch and how many fit across the 1704 px the row shows. */
export const ROW_GEOMETRY = {
  poster: { step: 220 + 24, visible: 7 },
  landscape: { step: 384 + 24, visible: 4 },
} as const;

// Tiles drawn either side of the visible ones, so the next arrow press always has a target.
const OVERSCAN = 2;

/**
 * Left and Right move to the next tile by its index, so spatial navigation
 * does not measure every tile in the row on each press. Up and Down, and
 * Left or Right past either end, leave the row as before.
 */
function nextTile(
  direction: string,
  focusKey: string,
  siblings: FocusableComponent[],
): FocusableComponent | null {
  if (direction !== 'left' && direction !== 'right') return null;
  const match = /-tile-(\d+)$/.exec(focusKey);
  if (!match) return null;
  const index = Number(match[1]) + (direction === 'right' ? 1 : -1);
  const target = `${focusKey.slice(0, match.index)}-tile-${index}`;
  for (const sibling of siblings) if (sibling.focusKey === target) return sibling;
  return null;
}

interface RowProps {
  focusKey: string;
  title: string;
  /** Muted words after the title, such as "Movies". */
  tag?: string;
  shape: TileShape;
  /** Null while loading: the row shows focusable placeholders. */
  items: readonly MetaPreview[] | null;
  /** Shown instead of tiles, with a Try again button, when nothing could be loaded. */
  error?: string;
  onRetry?: () => void;
  onItemFocus: (item: MetaPreview, row: HTMLElement) => void;
  onItemPress: (item: MetaPreview) => void;
  /** Adds a last tile that opens the whole catalog. */
  onSeeAll?: () => void;
}

/**
 * A horizontal row of tiles. With the remote's arrows the focused tile always
 * sits at the same anchor on the left and the row slides under it, so the eye
 * stays still. With the pointer the row holds still and arrows at its edges
 * page through it. Only tiles near the view are drawn, which keeps poster
 * decoding and memory down on 2020 TVs.
 */
export const Row = memo(function Row(props: RowProps) {
  const { focusKey, title, tag, shape, items, error, onRetry, onItemFocus, onItemPress, onSeeAll } =
    props;
  const { t } = useTranslation();
  const { step, visible } = ROW_GEOMETRY[shape];
  const seeAll = onSeeAll !== undefined && items !== null && items.length > 0 && !error;
  const count = items ? items.length + (seeAll ? 1 : 0) : visible;
  const [scrolled, setAnchor] = useState(() => recallScroll(focusKey));
  // A row that loaded fewer titles than it showed placeholders keeps focus on a real one.
  const anchor = Math.min(scrolled, Math.max(0, count - 1));
  const focusAfterPaging = useRef<number | null>(null);
  const { ref } = useFocusable<object, HTMLElement>({
    focusKey,
    saveLastFocusedChild: true,
    preferredChildFocusKey: recallFocus(focusKey),
    measureChildrenLayout: false,
    nextFocusResolver: nextTile,
  });

  const scrollTo = useCallback(
    (index: number) => {
      setAnchor(index);
      rememberScroll(focusKey, index);
    },
    [focusKey],
  );

  // Tiles get handlers that never change, so moving along the row redraws the
  // two tiles whose focus changed, not every tile.
  const latest = useRef({ items, anchor, onItemFocus, onItemPress });
  useLayoutEffect(() => {
    latest.current = { items, anchor, onItemFocus, onItemPress };
  });
  const onTileFocus = useCallback(
    (index: number) => {
      const current = latest.current;
      rememberFocus(focusKey, `${focusKey}-tile-${index}`);
      if (canSlide() && index !== current.anchor) scrollTo(index);
      const item = current.items ? current.items[index] : undefined;
      if (item && ref.current) current.onItemFocus(item, ref.current);
    },
    [focusKey, scrollTo, ref],
  );
  const onTilePress = useCallback((index: number) => {
    const { items: list, onItemPress: press } = latest.current;
    const item = list ? list[index] : undefined;
    if (item) press(item);
  }, []);

  useEffect(() => {
    if (focusAfterPaging.current === null) return;
    void setFocus(`${focusKey}-tile-${focusAfterPaging.current}`);
    focusAfterPaging.current = null;
  }, [anchor, focusKey]);

  const page = (direction: 1 | -1) => {
    const target = Math.max(0, Math.min(count - visible, anchor + direction * (visible - 1)));
    if (target === anchor) return;
    focusAfterPaging.current = target;
    scrollTo(target);
  };

  const first = Math.max(0, anchor - OVERSCAN);
  const last = Math.min(count, anchor + visible + OVERSCAN + 1);
  const loadingLabel = t('home.loadingTile');
  const tiles = [];
  for (let index = first; index < last; index++) {
    const item = items ? items[index] : undefined;
    const tileKey = `${focusKey}-tile-${index}`;
    if (seeAll && index === items!.length) {
      tiles.push(
        <MoreTile
          key={index}
          focusKey={tileKey}
          shape={shape}
          label={t('home.seeAll')}
          style={{ left: index * step }}
          onPress={onSeeAll}
          onFocus={() => {
            rememberFocus(focusKey, tileKey);
            if (canSlide() && index !== anchor) scrollTo(index);
          }}
        />,
      );
      continue;
    }
    tiles.push(
      <Tile
        key={index}
        focusKey={tileKey}
        item={item}
        shape={shape}
        index={index}
        loadingLabel={loadingLabel}
        left={index * step}
        onTileFocus={onTileFocus}
        onTilePress={onTilePress}
      />,
    );
  }

  return (
    <FocusContext.Provider value={focusKey}>
      <section ref={ref} className={styles.row} aria-label={title} data-row-key={focusKey}>
        <h2 className={styles.title}>
          {title}
          {tag && <span className={styles.tag}>{tag}</span>}
        </h2>
        <div className={`${styles.viewport} ${styles[shape]}`}>
          {error ? (
            <div className={styles.message}>
              <p>{error}</p>
              <Button
                focusKey={`${focusKey}-tile-0`}
                label={t('common.tryAgain')}
                onPress={onRetry}
              />
            </div>
          ) : (
            <div className={styles.track} style={{ transform: `translateX(${-anchor * step}px)` }}>
              {tiles}
            </div>
          )}
          {!error && anchor > 0 && (
            <div
              className={`${styles.arrow} ${styles.previous}`}
              role="button"
              aria-label={t('home.previous')}
              onClick={() => page(-1)}
            />
          )}
          {!error && anchor + visible < count && (
            <div
              className={`${styles.arrow} ${styles.next}`}
              role="button"
              aria-label={t('home.next')}
              onClick={() => page(1)}
            />
          )}
        </div>
      </section>
    </FocusContext.Provider>
  );
});

/** A row far from the view: same size, no tiles, nothing to focus. */
export function RowPlaceholder({ title, tag, shape }: Pick<RowProps, 'title' | 'tag' | 'shape'>) {
  return (
    <section className={styles.row} aria-hidden="true">
      <h2 className={styles.title}>
        {title}
        {tag && <span className={styles.tag}>{tag}</span>}
      </h2>
      <div className={`${styles.viewport} ${styles[shape]}`} />
    </section>
  );
}
