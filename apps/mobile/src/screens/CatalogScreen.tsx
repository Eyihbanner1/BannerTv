import {
  catalogsFromManyAddons,
  createCatalogPager,
  type DiscoverSelection,
  discoverSelection,
  discoverSources,
  kidsDiscoverSources,
  kidsTitleAllowed,
  resolveDiscover,
} from '@bannertv/core';
import type { MetaPreview } from '@bannertv/protocol';
import { addonClient, addonCollection } from '@tv/data/addons';
import { describeAddonError, typeLabel } from '@tv/data/describe';
import { isKidsProfile } from '@tv/data/profiles';
import { eventForItem, noteFirstPage, prepareItems, sportsState } from '@tv/data/sports';
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import type { CatalogRoute } from '../nav/routes';
import { openEvent, openTitle } from '../nav/routes';
import { Button } from '../ui/Button';
import { Chip } from '../ui/Chip';
import { ChipRow } from '../ui/ChipRow';
import { Grid } from '../ui/Grid';
import { Message } from '../ui/Message';
import { ScreenHeader } from '../ui/ScreenHeader';
import { colors, space, type } from '../ui/theme';

const IDLE = { items: [], status: 'loading' as const };
const noop = () => () => undefined;

// What each Browse showed last, for this run: Browse itself, and each See all by its row.
const memories = new Map<string, DiscoverSelection>();

/**
 * One line of chips that scrolls sideways when it does not fit, opening on the chosen one: a
 * genre remembered from last time may be far along the row.
 */
function ChipLine({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <ChipRow
      selected={options.findIndex((option) => option.value === value)}
      accessibilityLabel={label}
    >
      {options.map((option) => (
        <Chip
          key={option.value}
          label={option.label}
          on={option.value === value}
          onPress={() => onChange(option.value)}
        />
      ))}
    </ChipRow>
  );
}

/**
 * Browse, as the TV's Discover: a type, one of its catalogs and a genre, as
 * chips over a poster grid that loads more as it scrolls. A Home row's See
 * all opens it on that row's catalog, under the row's name.
 */
export function CatalogScreen({ route }: { route?: CatalogRoute }) {
  const { t } = useTranslation();
  const memoryKey = route
    ? `see-all:${route.transportUrl}|${route.type}|${route.catalogId}|${route.genre ?? ''}`
    : 'browse';
  const collection = useSyncExternalStore(addonCollection.subscribe, addonCollection.get);
  const sports = useSyncExternalStore(sportsState.subscribe, sportsState.get);
  // A kids profile browses Family catalogs only, and no sport, as on the TV.
  const sources = useMemo(() => {
    const all = discoverSources(collection.addons);
    if (!isKidsProfile()) return all;
    const leaveOut = sports.homeLeaveOut;
    return kidsDiscoverSources(all).filter((s) => !leaveOut?.(s.addon, s.catalog));
  }, [collection.addons, sports.homeLeaveOut]);
  const [wanted, setWanted] = useState<DiscoverSelection | undefined>(
    () => memories.get(memoryKey) ?? route,
  );
  const resolved = useMemo(() => resolveDiscover(sources, wanted), [sources, wanted]);
  const source = resolved?.source;
  const genre = resolved?.genre;
  const choose = (selection: DiscoverSelection) => {
    memories.set(memoryKey, selection);
    setWanted(selection);
  };

  const pager = useMemo(() => {
    if (!source) return null;
    const filter: Array<readonly [string, string]> = genre === undefined ? [] : [['genre', genre]];
    return createCatalogPager({
      pageable: source.pageable,
      page: (skip) =>
        addonClient.catalog(
          source.addon,
          source.catalog.type,
          source.catalog.id,
          skip > 0 ? filter.concat([['skip', String(skip)]]) : filter,
        ),
    });
  }, [source, genre]);
  const paged = useSyncExternalStore(
    pager ? pager.subscribe : noop,
    pager ? pager.get : () => IDLE,
  );
  useEffect(() => {
    if (pager && pager.get().items.length === 0) pager.loadMore();
  }, [pager, paged]);
  // What a first page looked like settles whether a catalog is sport.
  useEffect(() => {
    if (source && genre === undefined && paged.items.length > 0) {
      noteFirstPage(source.addon, source.catalog, paged.items);
    }
  }, [source, genre, paged.items]);
  const items = useMemo(
    () =>
      isKidsProfile() ? paged.items.filter((item) => kidsTitleAllowed(item, true)) : paged.items,
    [paged.items],
  );

  // A match in a sports catalog opens its event page; a kids profile never does.
  const sportsSource = isKidsProfile() ? undefined : source;
  useEffect(
    () =>
      sportsSource ? prepareItems(sportsSource.addon, sportsSource.catalog, items) : undefined,
    [sportsSource, items],
  );
  const onPress = useCallback(
    (item: MetaPreview) => {
      const event = sportsSource
        ? eventForItem(sportsSource.addon, sportsSource.catalog, item)
        : undefined;
      if (event) openEvent(event);
      else openTitle(item);
    },
    [sportsSource],
  );

  const footer =
    paged.status === 'loading' ? (
      <ActivityIndicator color={colors.accent} style={styles.spinner} />
    ) : paged.status === 'error' && source ? (
      <View style={styles.error}>
        <Text style={styles.muted}>
          {describeAddonError(t, paged.error, source.addon.manifest.name)}
        </Text>
        <Button label={t('common.tryAgain')} onPress={() => pager?.retry()} />
      </View>
    ) : paged.status === 'done' && items.length === 0 ? (
      <Message lead={t('discover.empty')} />
    ) : undefined;

  const header =
    resolved && source ? (
      <View style={styles.pickers}>
        {resolved.types.length > 1 ? (
          <ChipLine
            label={t('discover.type')}
            options={resolved.types.map((value) => ({ value, label: typeLabel(t, value) }))}
            value={source.catalog.type}
            onChange={(value) => choose({ type: value, transportUrl: '', catalogId: '' })}
          />
        ) : null}
        {resolved.ofType.length > 1 ? (
          <ChipLine
            label={t('discover.catalog')}
            options={resolved.ofType.map((s) => ({
              value: s.key,
              label: catalogsFromManyAddons(resolved)
                ? `${s.catalog.name} · ${s.addon.manifest.name}`
                : s.catalog.name,
            }))}
            value={source.key}
            onChange={(key) => {
              const next = resolved.ofType.find((s) => s.key === key);
              if (next) choose(discoverSelection(next, genre));
            }}
          />
        ) : null}
        {source.genres.length > 0 ? (
          <ChipLine
            label={t('discover.genre')}
            options={(source.genreRequired
              ? []
              : [{ value: '', label: t('discover.allGenres') }]
            ).concat(source.genres.map((value) => ({ value, label: value })))}
            value={genre ?? ''}
            onChange={(value) =>
              choose(discoverSelection(source, value === '' ? undefined : value))
            }
          />
        ) : null}
      </View>
    ) : undefined;

  return (
    <View style={styles.screen}>
      <ScreenHeader title={route?.title ?? t('rail.discover')} />
      {!collection.ready ? null : !resolved ? (
        <Message lead={t('discover.noCatalogs')} />
      ) : (
        <Grid
          // A new catalog or genre starts again at the top.
          key={`${source?.key}|${genre ?? ''}`}
          items={items}
          onPress={onPress}
          {...(header ? { header } : {})}
          {...(footer ? { footer } : {})}
          onEndReached={() => pager?.loadMore()}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  pickers: { gap: space.s, paddingBottom: space.m },
  spinner: { padding: space.xl },
  error: { padding: space.l, gap: space.s, alignItems: 'flex-start' },
  muted: { ...type.body, color: colors.textMuted },
});
