import {
  type BoardRow,
  buildBoard,
  CONTINUE_LINE,
  kidsTitleAllowed,
  type ContinueItem,
  libraryPreview,
  LIVE_SPORT_LINE,
  MY_LIST_LINE,
} from '@bannertv/core';
import type { MetaPreview } from '@bannertv/protocol';
import { addonClient, addonCollection } from '@tv/data/addons';
import { describeAddonError, typeLabel } from '@tv/data/describe';
import { useHomeBoard, useOwnLinePlaces } from '@tv/data/home-board';
import { library } from '@tv/data/library';
import { leaveContinueWatching } from '@tv/data/marks';
import { activeProfile, isKidsProfile } from '@tv/data/profiles';
import { noteFirstPage, sportsFeed, sportsState } from '@tv/data/sports';
import { useQuery } from '@tv/data/use-query';
import { memo, useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { phoneOwnLines } from '../data/home-lines';
import { syncForRefresh } from '../data/refresh';
import { useContinueItems } from '../data/use-continue';
import { LiveSportRow } from './sports/LiveSportRow';
import { useSportsShown } from './sports/use-sports';
import { openBrowse, openCatalog, openPlayer, openTitle } from '../nav/routes';
import { Avatar } from '../ui/Avatar';
import { Button } from '../ui/Button';
import { Hero } from '../ui/Hero';
import { OutlineIcon } from '../ui/icons';
import { Message } from '../ui/Message';
import { PrismMark } from '../ui/PrismMark';
import { Row, type RowItem } from '../ui/Row';
import { Sheet, SheetOption } from '../ui/Sheet';
import { colors, gutter, space, touch, type } from '../ui/theme';
import { usePullRefresh } from '../ui/use-pull-refresh';
import { router } from 'expo-router';

const MAX_ROW_ITEMS = 40;
/** Rows load this many rows ahead of the last one on screen. */
const LOAD_AHEAD = 3;
/** Rows found empty this run; they stay off Home until the app starts again. */
const emptyRows = new Set<string>();
const NO_CONTINUE: readonly ContinueItem[] = [];

function playContinue(item: ContinueItem): void {
  const preview = item.preview;
  if (isKidsProfile()) {
    openTitle(preview);
    return;
  }
  openPlayer({
    type: preview.type,
    metaId: preview.id,
    videoId: item.videoId,
    preview,
    startAt: item.startAt,
  });
}

function continueNote(t: ReturnType<typeof useTranslation>['t'], item: ContinueItem) {
  if (item.season !== undefined && item.episode !== undefined) {
    const numbers = { season: item.season, episode: item.episode };
    if (item.newEpisode) return t('browsing.newEpisodeNote', numbers);
    return t(item.upNext ? 'home.nextEpisodeNote' : 'home.episodeNote', numbers);
  }
  if (item.newEpisode) return t('browsing.newNote');
  return item.upNext ? t('home.nextNote') : undefined;
}

const HomeRow = memo(function HomeRow({
  row,
  enabled,
  onFirst,
  onEmpty,
  onFailed,
}: {
  row: BoardRow;
  enabled: boolean;
  onFirst: (key: string, item: MetaPreview) => void;
  onEmpty: (key: string) => void;
  onFailed: (key: string, failed: boolean) => void;
}) {
  const { t } = useTranslation();
  const query = useMemo(
    // A refreshed row equal to the one shown keeps its items, so no tile draws again.
    () => addonClient.catalog(row.addon, row.type, row.catalog.id, row.extra, { keepEqual: true }),
    [row.addon, row.type, row.catalog.id, row.extra],
  );
  const state = useQuery(query, enabled);
  const items = useMemo(() => {
    if (!state.data) return null;
    const shown = isKidsProfile()
      ? state.data.filter((item) => kidsTitleAllowed(item, true))
      : state.data;
    return shown.slice(0, MAX_ROW_ITEMS);
  }, [state.data]);
  const failed = state.status === 'error';

  useEffect(() => {
    if (state.data && row.extra.length === 0) noteFirstPage(row.addon, row.catalog, state.data);
  }, [state.data, row]);
  useEffect(() => {
    if (state.status === 'success' && items?.length === 0) onEmpty(row.key);
  }, [state.status, items, onEmpty, row.key]);
  useEffect(() => {
    if (items?.[0]) onFirst(row.key, items[0]);
  }, [items, onFirst, row.key]);
  useEffect(() => onFailed(row.key, failed), [failed, onFailed, row.key]);

  const rowItems = useMemo<RowItem[] | null>(
    () => items?.map((item, index) => ({ item, key: `${index}:${item.id}` })) ?? null,
    [items],
  );
  const genre = row.extra.find(([name]) => name === 'genre')?.[1];
  return (
    <Row
      title={row.name}
      tag={typeLabel(t, row.type)}
      items={rowItems}
      shape={row.style}
      onPress={(entry) => openTitle(entry.item)}
      seeAllLabel={t('home.seeAll')}
      {...(items && items.length > 0 && !failed
        ? {
            onSeeAll: () =>
              openCatalog({
                transportUrl: row.addon.transportUrl,
                type: row.type,
                catalogId: row.catalog.id,
                ...(genre ? { genre } : {}),
                title: row.name,
              }),
          }
        : {})}
      footer={
        failed ? (
          <View style={styles.rowError}>
            <Text style={styles.rowErrorText}>
              {describeAddonError(t, state.error, row.addon.manifest.name)}
            </Text>
            <Button label={t('common.tryAgain')} onPress={() => query.retry()} />
          </View>
        ) : undefined
      }
    />
  );
});

/** One line of Home's list: an addon's row, or Live sport or My List where Home rows puts them. */
type HomeListLine =
  | { key: string; kind: 'row'; row: BoardRow }
  | { key: string; kind: 'live' }
  | { key: string; kind: 'my-list' };

/**
 * Home's My List row: the profile's list, newest first. It asks no addon for anything. Memoised,
 * as Live sport is: FlatList draws every cell again each time Home renders, and this row takes no
 * props, so it draws again only when the list changes.
 */
const MyListRow = memo(function MyListRow() {
  const { t } = useTranslation();
  const list = useSyncExternalStore(library.subscribe, library.items);
  const items = useMemo(
    () =>
      list.slice(0, MAX_ROW_ITEMS).map((entry) => ({ item: libraryPreview(entry), key: entry.id })),
    [list],
  );
  if (items.length === 0) return null;
  return (
    <Row
      title={t('library.myList')}
      shape="poster"
      items={items}
      onPress={(entry) => openTitle(entry.item)}
      seeAllLabel={t('home.seeAll')}
      onSeeAll={() => router.navigate('/library')}
    />
  );
});

export function HomeScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const collection = useSyncExternalStore(addonCollection.subscribe, addonCollection.get);
  const sports = useSyncExternalStore(sportsState.subscribe, sportsState.get);
  const ready = collection.ready && sports.ready;
  // Sports catalogs leave the board, as on the TV: the Live sport row stands in for them. The
  // board waits for sport to be settled, so a sports catalog is never drawn for a moment.
  const board = useHomeBoard(collection.addons, ready, sports.homeLeaveOut);
  const continueItems = useContinueItems();
  // Continue Watching, My List and Live sport sit where Settings > Home rows puts them.
  const sportShown = useSportsShown();
  const own = useMemo(() => phoneOwnLines(sportShown), [sportShown]);
  const places = useOwnLinePlaces(collection.addons, ready, own, sports.homeLeaveOut);
  const continueShown = places.has(CONTINUE_LINE);
  // The Continue Watching title long-pressed, while its sheet shows.
  const [held, setHeld] = useState<MetaPreview | null>(null);
  useSyncExternalStore(library.subscribe, library.version);
  const [empty, setEmpty] = useState<ReadonlySet<string>>(() => new Set(emptyRows));
  const [firsts, setFirsts] = useState<Readonly<Record<string, MetaPreview>>>({});
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set());
  const [loadUpTo, setLoadUpTo] = useState(LOAD_AHEAD);

  const onEmpty = useCallback((key: string) => {
    emptyRows.add(key);
    setEmpty((before) => (before.has(key) ? before : new Set(before).add(key)));
  }, []);
  const onFirst = useCallback((key: string, item: MetaPreview) => {
    setFirsts((before) => (before[key] === item ? before : { ...before, [key]: item }));
  }, []);
  const onFailed = useCallback((key: string, isFailed: boolean) => {
    setFailed((before) => {
      if (before.has(key) === isFailed) return before;
      const next = new Set(before);
      if (isFailed) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);

  const rows = useMemo(() => (board ?? []).filter((row) => !empty.has(row.key)), [board, empty]);
  const lines = useMemo(() => {
    const list: HomeListLine[] = [];
    const own: Array<{ at: number; line: HomeListLine }> = [];
    for (const [id, place] of places) {
      if (id !== LIVE_SPORT_LINE && id !== MY_LIST_LINE) continue;
      // Rows found empty are not counted.
      const at = (board ?? []).slice(0, place).filter((row) => !empty.has(row.key)).length;
      own.push({
        at,
        line: id === LIVE_SPORT_LINE ? { key: id, kind: 'live' } : { key: id, kind: 'my-list' },
      });
    }
    const pushOwn = (index: number) => {
      for (const entry of own) if (entry.at === index) list.push(entry.line);
    };
    rows.forEach((row, index) => {
      pushOwn(index);
      list.push({ key: row.key, kind: 'row', row });
    });
    pushOwn(rows.length);
    return list;
  }, [places, board, empty, rows]);
  // Hidden by Home rows or empty, it is one shared empty list, so the header's memo still holds.
  const continueRow = (continueShown ? continueItems : null) ?? NO_CONTINUE;
  const heroContinue = continueRow[0];
  const heroRow = rows.find((row) => !failed.has(row.key) && firsts[row.key]);
  const heroItem =
    continueItems === null
      ? null
      : (heroContinue?.preview ?? (heroRow ? firsts[heroRow.key]! : null));

  // Pull to refresh: rows found empty come back, the rows loaded so far and any that failed ask
  // their addons again, Live sport looks again, and the account and Trakt sync. Home still
  // never asks for streams.
  const refreshControl = usePullRefresh(() => {
    const again = new Set([...empty, ...failed]);
    lines.forEach((line, index) => {
      if (line.kind === 'row' && index <= loadUpTo) again.add(line.row.key);
    });
    emptyRows.clear();
    setEmpty(new Set());
    for (const row of board ?? []) {
      if (again.has(row.key))
        addonClient
          .catalog(row.addon, row.type, row.catalog.id, row.extra, { keepEqual: true })
          .retry();
    }
    if (sportShown) {
      sportsFeed.retry();
      sportsFeed.refresh();
    }
    return syncForRefresh();
  });

  // FlatList wants the same function for its whole life.
  const onViewable = useCallback(
    ({ viewableItems }: { viewableItems: Array<{ index?: number | null }> }) => {
      const last = viewableItems.reduce((most, token) => Math.max(most, token.index ?? 0), 0);
      setLoadUpTo((before) => Math.max(before, last + LOAD_AHEAD));
    },
    [],
  );

  const profile = activeProfile();
  const kids = isKidsProfile();
  const noRows = ready && board !== null && rows.length === 0 && continueRow.length === 0;
  const allHidden =
    board !== null &&
    board.length === 0 &&
    buildBoard(collection.addons, sports.homeLeaveOut).length > 0;
  // The addons only list sport, which has its own tab.
  const sportsOnly = !kids && !allHidden && sports.shown;

  // Made again only when what it shows changes. Each row's first page and each newly reached row
  // re-render this screen, which would otherwise draw the hero and every Continue Watching tile
  // again too. Live sport and My List are lines of the list, where Home rows puts them, and are
  // memoised there for the same reason.
  const header = useMemo(
    () => (
      <View>
        <View style={[styles.topBar, { paddingTop: insets.top + space.m }]}>
          <PrismMark size={28} />
          <Text style={styles.wordmark} accessibilityRole="header">
            {t('phone.appName')}
          </Text>
          <View style={styles.spacer} />
          <Pressable
            onPress={openBrowse}
            accessibilityRole="button"
            accessibilityLabel={t('rail.discover')}
            style={styles.profile}
          >
            <OutlineIcon name="browse" size={26} color={colors.text} />
          </Pressable>
          {profile ? (
            <Pressable
              onPress={() => router.push('/profiles')}
              accessibilityRole="button"
              accessibilityLabel={t('phone.switchProfile')}
              style={styles.profile}
            >
              <Avatar profile={profile} size={40} round />
            </Pressable>
          ) : null}
        </View>
        <Hero
          item={noRows ? null : heroItem}
          {...(heroContinue && heroItem === heroContinue.preview
            ? {
                playLabel: t('phone.play'),
                onPlay: () => playContinue(heroContinue),
              }
            : {})}
          onDetails={openTitle}
        />
        {continueRow.length > 0 ? (
          <Row
            title={t('home.continueWatching')}
            shape="landscape"
            items={continueRow.map((item) => {
              const note = continueNote(t, item);
              return {
                item: item.preview,
                key: item.videoId,
                ...(note ? { note } : {}),
                ...(item.progress !== undefined ? { progress: item.progress } : {}),
              };
            })}
            onPress={(entry) => {
              const item = continueRow.find((candidate) => candidate.videoId === entry.key);
              if (item) playContinue(item);
            }}
            onLongPress={(entry) => setHeld(entry.item)}
          />
        ) : null}
        {noRows ? (
          <Message
            title={t(sportsOnly ? 'home.sportsOnly' : 'home.noAddons')}
            lead={t(
              kids
                ? 'home.noKidsRowsLead'
                : allHidden
                  ? 'home.allHiddenLead'
                  : sportsOnly
                    ? 'home.sportsOnlyLead'
                    : 'home.noAddonsLead',
            )}
            // Addons are for the grown-ups: a kids profile gets the words only, as on the TV.
            {...(kids
              ? {}
              : { action: { label: t('phone.addons'), onPress: () => router.push('/addons') } })}
          />
        ) : null}
      </View>
    ),
    [
      insets.top,
      profile,
      t,
      noRows,
      heroItem,
      heroContinue,
      continueRow,
      kids,
      allHidden,
      sportsOnly,
    ],
  );

  const onHeld = (choice: 'remove' | 'details' | 'list') => {
    const preview = held;
    setHeld(null);
    if (!preview) return;
    if (choice === 'remove') leaveContinueWatching({ metaId: preview.id, type: preview.type });
    else if (choice === 'details') openTitle(preview);
    else void (library.has(preview.id) ? library.remove(preview.id) : library.add(preview));
  };

  return (
    <>
      <FlatList
        style={styles.screen}
        data={lines}
        keyExtractor={(line) => line.key}
        ListHeaderComponent={header}
        renderItem={({ item: line, index }) =>
          line.kind === 'live' ? (
            <LiveSportRow />
          ) : line.kind === 'my-list' ? (
            <MyListRow />
          ) : (
            <HomeRow
              row={line.row}
              enabled={index <= loadUpTo}
              onFirst={onFirst}
              onEmpty={onEmpty}
              onFailed={onFailed}
            />
          )
        }
        refreshControl={refreshControl}
        onViewableItemsChanged={onViewable}
        viewabilityConfig={{ itemVisiblePercentThreshold: 10 }}
        contentContainerStyle={{ paddingBottom: space.xxl }}
        removeClippedSubviews
        initialNumToRender={4}
        windowSize={7}
      />
      <Sheet
        visible={held !== null}
        {...(held ? { title: held.name } : {})}
        onClose={() => setHeld(null)}
      >
        {held ? (
          <>
            <SheetOption
              label={t('browsing.removeFromContinue')}
              onPress={() => onHeld('remove')}
            />
            <SheetOption label={t('home.details')} onPress={() => onHeld('details')} />
            <SheetOption
              label={library.has(held.id) ? t('browsing.removeFromList') : t('browsing.addToList')}
              onPress={() => onHeld('list')}
            />
          </>
        ) : null}
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: gutter,
    paddingBottom: space.s,
  },
  wordmark: { ...type.title, fontSize: 22, lineHeight: 28, color: colors.text },
  spacer: { flex: 1 },
  profile: {
    width: touch.min,
    height: touch.min,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowError: { paddingHorizontal: gutter, gap: space.s, alignItems: 'flex-start' },
  rowErrorText: { ...type.body, color: colors.textMuted },
});
