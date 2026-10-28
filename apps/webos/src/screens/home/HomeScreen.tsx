import { type BoardRow, buildBoard } from '@bannertv/core';
import type { MetaPreview } from '@bannertv/protocol';
import { doesFocusableExist, setFocus } from '@noriginmedia/norigin-spatial-navigation';
import {
  memo,
  type ReactElement,
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { flushSync } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { push } from '../../app/router';
import { useScreenFocus } from '../../app/use-screen-focus';
import { Row, RowPlaceholder } from '../../components/Row';
import { slideTrack } from '../../components/row-track';
import { addonClient, addonCollection } from '../../data/addons';
import { describeAddonError, typeLabel } from '../../data/describe';
import { noteFirstPage, sportsState } from '../../data/sports';
import { useQuery } from '../../data/use-query';
import { activityGap } from '../../navigation/activity';
import { focusedKey } from '../../navigation/spatial';
import { useBack } from '../../navigation/use-back';
import { canSlide } from '../../platform/input-mode';
import { tuning } from '../../platform/tuning';
import { CONTINUE_FOCUS_KEY, CONTINUE_ROW_KEY, ContinueRow, useContinueItems } from './ContinueRow';
import { Hero, openDetails } from './Hero';
import { cancelHero, heroItem, showInHero } from './hero-item';
import { LIVE_SPORT_ROW_KEY, LiveSportRow } from './LiveSportRow';
import styles from './HomeScreen.module.css';

/** Rows show the first titles of a catalog; Discover pages through the rest. */
const MAX_ROW_ITEMS = 40;
/** The Live sport row is the third row on Home, counting Continue Watching. */
const LIVE_SPORT_PLACE = 2;
/** Rows further than this from the focused one are drawn as empty boxes and not fetched yet. */
const ROWS_AROUND = tuning.rowsAround;
/** The hero waits for focus to rest, so holding an arrow does not load every backdrop. */
const HERO_DELAY_MS = tuning.heroDelayMs;
/** Presses closer together than this count as browsing quickly... */
const BUSY_GAP_MS = 800;
/** ...and then the hero waits this long, so its picture does not land on the next press. */
const HERO_BUSY_MS = Math.max(HERO_DELAY_MS, tuning.heroBusyMs);

export const rowFocusKey = (row: BoardRow) => `home-${row.key}`;

const emptyRows = new Set<string>();
const NO_ITEMS: readonly MetaPreview[] = [];

interface HomeRowProps {
  row: BoardRow;
  first: boolean;
  near: boolean;
  /** The row's catalog came back empty; `focused` if focus was in it. */
  onEmpty: (key: string, focused: boolean) => void;
  onItemFocus: (rowKey: string, item: MetaPreview | undefined, element: HTMLElement) => void;
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
    (item: MetaPreview | undefined, element: HTMLElement) => onItemFocus(row.key, item, element),
    [row.key, onItemFocus],
  );
  const onSeeAll = useCallback(() => openCatalog(row), [row]);

  // Before the row's tiles unregister, while focus is still on one of them.
  useLayoutEffect(() => {
    if (!empty) return;
    onEmpty(row.key, focusedKey().indexOf(`${rowFocusKey(row)}-tile-`) === 0);
  }, [empty, onEmpty, row]);
  useEffect(() => {
    if (first && items && items.length > 0 && heroItem.get() === null) heroItem.set(items[0]!);
  }, [first, items]);
  // What a first page looked like settles whether a catalog is sport (data/sports.ts).
  useEffect(() => {
    if (state.data && row.extra.length === 0) noteFirstPage(row.addon, row.catalog, state.data);
  }, [state.data, row]);

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
  const sports = useSyncExternalStore(sportsState.subscribe, sportsState.get);
  // Sports catalogs leave the board: the Live sport row stands in for them.
  const board = useMemo(
    () => buildBoard(collection.addons, sports.homeLeaveOut),
    [collection.addons, sports.homeLeaveOut],
  );
  const ready = collection.ready && sports.ready;
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set(emptyRows));
  const rows = useMemo(() => board.filter((row) => !hidden.has(row.key)), [board, hidden]);
  // Home opens on its first row: it only mounts when the section is opened,
  // and Back from a screen on top of it finds it still mounted.
  const [focusedRow, setFocusedRow] = useState<string>();
  // The row the rows area has slid to.
  const slideRow = useRef<string>(undefined);
  const trackRef = useRef<HTMLDivElement>(null);
  const slideFrame = useRef(0);

  // Continue Watching comes first when there is something to continue.
  const continueItems = useContinueItems();
  const continuing = continueItems !== null && continueItems.length > 0;
  const firstRowKey = continuing
    ? CONTINUE_FOCUS_KEY
    : rows.length > 0
      ? rowFocusKey(rows[0]!)
      : undefined;
  // The Live sport row sits before the catalog row at this index, while sport is installed.
  const liveAt = sports.shown
    ? Math.max(0, Math.min(LIVE_SPORT_PLACE - (continuing ? 1 : 0), rows.length))
    : -1;
  const focusedIndex =
    focusedRow === LIVE_SPORT_ROW_KEY
      ? liveAt
      : Math.max(
          0,
          rows.findIndex((row) => row.key === focusedRow),
        );
  // Rows coming into the drawn window mount after the focus move has painted,
  // in a render React can interrupt, so a press rarely waits on a new row. The
  // rows next to focus are drawn at once, so the next press has a row to go to.
  const nearIndex = useDeferredValue(focusedIndex);

  // Saved progress is read first, so the first focus lands on Continue Watching.
  // A title can leave the row while the player is on top, so focus falls back.
  useScreenFocus(firstRowKey, ready && continueItems !== null, true);

  // The hero starts on the first title focus will land on.
  useEffect(() => {
    if (continuing && heroItem.get() === null) heroItem.set(continueItems[0]!.preview);
  }, [continuing, continueItems]);

  // On Home, Back first returns to the first row. Only from there does it exit.
  // Genre rows share the first row's key as a prefix, so match its tiles exactly.
  useBack('screen', () => {
    const first = rows[0];
    if (!firstRowKey || focusedKey().indexOf(`${firstRowKey}-tile-`) === 0) {
      return false;
    }
    // From far down, the first row is an empty box with nothing to focus: draw it first.
    if (first && !doesFocusableExist(firstRowKey)) flushSync(() => setFocusedRow(first.key));
    void setFocus(firstRowKey);
    return true;
  });

  // The focused row moves to the top of the rows area. This re-applies it after
  // rows above it disappear or Continue Watching comes or goes, and on return,
  // so Home comes back as it was. A first focus on a row still loading has not
  // slid anything yet, so the row holding focus counts first.
  useLayoutEffect(() => {
    const key = focusedKey();
    const tile = key.indexOf('home-') === 0 ? key.lastIndexOf('-tile-') : -1;
    if (tile > 0 && canSlide()) slideRow.current = key.slice('home-'.length, tile);
    slideTrack(trackRef.current, slideRow.current && `home-${slideRow.current}`);
  }, [rows, continuing]);

  useEffect(
    () => () => {
      cancelHero();
      cancelAnimationFrame(slideFrame.current);
    },
    [],
  );

  const latestRows = useRef(rows);
  const latestContinuing = useRef(continuing);
  useLayoutEffect(() => {
    latestRows.current = rows;
    latestContinuing.current = continuing;
  });

  // A row that turns out empty hands its place to the row below (or above, at
  // the end, which is Continue Watching above the first catalog row): the view
  // and the drawn rows follow, and so does focus if it was in the row, rather
  // than falling to the hero.
  const onEmpty = useCallback((key: string, focused: boolean) => {
    emptyRows.add(key);
    setHidden(new Set(emptyRows));
    const list = latestRows.current;
    const index = list.findIndex((row) => row.key === key);
    const next =
      index < 0
        ? undefined
        : (list[index + 1]?.key ??
          list[index - 1]?.key ??
          (latestContinuing.current ? CONTINUE_ROW_KEY : undefined));
    if (!next) return;
    if (slideRow.current === key) slideRow.current = next;
    setFocusedRow((row) => (row === key ? next : row));
    if (focused) void setFocus(`home-${next}`);
  }, []);

  // Rows that are loading or failed report focus too, so the rows under them
  // are drawn and Down has somewhere to go. Only titles change the hero.
  const onItemFocus = useCallback((rowKey: string, item: MetaPreview | undefined) => {
    setFocusedRow(rowKey);
    // Reading the row's position forces a layout, so only slide when the row
    // changes, and in the next frame, which lays out anyway, not in the key press.
    if (canSlide() && slideRow.current !== rowKey) {
      slideRow.current = rowKey;
      cancelAnimationFrame(slideFrame.current);
      // Read when it runs: a row that turned out empty meanwhile has handed its place on.
      slideFrame.current = requestAnimationFrame(() =>
        slideTrack(trackRef.current, slideRow.current && `home-${slideRow.current}`),
      );
    }
    // Paced by the presses, not by focus reports: a row that loads or empties
    // under focus reports again without a press.
    showInHero(item, activityGap() < BUSY_GAP_MS ? HERO_BUSY_MS : HERO_DELAY_MS);
  }, []);

  // Nothing is live any more: the Live sport row goes, and focus in it moves
  // to the row that takes its place, as for an empty catalog row.
  const latestLiveAt = useRef(liveAt);
  useLayoutEffect(() => {
    latestLiveAt.current = liveAt;
  });
  const onLiveGone = useCallback((focused: boolean) => {
    const list = latestRows.current;
    const at = latestLiveAt.current;
    const next =
      list[at]?.key ??
      list[at - 1]?.key ??
      (latestContinuing.current ? CONTINUE_ROW_KEY : undefined);
    if (slideRow.current === LIVE_SPORT_ROW_KEY) slideRow.current = next;
    setFocusedRow((row) => (row === LIVE_SPORT_ROW_KEY ? next : row));
    if (focused && next) void setFocus(`home-${next}`);
  }, []);

  if (ready && rows.length === 0 && !continuing) {
    // Addons with sport only: their catalogs are all on the Sports screen.
    return (
      <div className={styles.home}>
        <div className={styles.empty}>
          <h1 className={styles.emptyTitle}>
            {t(sports.shown ? 'home.sportsOnly' : 'home.noAddons')}
          </h1>
          <p className={styles.emptyLead}>
            {t(sports.shown ? 'home.sportsOnlyLead' : 'home.noAddonsLead')}
          </p>
        </div>
      </div>
    );
  }

  // One flat, keyed list, so the Live sport row moving never remounts a catalog row.
  const catalogRows: ReactElement[] = [];
  const liveRow = (
    <LiveSportRow
      key={LIVE_SPORT_ROW_KEY}
      near={Math.abs(liveAt - focusedIndex) <= 1 || Math.abs(liveAt - nearIndex) <= ROWS_AROUND}
      onItemFocus={onItemFocus}
      onGone={onLiveGone}
    />
  );
  rows.forEach((row, index) => {
    if (index === liveAt) catalogRows.push(liveRow);
    catalogRows.push(
      <HomeRow
        key={row.key}
        row={row}
        first={continueItems !== null && !continuing && index === 0}
        near={Math.abs(index - focusedIndex) <= 1 || Math.abs(index - nearIndex) <= ROWS_AROUND}
        onEmpty={onEmpty}
        onItemFocus={onItemFocus}
      />,
    );
  });
  if (liveAt === rows.length) catalogRows.push(liveRow);

  return (
    <div className={styles.home}>
      <Hero />
      <div className={styles.rows}>
        <div ref={trackRef} className={styles.track}>
          {continuing && <ContinueRow items={continueItems} onItemFocus={onItemFocus} />}
          {catalogRows}
        </div>
      </div>
    </div>
  );
}
