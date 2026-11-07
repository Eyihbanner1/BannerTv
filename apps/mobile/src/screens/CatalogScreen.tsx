import { createCatalogPager, discoverSources, kidsTitleAllowed } from '@bannertv/core';
import { addonClient, addonCollection } from '@tv/data/addons';
import { describeAddonError } from '@tv/data/describe';
import { isKidsProfile } from '@tv/data/profiles';
import { noteFirstPage } from '@tv/data/sports';
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import type { CatalogRoute } from '../nav/routes';
import { openTitle } from '../nav/routes';
import { Button } from '../ui/Button';
import { Grid } from '../ui/Grid';
import { Message } from '../ui/Message';
import { ScreenHeader } from '../ui/ScreenHeader';
import { colors, space, type } from '../ui/theme';

const IDLE = { items: [], status: 'loading' as const };
const noop = () => () => undefined;

/** "See all": one catalog, a page at a time, as the TV's Discover opens from a row. */
export function CatalogScreen({ route }: { route: CatalogRoute }) {
  const { t } = useTranslation();
  const collection = useSyncExternalStore(addonCollection.subscribe, addonCollection.get);
  const source = useMemo(
    () =>
      discoverSources(collection.addons).find(
        (candidate) =>
          candidate.addon.transportUrl === route.transportUrl &&
          candidate.catalog.id === route.catalogId &&
          candidate.catalog.type === route.type,
      ),
    [collection.addons, route],
  );
  const pager = useMemo(() => {
    if (!source) return null;
    const filter: Array<readonly [string, string]> = route.genre ? [['genre', route.genre]] : [];
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
  }, [source, route.genre]);
  const paged = useSyncExternalStore(
    pager ? pager.subscribe : noop,
    pager ? pager.get : () => IDLE,
  );
  useEffect(() => {
    if (pager && pager.get().items.length === 0) pager.loadMore();
  }, [pager, paged]);
  useEffect(() => {
    if (source && !route.genre && paged.items.length > 0) {
      noteFirstPage(source.addon, source.catalog, paged.items);
    }
  }, [source, route.genre, paged.items]);
  const items = useMemo(
    () =>
      isKidsProfile() ? paged.items.filter((item) => kidsTitleAllowed(item, true)) : paged.items,
    [paged.items],
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

  return (
    <View style={styles.screen}>
      <ScreenHeader title={route.title} />
      {!collection.ready ? null : !source ? (
        <Message lead={t('discover.noCatalogs')} />
      ) : (
        <Grid
          items={items}
          onPress={openTitle}
          {...(footer ? { footer } : {})}
          onEndReached={() => pager?.loadMore()}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  spinner: { padding: space.xl },
  error: { padding: space.l, gap: space.s, alignItems: 'flex-start' },
  muted: { ...type.body, color: colors.textMuted },
});
