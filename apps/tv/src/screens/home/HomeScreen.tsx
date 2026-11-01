import { type BoardRow, buildBoard, type ContinueItem, kidsTitleAllowed } from '@bannertv/core';
import type { MetaPreview } from '@bannertv/protocol';
import { useContinueItems } from '@phone/data/use-continue';
import { addonClient, addonCollection } from '@tv/data/addons';
import { describeAddonError, typeLabel } from '@tv/data/describe';
import { useHomeBoard } from '@tv/data/home-board';
import { isKidsProfile } from '@tv/data/profiles';
import { noteFirstPage, sportsState } from '@tv/data/sports';
import { useQuery } from '@tv/data/use-query';
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, StyleSheet, Text, TVFocusGuideView, View } from 'react-native';
import { openPlayer, openTitle } from '../../nav/routes';
import { Button } from '../../ui/Button';
import { NavBar } from '../../ui/NavBar';
import { Row, type RowItem } from '../../ui/Row';
import { color, layout, motion, px, spacing, type } from '../../ui/theme';
import { HeroBackdrop, type HeroTitle, HeroText } from './Hero';

const MAX_ROW_ITEMS = 40;
/** Rows load this many rows ahead of the one the remote is on. */
const LOAD_AHEAD = 3;
/** Rows found empty this run; they stay off Home until the app starts again. */
const emptyRows = new Set<string>();

type Translate = ReturnType<typeof useTranslation>['t'];

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

function continueNote(t: Translate, item: ContinueItem): string | undefined {
  if (item.season !== undefined && item.episode !== undefined) {
    return t(item.upNext ? 'home.nextEpisodeNote' : 'home.episodeNote', {
      season: item.season,
      episode: item.episode,
    });
  }
  return item.upNext ? t('home.nextNote') : undefined;
}

function titleHero(t: Translate, item: MetaPreview, eyebrow: string): HeroTitle {
  return { item, eyebrow, play: () => openTitle(item), playLabel: t('tv.play') };
}

const HomeRow = memo(function HomeRow({
  row,
  enabled,
  onFirst,
  onEmpty,
  onFocusTitle,
}: {
  row: BoardRow;
  enabled: boolean;
  onFirst: (key: string, item: MetaPreview) => void;
  onEmpty: (key: string) => void;
  onFocusTitle: (hero: HeroTitle) => void;
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

  useEffect(() => {
    if (state.data && row.extra.length === 0) noteFirstPage(row.addon, row.catalog, state.data);
  }, [state.data, row]);
  useEffect(() => {
    if (state.status === 'success' && items?.length === 0) onEmpty(row.key);
  }, [state.status, items, onEmpty, row.key]);
  useEffect(() => {
    if (items?.[0]) onFirst(row.key, items[0]);
  }, [items, onFirst, row.key]);

  const rowItems = useMemo<RowItem[]>(
    () => items?.map((item, index) => ({ item, key: `${index}:${item.id}` })) ?? [],
    [items],
  );
  const title = `${row.name} · ${typeLabel(t, row.type)}`;
  if (state.status === 'error') {
    return (
      <View style={styles.rowError}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowErrorText}>
          {describeAddonError(t, state.error, row.addon.manifest.name)}
        </Text>
        <Button label={t('common.tryAgain')} onPress={() => query.retry()} />
      </View>
    );
  }
  if (rowItems.length === 0) {
    return (
      <View style={styles.rowWaiting}>
        <Text style={styles.rowTitle}>{title}</Text>
      </View>
    );
  }
  return (
    <Row
      title={title}
      items={rowItems}
      shape={row.style === 'landscape' ? 'landscape' : 'poster'}
      onPress={(entry) => openTitle(entry.item)}
      onItemFocus={(entry) => onFocusTitle(titleHero(t, entry.item, row.name))}
    />
  );
});

type HomeEntry = { key: 'continue' } | { key: string; row: BoardRow };

export function HomeScreen() {
  const { t } = useTranslation();
  const collection = useSyncExternalStore(addonCollection.subscribe, addonCollection.get);
  const sports = useSyncExternalStore(sportsState.subscribe, sportsState.get);
  const ready = collection.ready && sports.ready;
  // Sports catalogs leave Home, as on the LG; they belong to Sports.
  const board = useHomeBoard(collection.addons, ready, sports.homeLeaveOut);
  const continueItems = useContinueItems();
  const [empty, setEmpty] = useState<ReadonlySet<string>>(() => new Set(emptyRows));
  const [firsts, setFirsts] = useState<Readonly<Record<string, MetaPreview>>>({});
  const [loadUpTo, setLoadUpTo] = useState(LOAD_AHEAD);
  const [focusedHero, setFocusedHero] = useState<HeroTitle | null>(null);
  const list = useRef<FlatList<HomeEntry>>(null);
  const heroTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(heroTimer.current), []);

  const onEmpty = useCallback((key: string) => {
    emptyRows.add(key);
    setEmpty((before) => (before.has(key) ? before : new Set(before).add(key)));
  }, []);
  const onFirst = useCallback((key: string, item: MetaPreview) => {
    setFirsts((before) => (before[key] === item ? before : { ...before, [key]: item }));
  }, []);
  // The hero follows the remote after a short wait, so walking along a row doesn't redraw it
  // for every tile passed.
  const onFocusTitle = useCallback((hero: HeroTitle) => {
    clearTimeout(heroTimer.current);
    heroTimer.current = setTimeout(() => setFocusedHero(hero), motion.heroDelay);
  }, []);

  const rows = useMemo(() => (board ?? []).filter((row) => !empty.has(row.key)), [board, empty]);
  const continueRow = continueItems ?? [];
  const entries = useMemo<HomeEntry[]>(
    () => [
      ...(continueRow.length > 0 ? [{ key: 'continue' } as const] : []),
      ...rows.map((row) => ({ key: row.key, row })),
    ],
    [continueRow.length, rows],
  );

  // Before the remote moves: the first title to continue, or the first row's first title.
  const firstContinue = continueRow[0];
  const firstRow = rows.find((row) => firsts[row.key]);
  const startHero: HeroTitle | null = firstContinue
    ? {
        item: firstContinue.preview,
        eyebrow: t('tv.continueEyebrow'),
        play: () => playContinue(firstContinue),
        playLabel: t('tv.resume'),
      }
    : firstRow
      ? titleHero(t, firsts[firstRow.key]!, firstRow.name)
      : null;
  const hero = focusedHero ?? startHero;

  const focusRow = useCallback((index: number) => {
    setLoadUpTo((before) => Math.max(before, index + LOAD_AHEAD));
    list.current?.scrollToIndex({ index, viewPosition: 0, animated: true });
  }, []);

  const kids = isKidsProfile();
  const noRows = ready && board !== null && rows.length === 0 && continueRow.length === 0;
  const allHidden =
    board !== null &&
    board.length === 0 &&
    buildBoard(collection.addons, sports.homeLeaveOut).length > 0;
  const sportsOnly = !kids && !allHidden && sports.shown;

  const renderEntry = ({ item: entry, index }: { item: HomeEntry; index: number }) => {
    if (!('row' in entry)) {
      return (
        <TVFocusGuideView autoFocus onFocusEnter={() => focusRow(index)}>
          <Row
            title={t('home.continueWatching')}
            shape="landscape"
            preferredFirst
            items={continueRow.map((item) => {
              const note = continueNote(t, item);
              return {
                item: item.preview,
                key: item.videoId,
                ...(note ? { note } : {}),
                ...(item.progress !== undefined ? { progress: item.progress } : {}),
              };
            })}
            onPress={(rowEntry) => {
              const item = continueRow.find((candidate) => candidate.videoId === rowEntry.key);
              if (item) playContinue(item);
            }}
            onItemFocus={(rowEntry) => {
              const item = continueRow.find((candidate) => candidate.videoId === rowEntry.key);
              if (!item) return;
              onFocusTitle({
                item: item.preview,
                eyebrow: t('tv.continueEyebrow'),
                play: () => playContinue(item),
                playLabel: t('tv.resume'),
              });
            }}
          />
        </TVFocusGuideView>
      );
    }
    return (
      <TVFocusGuideView autoFocus onFocusEnter={() => focusRow(index)}>
        <HomeRow
          row={entry.row}
          enabled={index <= loadUpTo}
          onFirst={onFirst}
          onEmpty={onEmpty}
          onFocusTitle={onFocusTitle}
        />
      </TVFocusGuideView>
    );
  };

  return (
    <View style={styles.screen}>
      <HeroBackdrop item={hero?.item ?? null} />
      <NavBar current="home" />
      <View style={styles.heroArea}>
        <HeroText
          hero={hero}
          onButtonFocus={() => list.current?.scrollToOffset({ offset: 0, animated: true })}
        />
      </View>
      {noRows ? (
        <View style={styles.message}>
          <Text style={styles.messageTitle}>
            {t(sportsOnly ? 'home.sportsOnly' : 'home.noAddons')}
          </Text>
          <Text style={styles.messageLead}>
            {t(
              kids
                ? 'home.noKidsRowsLead'
                : allHidden
                  ? 'home.allHiddenLead'
                  : sportsOnly
                    ? 'home.sportsOnlyLead'
                    : 'home.noAddonsLead',
            )}
          </Text>
        </View>
      ) : (
        <FlatList
          ref={list}
          style={styles.rows}
          data={entries}
          keyExtractor={(entry) => entry.key}
          renderItem={renderEntry}
          contentContainerStyle={styles.rowsContent}
          showsVerticalScrollIndicator={false}
          initialNumToRender={3}
          windowSize={5}
          removeClippedSubviews={false}
          onScrollToIndexFailed={({ index, averageItemLength }) =>
            list.current?.scrollToOffset({ offset: index * averageItemLength, animated: true })
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  heroArea: { marginTop: layout.heroTop - layout.navHeight },
  rows: { flex: 1, marginTop: spacing.xl },
  rowsContent: { gap: layout.rowGap, paddingBottom: px(400) },
  rowTitle: { ...type.rowTitle, color: color.textSoft },
  rowWaiting: { paddingLeft: layout.heroLeft, height: px(80), justifyContent: 'center' },
  rowError: { paddingLeft: layout.heroLeft, gap: spacing.md, alignItems: 'flex-start' },
  rowErrorText: { ...type.body, color: color.textMuted },
  message: {
    marginLeft: layout.heroLeft,
    marginTop: spacing.xxl,
    width: px(1100),
    gap: spacing.md,
  },
  messageTitle: { ...type.heading, color: color.text },
  messageLead: { ...type.body, color: color.textMuted },
});
