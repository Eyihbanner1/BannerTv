import {
  type CatalogSource,
  type DiscoverSource,
  discoverSources,
  kidsSearchSources,
  type PlannedRow,
  type Query,
  searchSources,
} from '@bannertv/core';
import { addonCollection } from '@tv/data/addons';
import { describeAddonError, typeLabel } from '@tv/data/describe';
import { isKidsProfile } from '@tv/data/profiles';
import { loadRecentSearches, recentSearches } from '@tv/data/search';
import {
  plannedCatalog,
  plannedQuery,
  plannedTitle,
  type SearchHelp,
  searchHelp,
  useQueryStates,
  useSmartSearch,
  visibleTitles,
} from '@tv/data/search-results';
import { sportsState } from '@tv/data/sports';
import { memo, useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import type { MetaPreview } from '@bannertv/protocol';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { openCatalog, openTitle } from '../nav/routes';
import { reportTyping } from '../runtime/whereabouts';
import { phone } from '@brand/tokens/design';
import { SportsResults } from './sports/SportsResults';
import { Artwork } from '../ui/Artwork';
import { Button } from '../ui/Button';
import { Chip } from '../ui/Chip';
import { Icon, OutlineIcon } from '../ui/icons';
import { Message } from '../ui/Message';
import { Row, type RowItem } from '../ui/Row';
import { phoneArt } from '../ui/Tile';
import { colors, gutter, radius, space, touch, type } from '../ui/theme';

const TYPING_PAUSE_MS = 500;
/** Results shown per section before "See all". */
const FIRST_RESULTS = 6;
/** Titles a row for what the words mean shows at most, as Home's rows. */
const MAX_ROW_ITEMS = 40;
const NO_SOURCES: readonly CatalogSource[] = [];
const NO_DISCOVER: readonly DiscoverSource[] = [];

type Kind = 'all' | 'movie' | 'series';
const KINDS: readonly Kind[] = ['all', 'movie', 'series'];
type Items = readonly MetaPreview[];

/** Whether the kind chip keeps things of this type. */
const keeps = (kind: Kind, type: string) => kind === 'all' || type === kind;

/** One found title: the poster, its name and what it is. Tapping opens Details. */
const Result = memo(function Result({
  item,
  tag,
  onPress,
}: {
  item: MetaPreview;
  tag: string;
  onPress: (item: MetaPreview) => void;
}) {
  const facts = [item.releaseInfo, tag].filter(Boolean).join(' · ');
  return (
    <Pressable
      onPress={() => onPress(item)}
      accessibilityRole="button"
      accessibilityLabel={[item.name, item.releaseInfo].filter(Boolean).join(', ')}
      style={({ pressed }) => [styles.result, pressed && styles.pressed]}
    >
      <Artwork
        src={phoneArt(item.poster, 'small')}
        retrySrc={item.poster}
        seed={item.id}
        style={styles.poster}
      />
      <View style={styles.resultText}>
        <Text style={styles.resultName} numberOfLines={2}>
          {item.name}
        </Text>
        {facts ? (
          <Text style={styles.resultFacts} numberOfLines={1}>
            {facts}
          </Text>
        ) : null}
      </View>
      <OutlineIcon name="chevron" size={20} color={colors.textMuted} />
    </Pressable>
  );
});
const MIN_TERM_LENGTH = 2;
const termOf = (text: string) => {
  const term = text.trim().replace(/\s+/g, ' ');
  return term.length >= MIN_TERM_LENGTH ? term : '';
};

function SectionHeader({ title, tag }: { title: string; tag?: string }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle} numberOfLines={1} accessibilityRole="header">
        {title}
      </Text>
      {tag ? (
        <Text style={styles.sectionTag} numberOfLines={1}>
          {tag}
        </Text>
      ) : null}
    </View>
  );
}

/** Found titles one under another: the first few, then all of them on See all. */
function ResultList({
  items,
  tagOf,
  onPress,
}: {
  items: Items;
  tagOf: (item: MetaPreview) => string;
  onPress: (item: MetaPreview) => void;
}) {
  const { t } = useTranslation();
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, FIRST_RESULTS);
  return (
    <>
      {shown.map((item, index) => (
        <Result key={`${index}:${item.id}`} item={item} tag={tagOf(item)} onPress={onPress} />
      ))}
      {!all && items.length > FIRST_RESULTS ? (
        <Button
          kind="quiet"
          label={t('home.seeAll')}
          onPress={() => setAll(true)}
          style={styles.more}
        />
      ) : null}
    </>
  );
}

/** The best answers from every addon, each title once. */
const TopSection = memo(function TopSection({
  items,
  onPress,
}: {
  items: Items;
  onPress: (item: MetaPreview) => void;
}) {
  const { t } = useTranslation();
  const tagOf = useCallback((item: MetaPreview) => typeLabel(t, item.type), [t]);
  return (
    <View style={styles.section}>
      <SectionHeader title={t('search.topResults')} />
      <ResultList items={items} tagOf={tagOf} onPress={onPress} />
    </View>
  );
});

/** A row for what the words mean ("Comedy films"): the catalog Home asks, so it shares its copy. */
const PlannedSection = memo(function PlannedSection({
  row,
  items,
  onPress,
}: {
  row: PlannedRow;
  /** Null while the catalog is asked. */
  items: Items | null;
  onPress: (item: MetaPreview) => void;
}) {
  const { t } = useTranslation();
  const title = plannedTitle(t, row);
  // The catalog screen checks a kids profile's titles only as loosely as a Family
  // catalog needs: so a kids profile gets See all on Family rows alone.
  const seeAll = !isKidsProfile() || row.family;
  const rowItems = useMemo<RowItem[] | null>(
    () => items?.map((item, index) => ({ item, key: `${index}:${item.id}` })) ?? null,
    [items],
  );
  return (
    <Row
      title={title}
      tag={row.source.addon.manifest.name}
      items={rowItems}
      shape="poster"
      onPress={(entry) => onPress(entry.item)}
      seeAllLabel={t('home.seeAll')}
      {...(items && items.length > 0 && seeAll
        ? { onSeeAll: () => openCatalog({ ...plannedCatalog(row), title }) }
        : {})}
    />
  );
});

/** One addon catalog's own results, from the search the screen already asked. */
const AddonSection = memo(function AddonSection({
  source,
  tag,
  query,
  items,
  failed,
  error,
  onPress,
}: {
  source: CatalogSource;
  tag: string;
  query: Query<MetaPreview[]>;
  /** Null while the addon is asked. */
  items: Items | null;
  /** It failed with nothing to show. */
  failed: boolean;
  error: Error | undefined;
  onPress: (item: MetaPreview) => void;
}) {
  const { t } = useTranslation();
  const typeName = typeLabel(t, source.catalog.type);
  const tagOf = useCallback(() => typeName, [typeName]);
  return (
    <View style={styles.section}>
      <SectionHeader title={typeName} tag={tag} />
      {failed ? (
        <View style={styles.error}>
          <Text style={styles.muted}>
            {describeAddonError(t, error, source.addon.manifest.name)}
          </Text>
          <Button label={t('common.tryAgain')} onPress={() => query.retry()} />
        </View>
      ) : items === null ? (
        <View style={[styles.result, styles.placeholder]}>
          <View style={styles.poster} />
        </View>
      ) : (
        <ResultList items={items} tagOf={tagOf} onPress={onPress} />
      )}
    </View>
  );
});

/** The line that shows or hides each addon's own results under Top results. */
function FoldLine({ open, onPress }: { open: boolean; onPress: () => void }) {
  const { t } = useTranslation();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      style={({ pressed }) => [styles.fold, pressed && styles.pressed]}
    >
      <Text style={styles.foldText} numberOfLines={1}>
        {t('phone.search.eachAddon')}
      </Text>
      <Icon name={open ? 'up' : 'down'} size={22} color={colors.textMuted} />
    </Pressable>
  );
}

/** Nothing found: a likely spelling, genres to search instead, and Try again if an addon failed. */
function Help({
  term,
  help,
  someFailed,
  canRetry,
  onPick,
  onRetry,
}: {
  term: string;
  help: SearchHelp;
  someFailed: boolean;
  canRetry: boolean;
  onPick: (text: string) => void;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  const meant = help.didYouMean;
  return (
    <View style={styles.help}>
      <Text style={styles.lead}>{t('search.nothingFound', { term })}</Text>
      {meant !== undefined ? (
        <Pressable
          onPress={() => onPick(meant)}
          accessibilityRole="button"
          style={({ pressed }) => [styles.meant, pressed && styles.pressed]}
        >
          <Text style={styles.meantText}>{t('search.didYouMean', { term: meant })}</Text>
        </Pressable>
      ) : null}
      {help.chips.length > 0 ? (
        <>
          <Text style={styles.muted}>{t('search.tryGenres')}</Text>
          <View style={styles.genres}>
            {help.chips.map((chip) => (
              <Chip
                key={chip.label}
                label={chip.label}
                on={false}
                onPress={() => onPick(chip.query)}
              />
            ))}
          </View>
        </>
      ) : null}
      {someFailed ? <Text style={styles.small}>{t('search.someNoAnswer')}</Text> : null}
      {canRetry ? <Button label={t('common.tryAgain')} onPress={onRetry} /> : null}
    </View>
  );
}

type Section =
  | { key: string; kind: 'waiting' }
  | { key: string; kind: 'top'; items: Items }
  | { key: string; kind: 'planned'; index: number }
  | { key: string; kind: 'fold' }
  | { key: string; kind: 'addon'; index: number };

/**
 * The results for a term, top to bottom: Sports, Top results, rows for what the words mean
 * ("Comedy films"), then each addon's own results, folded under Top results. The kind chip
 * filters what is drawn; the requests are the same whichever chip is on.
 */
function Results({
  term,
  kind,
  sources,
  sportsSources,
  discover,
  onPick,
}: {
  term: string;
  kind: Kind;
  sources: readonly CatalogSource[];
  /** With sport installed: the Sports group's own searches, or null without sport. */
  sportsSources: readonly CatalogSource[] | null;
  /** Catalogs that can answer what the words mean. */
  discover: readonly DiscoverSource[];
  /** A spelling or genre from the help: search for it instead. */
  onPick: (text: string) => void;
}) {
  const { t } = useTranslation();
  const { planned, queries, states, results, failed, top } = useSmartSearch(
    term,
    sources,
    discover,
  );
  // The understood rows' own queries, read here too to know when they have answered.
  const plannedQueries = useMemo(() => planned.map((row) => plannedQuery(row)), [planned]);
  const plannedStates = useQueryStates(plannedQueries);
  const [sportsFound, setSportsFound] = useState(false);
  const [unfolded, setUnfolded] = useState(false);

  // Two catalogs of one addon and type need the catalog name to tell them apart.
  const tags = useMemo(
    () =>
      sources.map((source) => {
        const twin = sources.some(
          (other) =>
            other !== source &&
            other.addon === source.addon &&
            other.catalog.type === source.catalog.type,
        );
        return twin
          ? `${source.addon.manifest.name} · ${source.catalog.name}`
          : source.addon.manifest.name;
      }),
    [sources],
  );
  const plannedItems = useMemo(
    () =>
      planned.map((row, index) => {
        const data = plannedStates[index]?.data;
        return data ? visibleTitles(data, row.family).slice(0, MAX_ROW_ITEMS) : null;
      }),
    [planned, plannedStates],
  );
  const topItems = useMemo(
    () => (top.status === 'shown' ? top.items.filter((item) => keeps(kind, item.type)) : []),
    [top, kind],
  );
  const open = useCallback(
    (item: MetaPreview) => {
      recentSearches.add(term);
      openTitle(item);
    },
    [term],
  );

  // What the kind chip leaves, by index.
  const searched: number[] = [];
  sources.forEach((source, index) => {
    if (keeps(kind, source.catalog.type)) searched.push(index);
  });
  const rows: number[] = [];
  planned.forEach((row, index) => {
    if (keeps(kind, row.type)) rows.push(index);
  });
  const rowFailed = (index: number) => {
    const state = plannedStates[index];
    return state !== undefined && state.status === 'error' && state.data === undefined;
  };
  const searchFound = searched.some((index) => (results[index]?.length ?? 0) > 0);
  const plannedFound = rows.some((index) => (plannedItems[index]?.length ?? 0) > 0);
  // Only while the group is there: it says nothing as it goes.
  const found = searchFound || plannedFound || (sportsSources !== null && sportsFound);
  const done =
    searched.every((index) => results[index] != null) &&
    rows.every((index) => plannedItems[index] !== null || rowFailed(index));
  const someFailed = searched.some((index) => failed[index] === true);
  // Every addon, whatever the chip: one of another type answering means the connection works.
  const allFailed = done && !found && sources.length > 0 && failed.every(Boolean);
  const nothing = done && !found && !allFailed;
  const help = useMemo(
    () => (nothing ? searchHelp(term, discover) : undefined),
    [nothing, term, discover],
  );
  const retryFailed = () => {
    queries.forEach((query, index) => {
      if (failed[index]) query.retry();
    });
    plannedQueries.forEach((query, index) => {
      if (rowFailed(index)) query.retry();
    });
  };

  const sections: Section[] = [];
  // Until Top results is decided, the addons' sections wait behind the fold, so the list
  // only grows: they never fold away under the finger.
  const waiting = top.status === 'waiting';
  if (waiting && searched.length > 0 && !nothing && !allFailed) {
    sections.push({ key: 'waiting', kind: 'waiting' });
  }
  if (topItems.length > 0) sections.push({ key: 'top', kind: 'top', items: topItems });
  for (const index of rows) {
    const items = plannedItems[index];
    // An understood row only adds to what the addons found: it goes quietly when it has nothing.
    if (rowFailed(index) || (items && items.length === 0)) continue;
    sections.push({ key: `planned-${planned[index]!.key}`, kind: 'planned', index });
  }
  // When every addon failed, one message says so instead of a section each.
  const addons = allFailed
    ? []
    : searched.filter((index) => {
        const items = results[index];
        return failed[index] === true || !items || items.length > 0;
      });
  const behindFold = waiting || topItems.length > 0;
  if (addons.length > 0) {
    if (behindFold) sections.push({ key: 'fold', kind: 'fold' });
    if (!behindFold || unfolded) {
      for (const index of addons) {
        sections.push({ key: `addon-${sources[index]!.key}`, kind: 'addon', index });
      }
    }
  }

  const renderItem = ({ item: section }: { item: Section }) => {
    switch (section.kind) {
      case 'waiting':
        return (
          <View style={styles.section}>
            <View style={[styles.result, styles.placeholder]}>
              <View style={styles.poster} />
            </View>
          </View>
        );
      case 'top':
        return <TopSection items={section.items} onPress={open} />;
      case 'planned':
        return (
          <PlannedSection
            row={planned[section.index]!}
            items={plannedItems[section.index] ?? null}
            onPress={open}
          />
        );
      case 'fold':
        return <FoldLine open={unfolded} onPress={() => setUnfolded((was) => !was)} />;
      case 'addon':
        return (
          <AddonSection
            source={sources[section.index]!}
            tag={tags[section.index]!}
            query={queries[section.index]!}
            items={results[section.index] ?? null}
            failed={failed[section.index] === true}
            error={states[section.index]?.error}
            onPress={open}
          />
        );
    }
  };

  let footer;
  if (allFailed) {
    footer = (
      <Message
        lead={t('search.noAnswer')}
        action={{ label: t('common.tryAgain'), onPress: retryFailed }}
      />
    );
  } else if (nothing && help) {
    footer = (
      <Help
        term={term}
        help={help}
        someFailed={someFailed}
        canRetry={someFailed || rows.some(rowFailed)}
        onPick={onPick}
        onRetry={retryFailed}
      />
    );
  } else if (done && someFailed) {
    footer = <Text style={[styles.small, styles.note]}>{t('search.someNoAnswer')}</Text>;
  }

  return (
    <FlatList
      data={sections}
      keyExtractor={(section) => section.key}
      renderItem={renderItem}
      ListHeaderComponent={
        sportsSources ? (
          <SportsResults term={term} sources={sportsSources} onContent={setSportsFound} />
        ) : undefined
      }
      ListFooterComponent={footer}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ paddingBottom: space.xxl }}
    />
  );
}

export function SearchScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [text, setText] = useState('');
  const [kind, setKind] = useState<Kind>('all');
  const [term, setTerm] = useState('');
  const collection = useSyncExternalStore(addonCollection.subscribe, addonCollection.get);
  const sports = useSyncExternalStore(sportsState.subscribe, sportsState.get);
  const recent = useSyncExternalStore(recentSearches.subscribe, recentSearches.get);
  // Once sport is settled too, so a sports addon's search is never asked for the moment
  // before it is known to be one.
  const ready = collection.ready && sports.ready;
  // Sports catalogs leave the general results, as on the TV: the Sports group answers for them.
  const sources = useMemo(() => {
    if (!ready) return NO_SOURCES;
    const all = searchSources(collection.addons, sports.searchLeaveOut);
    return isKidsProfile() ? kidsSearchSources(all) : all;
  }, [ready, collection.addons, sports.searchLeaveOut]);
  // A kids profile has no Sports, so no Sports group either.
  const sportsSources = useMemo(() => {
    const leaveOut = sports.searchLeaveOut;
    if (!ready || !sports.shown || !leaveOut || isKidsProfile()) return null;
    return searchSources(collection.addons).filter((source) =>
      leaveOut(source.addon, source.catalog),
    );
  }, [ready, collection.addons, sports.shown, sports.searchLeaveOut]);
  // The catalogs that can answer what the words mean, without sport. planSearch keeps a kids
  // profile to its own catalogs.
  const discover = useMemo(() => {
    if (!ready) return NO_DISCOVER;
    const leaveOut = sports.homeLeaveOut;
    return discoverSources(collection.addons).filter(
      (source) => !leaveOut?.(source.addon, source.catalog),
    );
  }, [ready, collection.addons, sports.homeLeaveOut]);
  const pick = useCallback((next: string) => {
    setText(next);
    setTerm(termOf(next));
  }, []);
  const kindLabel = (value: Kind) =>
    value === 'all'
      ? t('library.all')
      : value === 'movie'
        ? t('library.films')
        : t('library.series');

  useEffect(() => {
    loadRecentSearches();
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => setTerm(termOf(text)), TYPING_PAUSE_MS);
    return () => clearTimeout(timer);
  }, [text]);

  return (
    <View style={[styles.screen, { paddingTop: insets.top + space.m }]}>
      <Text style={styles.title} accessibilityRole="header">
        {t('phone.tabs.search')}
      </Text>
      <View style={styles.field}>
        <OutlineIcon name="search" size={20} color={colors.textMuted} weight={2.2} />
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder={t('search.placeholder')}
          placeholderTextColor={colors.textSubtle}
          style={styles.input}
          returnKeyType="search"
          autoCorrect={false}
          onFocus={() => reportTyping(true)}
          onBlur={() => reportTyping(false)}
          onSubmitEditing={() => {
            const now = termOf(text);
            setTerm(now);
            if (now) recentSearches.add(now);
          }}
          accessibilityLabel={t('search.label')}
        />
        {text ? (
          <Pressable
            onPress={() => setText('')}
            accessibilityRole="button"
            accessibilityLabel={t('phone.close')}
            style={styles.clearText}
          >
            <OutlineIcon name="close" size={18} color={colors.textMuted} />
          </Pressable>
        ) : null}
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.chips}
        contentContainerStyle={styles.chipsContent}
        keyboardShouldPersistTaps="handled"
      >
        {KINDS.map((value) => (
          <Chip
            key={value}
            label={kindLabel(value)}
            on={kind === value}
            onPress={() => setKind(value)}
          />
        ))}
      </ScrollView>
      {!ready ? null : sources.length === 0 && !sportsSources ? (
        <Message lead={t('search.noAddons')} />
      ) : term ? (
        <Results
          key={term}
          term={term}
          kind={kind}
          sources={sources}
          sportsSources={sportsSources}
          discover={discover}
          onPick={pick}
        />
      ) : recent.length > 0 ? (
        <View style={styles.recent}>
          <Text style={styles.heading}>{t('search.recent')}</Text>
          {recent.map((entry) => (
            <Pressable
              key={entry}
              onPress={() => {
                setText(entry);
                setTerm(entry);
              }}
              style={({ pressed }) => [styles.recentRow, pressed && styles.pressed]}
              accessibilityRole="button"
            >
              <Icon name="search" size={18} color={colors.textSubtle} />
              <Text style={styles.recentText}>{entry}</Text>
            </Pressable>
          ))}
          <Button
            kind="quiet"
            label={t('search.clearRecent')}
            onPress={() => recentSearches.clear()}
            style={styles.clear}
          />
        </View>
      ) : (
        <Message lead={t('search.hint')} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  title: { ...type.display, color: colors.text, paddingHorizontal: gutter, marginBottom: 14 },
  field: {
    marginHorizontal: gutter,
    minHeight: touch.min,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.surface2,
    borderRadius: 14,
    paddingLeft: 14,
  },
  input: { flex: 1, ...type.body, fontSize: 16, fontWeight: '600', color: colors.text },
  clearText: {
    width: touch.min,
    height: touch.min,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chips: { flexGrow: 0, marginTop: 14, marginBottom: space.s },
  chipsContent: { gap: space.s, paddingHorizontal: gutter },
  section: { paddingHorizontal: gutter, paddingTop: space.m, gap: space.m },
  sectionHeader: { flexDirection: 'row', alignItems: 'baseline', gap: space.s },
  sectionTitle: { ...type.heading, color: colors.text, flexShrink: 1 },
  sectionTag: { ...type.small, color: colors.textSubtle, flexShrink: 1 },
  result: { flexDirection: 'row', alignItems: 'center', gap: 14, borderRadius: radius.m },
  placeholder: { opacity: 0.6 },
  poster: {
    width: phone.resultPosterW,
    height: phone.resultPosterH,
    borderRadius: radius.m,
    backgroundColor: colors.surface2,
  },
  resultText: { flex: 1, gap: space.xs },
  resultName: { ...type.body, fontSize: 16, fontWeight: '700', color: colors.text },
  resultFacts: { ...type.meta, color: colors.textMuted },
  more: { alignSelf: 'flex-start', paddingHorizontal: 0 },
  fold: {
    marginHorizontal: gutter,
    marginTop: space.l,
    minHeight: touch.min,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s,
    borderRadius: radius.m,
  },
  foldText: { ...type.label, fontSize: 16, color: colors.text, flex: 1 },
  help: { padding: space.xl, gap: space.m, alignItems: 'flex-start' },
  lead: { ...type.body, color: colors.textMuted },
  meant: { minHeight: touch.min, justifyContent: 'center' },
  meantText: { ...type.label, fontSize: 16, color: colors.accent },
  genres: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s },
  small: { ...type.small, color: colors.textSubtle },
  note: { paddingHorizontal: gutter, paddingTop: space.xl },
  recent: { padding: gutter, gap: space.xs },
  heading: { ...type.heading, color: colors.text, marginBottom: space.s },
  recentRow: { flexDirection: 'row', alignItems: 'center', gap: space.m, minHeight: touch.min },
  pressed: { opacity: 0.6 },
  recentText: { ...type.body, color: colors.text },
  clear: { alignSelf: 'flex-start', paddingHorizontal: 0 },
  error: { gap: space.s, alignItems: 'flex-start' },
  muted: { ...type.body, color: colors.textMuted },
});
