import { FocusContext, setFocus, useFocusable } from '@noriginmedia/norigin-spatial-navigation';
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  recallFocus,
  recallScroll,
  rememberFocus,
  rememberScroll,
} from '../navigation/focus-memory';
import { focusedKey } from '../navigation/spatial';
import { canSlide } from '../platform/input-mode';
import { tuning } from '../platform/tuning';
import type { FixtureText } from '../screens/sports/fixture';
import { Button } from './Button';
import { Pressable } from './Pressable';
import { drawnTile, nextTile } from './Row';
import rowStyles from './Row.module.css';
import styles from './FixtureRow.module.css';

/** Tile pitch and how many fit across the row, as Home's wide tiles. */
export const FIXTURE_GEOMETRY = { step: 384 + 24, visible: 4 } as const;

const OVERSCAN = tuning.overscan;

interface FixtureTileProps {
  focusKey: string;
  /** Undefined while the row is loading: a focusable placeholder. */
  fixture: FixtureText | undefined;
  index: number;
  loadingLabel: string;
  left: number;
  onTileFocus: (index: number) => void;
  onTilePress: (index: number) => void;
}

/**
 * One match, drawn as text: competition, the two sides, the local kick-off
 * or a LIVE pill, and how many sources have it. No images, so a row of them
 * costs the TV nothing to decode (docs/PLAN.md, Sports addons, Screens).
 */
const FixtureTile = memo(function FixtureTile({
  focusKey,
  fixture,
  index,
  loadingLabel,
  left,
  onTileFocus,
  onTilePress,
}: FixtureTileProps) {
  return (
    <Pressable
      focusKey={focusKey}
      label={fixture ? fixture.label : loadingLabel}
      className={fixture ? styles.tile : `${styles.tile} ${styles.loading}`}
      focusedClassName={styles.focused}
      style={{ left }}
      onFocus={() => onTileFocus(index)}
      onPress={() => onTilePress(index)}
    >
      {fixture && (
        <>
          <span className={styles.competition}>{fixture.competition}</span>
          <span className={styles.side}>{fixture.lines[0]}</span>
          {fixture.lines[1] !== undefined && (
            <span className={styles.side}>{fixture.lines[1]}</span>
          )}
          <span className={styles.footer}>
            {fixture.live ? (
              <span className={styles.live}>{fixture.when}</span>
            ) : (
              <span className={styles.when}>{fixture.when}</span>
            )}
            {fixture.sources && <span className={styles.sources}>{fixture.sources}</span>}
          </span>
        </>
      )}
    </Pressable>
  );
});

interface FixtureRowProps {
  focusKey: string;
  title: string;
  /** Muted words after the title. */
  tag?: string;
  /** Null while loading: the row shows focusable placeholders. */
  fixtures: readonly FixtureText[] | null;
  /** Shown instead of tiles, with a Try again button. */
  error?: string;
  onRetry?: () => void;
  /** Any focus in the row; the index is undefined on a placeholder or Try again. */
  onItemFocus?: (index: number | undefined, row: HTMLElement) => void;
  onItemPress: (index: number) => void;
}

/**
 * A row of fixture tiles. It moves like Home's rows: the focused tile stays
 * at the left and the row slides under it, only tiles near the view are
 * drawn, and Left and Right go by index without measuring.
 */
export const FixtureRow = memo(function FixtureRow(props: FixtureRowProps) {
  const { focusKey, title, tag, fixtures, error, onRetry, onItemFocus, onItemPress } = props;
  const { t } = useTranslation();
  const { step, visible } = FIXTURE_GEOMETRY;
  const count = fixtures ? fixtures.length : visible;
  const [scrolled, setAnchor] = useState(() => recallScroll(focusKey));
  // A row that now holds fewer matches keeps focus on a real one.
  const anchor = Math.min(scrolled, Math.max(0, count - 1));
  const first = Math.max(0, anchor - OVERSCAN);
  const last = Math.min(count, anchor + visible + OVERSCAN + 1);
  const { ref } = useFocusable<object, HTMLElement>({
    focusKey,
    saveLastFocusedChild: true,
    preferredChildFocusKey:
      drawnTile(focusKey, recallFocus(focusKey), first, last) ?? `${focusKey}-tile-${anchor}`,
    measureChildrenLayout: false,
    nextFocusResolver: nextTile,
  });

  const latest = useRef({ fixtures, scrolled, anchor, first, last, onItemFocus, onItemPress });
  useLayoutEffect(() => {
    latest.current = { fixtures, scrolled, anchor, first, last, onItemFocus, onItemPress };
  });
  const onTileFocus = useCallback(
    (index: number) => {
      const current = latest.current;
      rememberFocus(focusKey, `${focusKey}-tile-${index}`);
      if (canSlide() && index !== current.scrolled) {
        setAnchor(index);
        rememberScroll(focusKey, index);
      }
      if (ref.current) current.onItemFocus?.(current.fixtures ? index : undefined, ref.current);
    },
    [focusKey, ref],
  );
  const onTilePress = useCallback((index: number) => {
    const { fixtures: list, onItemPress: press } = latest.current;
    if (list && list[index]) press(index);
  }, []);

  // Matches can leave a row while focus is on it (one ended): focus moves to what is drawn.
  useEffect(() => {
    const prefix = `${focusKey}-tile-`;
    const focused = focusedKey();
    if (!fixtures || focused.indexOf(prefix) !== 0) return;
    const index = Number(focused.slice(prefix.length));
    const current = latest.current;
    if (index >= fixtures.length || index < current.first || index >= current.last) {
      void setFocus(`${prefix}${current.anchor}`);
    }
  }, [fixtures, focusKey]);

  const page = (direction: 1 | -1) => {
    const target = Math.max(0, Math.min(count - visible, anchor + direction * (visible - 1)));
    if (target === anchor) return;
    setAnchor(target);
    rememberScroll(focusKey, target);
    void setFocus(`${focusKey}-tile-${target}`);
  };

  const loadingLabel = t('home.loadingTile');
  const tiles = [];
  for (let index = first; index < last; index++) {
    tiles.push(
      <FixtureTile
        key={index}
        focusKey={`${focusKey}-tile-${index}`}
        fixture={fixtures ? fixtures[index] : undefined}
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
      <section ref={ref} className={rowStyles.row} aria-label={title} data-row-key={focusKey}>
        <h2 className={rowStyles.title}>
          {title}
          {tag && <span className={rowStyles.tag}>{tag}</span>}
        </h2>
        <div className={`${rowStyles.viewport} ${styles.viewport}`}>
          {error ? (
            <div className={rowStyles.message}>
              <p>{error}</p>
              <Button
                focusKey={`${focusKey}-tile-0`}
                label={t('common.tryAgain')}
                onPress={onRetry}
                onFocus={() => onTileFocus(0)}
              />
            </div>
          ) : (
            <div
              className={rowStyles.track}
              style={{ transform: `translateX(${-anchor * step}px)` }}
            >
              {tiles}
            </div>
          )}
          {!error && anchor > 0 && (
            <div
              className={`${rowStyles.arrow} ${rowStyles.previous}`}
              role="button"
              aria-label={t('home.previous')}
              onClick={() => page(-1)}
            />
          )}
          {!error && anchor + visible < count && (
            <div
              className={`${rowStyles.arrow} ${rowStyles.next}`}
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
export function FixtureRowPlaceholder({ title, tag }: { title: string; tag?: string }) {
  return (
    <section className={rowStyles.row} aria-hidden="true">
      <h2 className={rowStyles.title}>
        {title}
        {tag && <span className={rowStyles.tag}>{tag}</span>}
      </h2>
      <div className={`${rowStyles.viewport} ${styles.viewport}`} />
    </section>
  );
}
