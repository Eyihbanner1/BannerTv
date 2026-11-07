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
import {
  FlatList,
  type LayoutChangeEvent,
  StyleSheet,
  Text,
  TVFocusGuideView,
  View,
} from 'react-native';
import { openPlayer, openTitle } from '../../nav/routes';
import { Button } from '../../ui/Button';
import { NavBar, type NavTarget } from '../../ui/NavBar';
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

/**
 * A film plays straight from the hero, as its button says. A series opens its page to choose an
 * episode, and its button says so; a kids profile always goes through the page, as on the LG.
 */
function titleHero(t: Translate, item: MetaPreview, eyebrow: string): HeroTitle {
  if (item.type === 'movie' && !isKidsProfile()) {
    return {
      item,
      eyebrow,
      play: () => openPlayer({ type: item.type, metaId: item.id, videoId: item.id, preview: item }),
      playLabel: t('tv.play'),
    };
  }
  return { item, eyebrow, play: () => openTitle(item), playLabel: t('tv.episodes') };
}

/** Where focus goes when Home is on top again. */
type Back =
  | { kind: 'hero' }
  | { kind: 'nav'; target: NavTarget }
  | { kind: 'tile'; row: string; key: string };

const HomeRow = memo(function HomeRow({
  row,
  enabled,
  onFirst,
  onEmpty,
  onFocusTitle,
  onRowFocus,
  preferredKey,
  onOpen,
}: {
  row: BoardRow;
  enabled: boolean;
  /** A tile on this row took focus: Home scrolls the row up under the hero. */
  onRowFocus: () => void;
  preferredKey: string | null;
  onOpen: (row: string, key: string) => void;
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
      preferredKey={preferredKey}
      onPress={(entry) => {
        onOpen(row.key, entry.key);
        openTitle(entry.item);
      }}
      onItemFocus={(entry) => {
        onRowFocus();
        onFocusTitle(titleHero(t, entry.item, row.name));
      }}
    />
  );
});

type HomeEntry = { key: 'continue' } | { key: string; row: BoardRow };

export function HomeScreen({ active, fromNav }: { active: boolean; fromNav: boolean }) {
  const { t } = useTranslation();
  // Android forgets focus when a screen is hidden, so Home puts it back itself.
  const [back, setBack] = useState<Back>(() =>
    fromNav ? { kind: 'nav', target: 'current' } : { kind: 'hero' },
  );
  const onOpen = useCallback((row: string, key: string) => setBack({ kind: 'tile', row, key }), []);
  const onLeaveNav = useCallback((target: NavTarget) => setBack({ kind: 'nav', target }), []);
  const preferredIn = (row: string) =>
    active && back.kind === 'tile' && back.row === row ? back.key : null;
  const restoreKey = active && back.kind === 'tile' ? `${back.row}\n${back.key}` : '';
  // The list of rows is sized from the space under the hero, measured, rather than by flex:
  // on Android TV the list's own wrapper took no height and the rows were drawn at 0 px.
  const [rowsHeight, setRowsHeight] = useState(0);
  const onRowsLayout = useCallback((event: LayoutChangeEvent) => {
    const height = Math.round(event.nativeEvent.layout.height);
    setRowsHeight((before) => (before === height ? before : height));
  }, []);
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
  // While the remote is on the rows, the hero drops its description to give them room.
  const [inRows, setInRows] = useState(false);
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

  // Called from the tile's own focus, which Android always reports, so the focused row is
  // brought to the top of the list rather than left where Android's minimal scroll puts it.
  const focusRow = useCallback((index: number) => {
    setInRows(true);
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
        <TVFocusGuideView autoFocus>
          <Row
            title={t('home.continueWatching')}
            shape="landscape"
            preferredKey={preferredIn('continue')}
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
              if (!item) return;
              onOpen('continue', rowEntry.key);
              playContinue(item);
            }}
            onItemFocus={(rowEntry) => {
              focusRow(index);
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
      <TVFocusGuideView autoFocus>
        <HomeRow
          row={entry.row}
          enabled={index <= loadUpTo}
          onFirst={onFirst}
          onEmpty={onEmpty}
          onFocusTitle={onFocusTitle}
          onRowFocus={() => focusRow(index)}
          preferredKey={preferredIn(entry.row.key)}
          onOpen={onOpen}
        />
      </TVFocusGuideView>
    );
  };

  return (
    <View style={styles.screen}>
      <HeroBackdrop item={hero?.item ?? null} />
      <NavBar
        current="home"
        active={active}
        focus={back.kind === 'nav' ? back.target : null}
        onLeave={onLeaveNav}
      />
      <View style={styles.heroArea}>
        <HeroText
          hero={hero}
          preferred={active && back.kind === 'hero'}
          compact={inRows}
          onPlay={() => setBack({ kind: 'hero' })}
          onButtonFocus={() => {
            setInRows(false);
            list.current?.scrollToOffset({ offset: 0, animated: true });
          }}
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
        <View style={styles.rows} onLayout={onRowsLayout}>
          {rowsHeight > 0 ? (
            <FlatList
              ref={list}
              style={{ height: rowsHeight }}
              data={entries}
              extraData={restoreKey}
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
          ) : null}
        </View>
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
