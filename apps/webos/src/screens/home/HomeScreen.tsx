import { type BoardRow, buildBoard } from '@bannertv/core';
import type { MetaPreview } from '@bannertv/protocol';
import { getCurrentFocusKey, setFocus } from '@noriginmedia/norigin-spatial-navigation';
import {
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { useTranslation } from 'react-i18next';
import { push } from '../../app/router';
import { useScreenFocus } from '../../app/use-screen-focus';
import { Row, RowPlaceholder } from '../../components/Row';
import { slideTrack } from '../../components/row-track';
import { addonClient, addonCollection } from '../../data/addons';
import { describeAddonError, typeLabel } from '../../data/describe';
import { useQuery } from '../../data/use-query';
import { useBack } from '../../navigation/use-back';
import { canSlide } from '../../platform/input-mode';
import { Hero, openDetails } from './Hero';
import { heroItem } from './hero-item';
import styles from './HomeScreen.module.css';

/** Rows show the first titles of a catalog; Discover pages through the rest. */
const MAX_ROW_ITEMS = 40;
/** Rows this far from the focused one are drawn as empty boxes and not fetched yet. */
const ROWS_AROUND = 2;
/** The hero waits for focus to rest, so holding an arrow does not load every backdrop. */
const HERO_DELAY_MS = 250;

export const rowFocusKey = (row: BoardRow) => `home-${row.key}`;

// Kept across visits to Home in this session, so Back lands as it was left.
const memory = { row: undefined as string | undefined, slideRow: undefined as string | undefined };
const emptyRows = new Set<string>();
const NO_ITEMS: readonly MetaPreview[] = [];

interface HomeRowProps {
  row: BoardRow;
  first: boolean;
  near: boolean;
  onEmpty: (key: string) => void;
  onItemFocus: (row: BoardRow, item: MetaPreview, element: HTMLElement) => void;
}

function openCatalog(row: BoardRow): void {
  const genre = row.extra.find(([name]) => name === 'genre');
  push({
    name: 'catalog',
    transportUrl: row.addon.transportUrl,
    type: row.type,
    catalogId: row.catalog.id,
    genre: genre ? genre[1] : undefined,
  });
}

// Memoised with stable handlers: moving between rows redraws only the rows
// that come into or leave the drawn window, not every row on Home.
const HomeRow = memo(function HomeRow({ row, first, near, onEmpty, onItemFocus }: HomeRowProps) {
  const { t } = useTranslation();
  const query = useMemo(
    () => addonClient.catalog(row.addon, row.type, row.catalog.id, row.extra),
    [row.addon, row.type, row.catalog.id, row.extra],
  );
  const state = useQuery(query, near);
  const items = useMemo(
    () => (state.data ? state.data.slice(0, MAX_ROW_ITEMS) : null),
    [state.data],
  );
  const empty = state.status === 'success' && items !== null && items.length === 0;
  const onRetry = useCallback(() => query.retry(), [query]);
  const onRowItemFocus = useCallback(
    (item: MetaPreview, element: HTMLElement) => onItemFocus(row, item, element),
    [row, onItemFocus],
  );
  const onSeeAll = useCallback(() => openCatalog(row), [row]);

  useEffect(() => {
    if (empty) onEmpty(row.key);
  }, [empty, onEmpty, row.key]);
  useEffect(() => {
    if (first && items && items.length > 0 && heroItem.get() === null) heroItem.set(items[0]!);
  }, [first, items]);

  const title = row.name;
  const tag = typeLabel(t, row.type);
  if (empty) return null;
  if (!near) return <RowPlaceholder title={title} tag={tag} shape={row.style} />;
  return (
    <Row
      focusKey={rowFocusKey(row)}
      title={title}
      tag={tag}
      shape={row.style}
      items={state.status === 'error' ? NO_ITEMS : items}
      error={
        state.status === 'error'
          ? describeAddonError(t, state.error, row.addon.manifest.name)
          : undefined
      }
      onRetry={onRetry}
      onItemFocus={onRowItemFocus}
      onItemPress={openDetails}
      onSeeAll={onSeeAll}
    />
  );
});

export function HomeScreen() {
  const { t } = useTranslation();
  const collection = useSyncExternalStore(addonCollection.subscribe, addonCollection.get);
  const board = useMemo(() => buildBoard(collection.addons), [collection.addons]);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set(emptyRows));
  const rows = useMemo(() => board.filter((row) => !hidden.has(row.key)), [board, hidden]);
  const [focusedRow, setFocusedRow] = useState(memory.row);
  const trackRef = useRef<HTMLDivElement>(null);
  const heroTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const firstRowKey = rows.length > 0 ? rowFocusKey(rows[0]!) : undefined;
  const focusedIndex = Math.max(
    0,
    rows.findIndex((row) => row.key === focusedRow),
  );
  // Rows coming into the drawn window mount after the focus move has painted,
  // in a render React can interrupt, so a press never waits on a new row.
  const nearIndex = useDeferredValue(focusedIndex);

  useScreenFocus(firstRowKey, collection.ready);

  // On Home, Back first returns to the first row. Only from there does it exit.
  useBack('screen', () => {
    if (!firstRowKey || getCurrentFocusKey().indexOf(`${firstRowKey}-`) === 0) return false;
    void setFocus(firstRowKey);
    return true;
  });

  // The focused row moves to the top of the rows area. This re-applies it after
  // rows above it disappear, and on return, so Home comes back as it was.
  useLayoutEffect(
    () => slideTrack(trackRef.current, memory.slideRow && `home-${memory.slideRow}`),
    [rows],
  );

  useEffect(() => () => clearTimeout(heroTimer.current), []);

  const onEmpty = useCallback((key: string) => {
    emptyRows.add(key);
    setHidden(new Set(emptyRows));
  }, []);

  const onItemFocus = useCallback((row: BoardRow, item: MetaPreview) => {
    memory.row = row.key;
    setFocusedRow(row.key);
    // Reading the row's position forces a layout, so only slide when the row changes.
    if (canSlide() && memory.slideRow !== row.key) {
      memory.slideRow = row.key;
      slideTrack(trackRef.current, rowFocusKey(row));
    }
    clearTimeout(heroTimer.current);
    heroTimer.current = setTimeout(() => heroItem.set(item), HERO_DELAY_MS);
  }, []);

  if (collection.ready && rows.length === 0) {
    return (
      <div className={styles.home}>
        <div className={styles.empty}>
          <h1 className={styles.emptyTitle}>{t('home.noAddons')}</h1>
          <p className={styles.emptyLead}>{t('home.noAddonsLead')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.home}>
      <Hero />
      <div className={styles.rows}>
        <div ref={trackRef} className={styles.track}>
          {rows.map((row, index) => (
            <HomeRow
              key={row.key}
              row={row}
              first={index === 0}
              near={Math.abs(index - nearIndex) <= ROWS_AROUND}
              onEmpty={onEmpty}
              onItemFocus={onItemFocus}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
