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
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { openTitle } from '../nav/routes';
import { reportTyping } from '../runtime/whereabouts';
import { Button } from '../ui/Button';
import { Icon } from '../ui/icons';
import { Message } from '../ui/Message';
import { Row } from '../ui/Row';
import { colors, radius, space, type } from '../ui/theme';

const TYPING_PAUSE_MS = 500;
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
  if (state.status === 'success' && items?.length === 0) return null;
  return (
    <Row
      title={typeLabel(t, source.catalog.type)}
      tag={tag}
      shape="poster"
      items={items?.map((item, index) => ({ item, key: `${index}:${item.id}` })) ?? null}
      onPress={(entry) => {
        recentSearches.add(term);
        openTitle(entry.item);
      }}
      footer={
        state.status === 'error' ? (
          <View style={styles.error}>
            <Text style={styles.muted}>
              {describeAddonError(t, state.error, source.addon.manifest.name)}
            </Text>
            <Button label={t('common.tryAgain')} onPress={() => query.retry()} />
          </View>
        ) : undefined
      }
    />
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

  useEffect(() => {
    loadRecentSearches();
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => setTerm(termOf(text)), TYPING_PAUSE_MS);
    return () => clearTimeout(timer);
  }, [text]);

  return (
    <View style={[styles.screen, { paddingTop: insets.top + space.s }]}>
      <View style={styles.field}>
        <Icon name="search" size={22} color={colors.textSubtle} />
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
          <Pressable onPress={() => setText('')} hitSlop={10} accessibilityLabel={t('phone.close')}>
            <Icon name="close" size={20} color={colors.textSubtle} />
          </Pressable>
        ) : null}
      </View>
      {!ready ? null : sources.length === 0 ? (
        <Message lead={t('search.noAddons')} />
      ) : term ? (
        <Results key={term} term={term} sources={sources} />
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
  field: {
    marginHorizontal: space.l,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s,
    backgroundColor: colors.surface2,
    borderRadius: radius.m,
    paddingHorizontal: space.m,
  },
  input: { flex: 1, ...type.body, color: colors.text, paddingVertical: space.m },
  recent: { padding: space.l, gap: space.xs },
  heading: { ...type.heading, color: colors.text, marginBottom: space.s },
  recentRow: { flexDirection: 'row', alignItems: 'center', gap: space.m, paddingVertical: space.s },
  pressed: { opacity: 0.6 },
  recentText: { ...type.body, color: colors.text },
  clear: { alignSelf: 'flex-start', paddingHorizontal: 0 },
  error: { paddingHorizontal: space.l, gap: space.s, alignItems: 'flex-start' },
  muted: { ...type.body, color: colors.textMuted },
});
