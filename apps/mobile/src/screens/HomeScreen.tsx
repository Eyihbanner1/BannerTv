import { type BoardRow, buildBoard, kidsTitleAllowed, type ContinueItem } from '@bannertv/core';
import type { MetaPreview } from '@bannertv/protocol';
import { addonClient, addonCollection } from '@tv/data/addons';
import { describeAddonError, typeLabel } from '@tv/data/describe';
import { useHomeBoard } from '@tv/data/home-board';
import { activeProfile, isKidsProfile } from '@tv/data/profiles';
import { noteFirstPage, sportsState } from '@tv/data/sports';
import { useQuery } from '@tv/data/use-query';
import { memo, useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useContinueItems } from '../data/use-continue';
import { LiveSportRow } from './sports/LiveSportRow';
import { openCatalog, openPlayer, openTitle } from '../nav/routes';
import { Avatar } from '../ui/Avatar';
import { Button } from '../ui/Button';
import { Hero } from '../ui/Hero';
import { Message } from '../ui/Message';
import { Row, type RowItem } from '../ui/Row';
import { colors, space, type } from '../ui/theme';
import { router } from 'expo-router';

const MAX_ROW_ITEMS = 40;
/** Rows load this many rows ahead of the last one on screen. */
const LOAD_AHEAD = 3;
/** Rows found empty this run; they stay off Home until the app starts again. */
const emptyRows = new Set<string>();

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
    return t(item.upNext ? 'home.nextEpisodeNote' : 'home.episodeNote', {
      season: item.season,
      episode: item.episode,
    });
  }
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
    () => addonClient.catalog(row.addon, row.type, row.catalog.id, row.extra),
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
  const continueRow = continueItems ?? [];
  const heroContinue = continueRow[0];
  const heroRow = rows.find((row) => !failed.has(row.key) && firsts[row.key]);
  const heroItem =
    continueItems === null
      ? null
      : (heroContinue?.preview ?? (heroRow ? firsts[heroRow.key]! : null));

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

  const header = (
    <View>
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
      <View style={[styles.topBar, { top: insets.top + space.s }]}>
        <Text style={styles.wordmark}>{t('phone.appName')}</Text>
        {profile ? (
          <Pressable
            onPress={() => router.push('/profiles')}
            accessibilityRole="button"
            accessibilityLabel={t('phone.switchProfile')}
            hitSlop={8}
          >
            <Avatar profile={profile} size={32} />
          </Pressable>
        ) : null}
      </View>
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
        />
      ) : null}
      <LiveSportRow />
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
  );

  return (
    <FlatList
      style={styles.screen}
      data={rows}
      keyExtractor={(row) => row.key}
      ListHeaderComponent={header}
      renderItem={({ item: row, index }) => (
        <HomeRow
          row={row}
          enabled={index <= loadUpTo}
          onFirst={onFirst}
          onEmpty={onEmpty}
          onFailed={onFailed}
        />
      )}
      onViewableItemsChanged={onViewable}
      viewabilityConfig={{ itemVisiblePercentThreshold: 10 }}
      contentContainerStyle={{ paddingBottom: space.xxl }}
      initialNumToRender={4}
      windowSize={7}
    />
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  topBar: {
    position: 'absolute',
    left: space.l,
    right: space.l,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  wordmark: { ...type.title, color: colors.text, letterSpacing: 0.5 },
  rowError: { paddingHorizontal: space.l, gap: space.s, alignItems: 'flex-start' },
  rowErrorText: { ...type.body, color: colors.textMuted },
});
