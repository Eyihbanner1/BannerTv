import {
  type BoardRow,
  buildBoard,
  CONTINUE_LINE,
  kidsTitleAllowed,
  LIVE_SPORT_LINE,
  MY_LIST_LINE,
} from '@bannertv/core';
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
import { useRowFillMarks } from '../../app/boot-marks';
import { push } from '../../app/router';
import { useScreenFocus } from '../../app/use-screen-focus';
import { RAIL_FOCUS_KEY } from '../../components/Rail';
import { Row, RowPlaceholder } from '../../components/Row';
import { slideTrack } from '../../components/row-track';
import { addonClient, addonCollection } from '../../data/addons';
import { describeAddonError, typeLabel } from '../../data/describe';
import { homeOwnLines, useHomeBoard, useOwnLinePlaces } from '../../data/home-board';
import { library } from '../../data/library';
import { isKidsProfile } from '../../data/profiles';
import { noteFirstPage, sportsState } from '../../data/sports';
import { useQuery } from '../../data/use-query';
import { activityGap } from '../../navigation/activity';
import { focusedKey } from '../../navigation/spatial';
import { useBack } from '../../navigation/use-back';
import { canSlide, inputMode } from '../../platform/input-mode';
import { noteHomeFocused } from '../../platform/launch';
import { tuning } from '../../platform/tuning';
import { CONTINUE_FOCUS_KEY, CONTINUE_ROW_KEY, ContinueRow, useContinueItems } from './ContinueRow';
import { Hero, openDetails } from './Hero';
import { cancelHero, heroItem, showInHero } from './hero-item';
import { LIVE_SPORT_FOCUS_KEY, LIVE_SPORT_ROW_KEY, LiveSportRow } from './LiveSportRow';
import { MY_LIST_FOCUS_KEY, MY_LIST_ROW_KEY, MyListRow } from './MyListRow';
import styles from './HomeScreen.module.css';

/** Rows show the first titles of a catalog; Discover pages through the rest. */
const MAX_ROW_ITEMS = 40;
/** Rows further than this from the focused one are drawn as empty boxes and not fetched yet. */
const ROWS_AROUND = tuning.rowsAround;
/** The hero waits for focus to rest, so holding an arrow does not load every backdrop. */
const HERO_DELAY_MS = tuning.heroDelayMs;
/** Presses closer together than this count as browsing quickly... */
const BUSY_GAP_MS = 800;
/** ...and then the hero waits this long, so its picture does not land on the next press. */
const HERO_BUSY_MS = Math.max(HERO_DELAY_MS, tuning.heroBusyMs);

export const rowFocusKey = (row: BoardRow) => `home-${row.key}`;
const hasMyList = () => library.items().length > 0;

function pointedAt(): boolean {
  const key = focusedKey();
  return inputMode.get() === 'pointer' && key.indexOf('home-') === 0 && doesFocusableExist(key);
}

const emptyRows = new Set<string>();
const NO_ITEMS: readonly MetaPreview[] = [];
const NO_ROWS: readonly BoardRow[] = [];

interface HomeRowProps {
  row: BoardRow;
  first: boolean;
  near: boolean;
  /** The row's catalog came back empty; `focused` if focus was in it. */
  onEmpty: (key: string, focused: boolean) => void;
  /** The row's addon failed, or answered again after failing. */
  onFailed: (key: string, failed: boolean) => void;
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
const HomeRow = memo(function HomeRow({
  row,
  first,
  near,
  onEmpty,
  onFailed,
  onItemFocus,
}: HomeRowProps) {
  const { t } = useTranslation();
  const query = useMemo(
    // A refreshed row equal to the one shown keeps its items, so no tile draws again.
    () => addonClient.catalog(row.addon, row.type, row.catalog.id, row.extra, { keepEqual: true }),
    [row.addon, row.type, row.catalog.id, row.extra],
  );
  const state = useQuery(query, near);
  useRowFillMarks(query, state);
  const items = useMemo(() => {
    if (!state.data) return null;
    // A kids row asked its catalog for Family titles; this keeps out any that are not for children.
    const allowed = isKidsProfile()
      ? state.data.filter((item) => kidsTitleAllowed(item, true))
      : state.data;
    return allowed.slice(0, MAX_ROW_ITEMS);
  }, [state.data]);
  const empty = state.status === 'success' && items !== null && items.length === 0;
  const failed = state.status === 'error';
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
  useEffect(() => onFailed(row.key, failed), [failed, onFailed, row.key]);
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
  const ready = collection.ready && sports.ready;
  // A kids profile has no Sports, so no Live sport row either.
  const sportShown = sports.shown && !isKidsProfile();
  // The profile's rows: its order and hidden rows from Settings, or Family rows
  // for kids. Sports catalogs leave the board: the Live sport row stands in for
  // them. The board waits for sport to be settled too, so a sports catalog is
  // never drawn, or fetched, for the moment before it is known to be one.
  const arranged = useHomeBoard(collection.addons, ready, sports.homeLeaveOut);
  const board = arranged ?? NO_ROWS;
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set(emptyRows));
  const rows = useMemo(() => board.filter((row) => !hidden.has(row.key)), [board, hidden]);
  // The hero starts on the first row whose addon answered: on a new TV whose
  // first addon is down, Cinemeta's row below fills it.
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set());
  const heroIndex = rows.findIndex((row) => !failed.has(row.key));
  // Home opens on its first row: it only mounts when the section is opened,
  // and Back from a screen on top of it finds it still mounted.
  const [focusedRow, setFocusedRow] = useState<string>();
  // The row the rows area has slid to.
  const slideRow = useRef<string>(undefined);
  const trackRef = useRef<HTMLDivElement>(null);
  const slideFrame = useRef(0);

  // Continue Watching comes first when there is something to continue, unless
  // Settings > Home rows hides it. My List and Live sport sit among the rows
  // where Home rows puts them.
  const continueItems = useContinueItems();
  const continueFilled = continueItems !== null && continueItems.length > 0;
  const own = useMemo(() => homeOwnLines(sportShown, continueFilled), [sportShown, continueFilled]);
  const places = useOwnLinePlaces(collection.addons, ready, own, sports.homeLeaveOut);
  const continuing = continueFilled && places.has(CONTINUE_LINE);
  // Each own line's place among the rows drawn: rows found empty are not counted.
  const placeOf = (id: string) => {
    const place = places.get(id);
    if (place === undefined) return -1;
    let at = 0;
    for (let index = 0; index < place && index < board.length; index++) {
      if (!hidden.has(board[index]!.key)) at += 1;
    }
    return at;
  };
  const myListAt = placeOf(MY_LIST_LINE);
  // My List leads Home when nothing comes before it and it has titles.
  const myListFilled = useSyncExternalStore(library.subscribe, hasMyList);
  const myListFirst = !continuing && myListFilled && myListAt === 0;
  const firstRowKey = continuing
    ? CONTINUE_FOCUS_KEY
    : myListFirst
      ? MY_LIST_FOCUS_KEY
      : rows.length > 0
        ? rowFocusKey(rows[0]!)
        : undefined;
  // The Live sport row sits before the catalog row at this index, while sport is installed.
  const liveAt = sportShown ? placeOf(LIVE_SPORT_LINE) : -1;
  const focusedIndex =
    focusedRow === LIVE_SPORT_ROW_KEY
      ? liveAt
      : focusedRow === MY_LIST_ROW_KEY
        ? myListAt
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
  // A tile the pointer moved onto while Home waited for that keeps focus.
  // With no rows at all, the rail takes focus, so the remote still works.
  const focusReady = ready && arranged !== null && continueItems !== null;
  useScreenFocus(firstRowKey ?? RAIL_FOCUS_KEY, focusReady, true, pointedAt, noteHomeFocused);

  // The hero starts on the first title focus will land on.
  useEffect(() => {
    if (continuing && heroItem.get() === null) heroItem.set(continueItems[0]!.preview);
  }, [continuing, continueItems]);

  // On Home, Back first returns to the first row. Only from there does it exit.
  // Genre rows share the first row's key as a prefix, so match its tiles exactly.
  // Before Home's first focus, Back stays in the app and focus lands as it would
  // have, not on a row Continue Watching is about to come above. That includes
  // while the profile's rows are still being read and none is drawn yet.
  useBack('screen', () => {
    const first = rows[0];
    if (!focusReady) return true;
    if (!firstRowKey || focusedKey().indexOf(`${firstRowKey}-tile-`) === 0) {
      return false;
    }
    // From far down, the first row is an empty box with nothing to focus: draw it first.
    if (first && !doesFocusableExist(firstRowKey)) {
      flushSync(() => setFocusedRow(myListFirst ? MY_LIST_ROW_KEY : first.key));
    }
    void setFocus(firstRowKey);
    return true;
  });

  // The focused row moves to the top of the rows area. This re-applies it after
  // rows above it disappear or Continue Watching comes or goes, and on return,
  // so Home comes back as it was. A first focus on a row still loading has not
  // slid anything yet, so the row holding focus counts first.
  const drawnRows = useRef(rows);
  useLayoutEffect(() => {
    const before = drawnRows.current;
    drawnRows.current = rows;
    const onHome = (rowKey: string) =>
      rowKey === LIVE_SPORT_ROW_KEY ||
      rowKey === MY_LIST_ROW_KEY ||
      (rowKey === CONTINUE_ROW_KEY && continuing) ||
      rows.some((row) => row.key === rowKey);
    // The row now in the place of one that has left, as for an empty row.
    const inPlaceOf = (rowKey: string) => {
      const index = before.findIndex((row) => row.key === rowKey);
      if (index === -1) return undefined;
      return (
        rows[Math.min(index, rows.length - 1)]?.key ?? (continuing ? CONTINUE_ROW_KEY : undefined)
      );
    };
    const key = focusedKey();
    const tile = key.indexOf('home-') === 0 ? key.lastIndexOf('-tile-') : -1;
    const focused = tile > 0 ? key.slice('home-'.length, tile) : undefined;
    if (focused !== undefined && onHome(focused)) {
      if (canSlide()) slideRow.current = focused;
    } else if (focused !== undefined && !emptyRows.has(focused)) {
      // The row left the board under focus, once its first page showed it is
      // sport. Before its tiles unregister, while focus is still on one of them.
      // (A row that turned out empty has handed its place on already.)
      const next = inPlaceOf(focused);
      if (next) {
        slideRow.current = next;
        setFocusedRow(next);
        void setFocus(`home-${next}`);
      }
    }
    // The same for the row the view was on while focus was elsewhere, in the rail.
    if (slideRow.current && !onHome(slideRow.current)) {
      slideRow.current = inPlaceOf(slideRow.current);
    }
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
  // Home's own lines drawn before the first catalog row, in order.
  const ownFirst: string[] = [];
  for (const id of places.keys()) {
    if (placeOf(id) !== 0) continue;
    if (id === MY_LIST_LINE) ownFirst.push(MY_LIST_FOCUS_KEY);
    if (id === LIVE_SPORT_LINE && sportShown) ownFirst.push(LIVE_SPORT_FOCUS_KEY);
  }
  const latestOwnFirst = useRef(ownFirst);
  useLayoutEffect(() => {
    latestRows.current = rows;
    latestContinuing.current = continuing;
    latestOwnFirst.current = ownFirst;
  });

  // Where focus goes when the last title is taken off Continue Watching: the
  // line under it, which may be My List or Live sport when either shows.
  const focusAfterContinue = useCallback(() => {
    const own = latestOwnFirst.current.find((key) => doesFocusableExist(key));
    if (own) return own;
    const first = latestRows.current[0];
    return first ? rowFocusKey(first) : RAIL_FOCUS_KEY;
  }, []);

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

  const onFailed = useCallback((key: string, now: boolean) => {
    setFailed((keys) => {
      if (keys.has(key) === now) return keys;
      const next = new Set(keys);
      if (now) next.add(key);
      else next.delete(key);
      return next;
    });
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

  // The Live sport row comes and goes by itself, as matches start and end. When
  // nothing is live any more, focus in it moves to the row that takes its place,
  // as for an empty catalog row. Either way the rows under it have moved, so the
  // view goes back to the row it was on.
  const latestLiveAt = useRef(liveAt);
  const latestMyListAt = useRef(myListAt);
  useLayoutEffect(() => {
    latestLiveAt.current = liveAt;
    latestMyListAt.current = myListAt;
  });
  const onLiveShown = useCallback((shown: boolean, focused: boolean) => {
    if (!shown) {
      const list = latestRows.current;
      const at = latestLiveAt.current;
      const next =
        list[at]?.key ??
        list[at - 1]?.key ??
        (latestContinuing.current ? CONTINUE_ROW_KEY : undefined);
      if (slideRow.current === LIVE_SPORT_ROW_KEY) slideRow.current = next;
      setFocusedRow((row) => (row === LIVE_SPORT_ROW_KEY ? next : row));
      if (focused && next) void setFocus(`home-${next}`);
    }
    slideTrack(trackRef.current, slideRow.current && `home-${slideRow.current}`);
  }, []);
  // The same for My List, which goes when its last title is taken off.
  const onMyListShown = useCallback((shown: boolean, focused: boolean) => {
    if (!shown) {
      const list = latestRows.current;
      const at = latestMyListAt.current;
      const next =
        list[at]?.key ??
        list[at - 1]?.key ??
        (latestContinuing.current ? CONTINUE_ROW_KEY : undefined);
      if (slideRow.current === MY_LIST_ROW_KEY) slideRow.current = next;
      setFocusedRow((row) => (row === MY_LIST_ROW_KEY ? next : row));
      if (focused && next) void setFocus(`home-${next}`);
    }
    slideTrack(trackRef.current, slideRow.current && `home-${slideRow.current}`);
  }, []);

  if (ready && arranged !== null && rows.length === 0 && !continuing) {
    // Rows can be missing because the profile hid them all, because no catalog
    // has family titles for a kids profile, or because the addons only list
    // sport, which has its own screen, as well as for want of addons.
    const allHidden =
      board.length === 0 && buildBoard(collection.addons, sports.homeLeaveOut).length > 0;
    const [title, lead] = isKidsProfile()
      ? ['home.noAddons', 'home.noKidsRowsLead']
      : allHidden
        ? ['home.noAddons', 'home.allHiddenLead']
        : sportShown
          ? ['home.sportsOnly', 'home.sportsOnlyLead']
          : ['home.noAddons', 'home.noAddonsLead'];
    return (
      <div className={styles.home}>
        <div className={styles.empty}>
          <h1 className={styles.emptyTitle}>{t(title)}</h1>
          <p className={styles.emptyLead}>{t(lead)}</p>
        </div>
      </div>
    );
  }

  // One flat, keyed list, so Live sport or My List moving never remounts a catalog row.
  const catalogRows: ReactElement[] = [];
  const isNear = (at: number) =>
    Math.abs(at - focusedIndex) <= 1 || Math.abs(at - nearIndex) <= ROWS_AROUND;
  // Home's own lines, each before the catalog row at its index, in Home rows order.
  const ownRows: Array<{ at: number; row: ReactElement }> = [];
  for (const id of places.keys()) {
    if (id === LIVE_SPORT_LINE && liveAt >= 0) {
      ownRows.push({
        at: liveAt,
        row: (
          <LiveSportRow
            key={LIVE_SPORT_ROW_KEY}
            near={isNear(liveAt)}
            onItemFocus={onItemFocus}
            onShown={onLiveShown}
          />
        ),
      });
    } else if (id === MY_LIST_LINE && myListAt >= 0) {
      ownRows.push({
        at: myListAt,
        row: (
          <MyListRow
            key={MY_LIST_ROW_KEY}
            first={continueItems !== null && myListFirst}
            near={isNear(myListAt)}
            onItemFocus={onItemFocus}
            onShown={onMyListShown}
          />
        ),
      });
    }
  }
  const pushOwn = (index: number) => {
    for (const own of ownRows) if (own.at === index) catalogRows.push(own.row);
  };
  rows.forEach((row, index) => {
    pushOwn(index);
    catalogRows.push(
      <HomeRow
        key={row.key}
        row={row}
        first={continueItems !== null && !continuing && !myListFirst && index === heroIndex}
        near={Math.abs(index - focusedIndex) <= 1 || Math.abs(index - nearIndex) <= ROWS_AROUND}
        onEmpty={onEmpty}
        onFailed={onFailed}
        onItemFocus={onItemFocus}
      />,
    );
  });
  pushOwn(rows.length);

  return (
    <div className={styles.home}>
      <Hero />
      <div className={styles.rows}>
        <div ref={trackRef} className={styles.track}>
          {continuing && (
            <ContinueRow
              items={continueItems}
              onItemFocus={onItemFocus}
              focusAfterRow={focusAfterContinue}
            />
          )}
          {catalogRows}
        </div>
      </div>
    </div>
  );
}
