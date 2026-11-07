import {
  type CatalogSource,
  kidsSearchSources,
  kidsTitleAllowed,
  searchSources,
} from '@bannertv/core';
import { addonClient, addonCollection } from '@tv/data/addons';
import { describeAddonError, typeLabel } from '@tv/data/describe';
import { isKidsProfile } from '@tv/data/profiles';
import { loadRecentSearches, recentSearches } from '@tv/data/search';
import { sportsState } from '@tv/data/sports';
import { useQuery } from '@tv/data/use-query';
import { memo, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import type { MetaPreview } from '@bannertv/protocol';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { openTitle } from '../nav/routes';
import { reportTyping } from '../runtime/whereabouts';
import { phone } from '@brand/tokens/design';
import { Artwork } from '../ui/Artwork';
import { Button } from '../ui/Button';
import { Chip } from '../ui/Chip';
import { Icon, OutlineIcon } from '../ui/icons';
import { Message } from '../ui/Message';
import { phoneArt } from '../ui/Tile';
import { colors, gutter, radius, space, touch, type } from '../ui/theme';

const TYPING_PAUSE_MS = 500;
/** Results shown per addon catalog before "Show all". */
const FIRST_RESULTS = 6;

type Kind = 'all' | 'movie' | 'series';
const KINDS: readonly Kind[] = ['all', 'movie', 'series'];

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

const ResultRow = memo(function ResultRow({
  source,
  term,
  tag,
  onFound,
}: {
  source: CatalogSource;
  term: string;
  tag: string;
  onFound: (key: string, count: number) => void;
}) {
  const { t } = useTranslation();
  const query = useMemo(
    () =>
      addonClient.catalog(
        source.addon,
        source.catalog.type,
        source.catalog.id,
        [['search', term]],
        {
          persist: false,
        },
      ),
    [source, term],
  );
  const state = useQuery(query);
  const items = useMemo(
    () =>
      state.data && isKidsProfile()
        ? state.data.filter((item) => kidsTitleAllowed(item))
        : state.data,
    [state.data],
  );
  useEffect(() => {
    if (state.status === 'success') onFound(source.key, items?.length ?? 0);
    if (state.status === 'error') onFound(source.key, 0);
  }, [state.status, items, onFound, source.key]);
  const [all, setAll] = useState(false);
  if (state.status === 'success' && items?.length === 0) return null;
  const shown = items ? (all ? items : items.slice(0, FIRST_RESULTS)) : null;
  const typeName = typeLabel(t, source.catalog.type);
  const open = (item: MetaPreview) => {
    recentSearches.add(term);
    openTitle(item);
  };
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle} numberOfLines={1}>
          {typeName}
        </Text>
        <Text style={styles.sectionTag} numberOfLines={1}>
          {tag}
        </Text>
      </View>
      {state.status === 'error' ? (
        <View style={styles.error}>
          <Text style={styles.muted}>
            {describeAddonError(t, state.error, source.addon.manifest.name)}
          </Text>
          <Button label={t('common.tryAgain')} onPress={() => query.retry()} />
        </View>
      ) : shown === null ? (
        <View style={[styles.result, styles.placeholder]}>
          <View style={styles.poster} />
        </View>
      ) : (
        <>
          {shown.map((item, index) => (
            <Result key={`${index}:${item.id}`} item={item} tag={typeName} onPress={open} />
          ))}
          {!all && items && items.length > FIRST_RESULTS ? (
            <Button
              kind="quiet"
              label={t('home.seeAll')}
              onPress={() => setAll(true)}
              style={styles.more}
            />
          ) : null}
        </>
      )}
    </View>
  );
});

function Results({ term, sources }: { term: string; sources: readonly CatalogSource[] }) {
  const { t } = useTranslation();
  const [found, setFound] = useState<Record<string, number>>({});
  const onFound = useMemo(
    () => (key: string, count: number) =>
      setFound((before) => (before[key] === count ? before : { ...before, [key]: count })),
    [],
  );
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
  const settled = sources.every((source) => found[source.key] !== undefined);
  const none = settled && sources.every((source) => found[source.key] === 0);
  return (
    <FlatList
      data={sources}
      keyExtractor={(source) => source.key}
      renderItem={({ item: source, index }) => (
        <ResultRow source={source} term={term} tag={tags[index]!} onFound={onFound} />
      )}
      ListFooterComponent={none ? <Message lead={t('search.nothingFound', { term })} /> : undefined}
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
  const ready = collection.ready && sports.ready;
  const sources = useMemo(() => {
    if (!ready) return [];
    // No Sports group on the phone yet, so sports addons' search stays in the list.
    const all = searchSources(collection.addons);
    return isKidsProfile() ? kidsSearchSources(all) : all;
  }, [ready, collection.addons]);
  const shownSources = useMemo(
    () => (kind === 'all' ? sources : sources.filter((source) => source.catalog.type === kind)),
    [sources, kind],
  );
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
      {!ready ? null : sources.length === 0 ? (
        <Message lead={t('search.noAddons')} />
      ) : term ? (
        <Results key={term} term={term} sources={shownSources} />
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
  recent: { padding: gutter, gap: space.xs },
  heading: { ...type.heading, color: colors.text, marginBottom: space.s },
  recentRow: { flexDirection: 'row', alignItems: 'center', gap: space.m, minHeight: touch.min },
  pressed: { opacity: 0.6 },
  recentText: { ...type.body, color: colors.text },
  clear: { alignSelf: 'flex-start', paddingHorizontal: 0 },
  error: { gap: space.s, alignItems: 'flex-start' },
  muted: { ...type.body, color: colors.textMuted },
});
