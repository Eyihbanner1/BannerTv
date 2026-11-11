import {
  catalogsFromManyAddons,
  createCatalogPager,
  type DiscoverSelection,
  discoverSelection,
  discoverSources,
  kidsDiscoverSources,
  kidsTitleAllowed,
  type PagerState,
  resolveDiscover,
} from '@bannertv/core';
import type { ExtraArg, MetaPreview } from '@bannertv/protocol';
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { push, router } from '../../app/router';
import { useScreenFocus } from '../../app/use-screen-focus';
import type { MenuOption } from '../../components/Menu';
import { Picker } from '../../components/Picker';
import { addonClient, addonCollection } from '../../data/addons';
import { describeAddonError, typeLabel } from '../../data/describe';
import { isKidsProfile } from '../../data/profiles';
import { forgetFocus } from '../../navigation/focus-memory';
import { eventForItem, noteFirstPage, prepareItems, sportsState } from '../../data/sports';
import { openDetails } from '../home/Hero';
import { gridTileKey, PosterGrid } from './PosterGrid';
import styles from './DiscoverScreen.module.css';

export type { DiscoverSelection };

interface Memory {
  selection?: DiscoverSelection;
  /** The last tile focused, so Back from a title can load enough pages to land on it. */
  index?: number;
}

// Per Discover screen for this session: the section itself, and each "See all" by its row.
const memories = new Map<string, Memory>();

function memoryFor(key: string): Memory {
  let memory = memories.get(key);
  if (!memory) {
    memory = {};
    memories.set(key, memory);
  }
  return memory;
}

/**
 * Forgets where the section's grid was, so it opens on its first tile. The
 * type, catalog and genre picked stay.
 */
function startSectionAtTop(): void {
  memoryFor('section').index = undefined;
  forgetFocus('discover:section:');
}

const IDLE: PagerState = { items: [], status: 'loading' };
const noSubscription = () => () => undefined;

/**
 * Browse one catalog at a time, with pickers for type, catalog and genre, as
 * a poster grid that loads more as the user moves down. "See all" on a Home
 * row opens this screen on that row's catalog.
 */
export function DiscoverScreen({ preset }: { preset?: DiscoverSelection }) {
  const { t } = useTranslation();
  const memoryKey = preset
    ? `see-all:${preset.transportUrl}|${preset.type}|${preset.catalogId}|${preset.genre ?? ''}`
    : 'section';
  // Opened from the menu (the only screen open), the section starts at the top,
  // before the grid reads its memory. What it remembers is for coming back from
  // a title. Kept, it drew the grid scrolled down while focus went to the first
  // tile, which was not drawn, so nothing had focus and the remote did nothing.
  useState(() => {
    if (!preset && router.get().stack.length === 1) startSectionAtTop();
  });
  const collection = useSyncExternalStore(addonCollection.subscribe, addonCollection.get);
  const sports = useSyncExternalStore(sportsState.subscribe, sportsState.get);
  // A kids profile browses Family catalogs only (ADR 0004), and has no Sports,
  // so sports catalogs leave its Discover as they leave its Home.
  const sources = useMemo(() => {
    const all = discoverSources(collection.addons);
    if (!isKidsProfile()) return all;
    const leaveOut = sports.homeLeaveOut;
    return kidsDiscoverSources(all).filter((s) => !leaveOut?.(s.addon, s.catalog));
  }, [collection.addons, sports.homeLeaveOut]);
  const [wanted, setWanted] = useState(() => memoryFor(memoryKey).selection ?? preset);
  const resolved = useMemo(() => resolveDiscover(sources, wanted), [sources, wanted]);
  const source = resolved?.source;
  const genre = resolved?.genre;

  const pager = useMemo(() => {
    if (!source) return null;
    const { addon, catalog } = source;
    const filter: ExtraArg[] = genre === undefined ? [] : [['genre', genre]];
    return createCatalogPager({
      pageable: source.pageable,
      page: (skip) =>
        addonClient.catalog(
          addon,
          catalog.type,
          catalog.id,
          skip > 0 ? filter.concat([['skip', String(skip)]]) : filter,
        ),
    });
  }, [source, genre]);
  const paged = useSyncExternalStore(
    pager ? pager.subscribe : noSubscription,
    pager ? pager.get : () => IDLE,
  );
  const state = useMemo(
    () =>
      isKidsProfile()
        ? { ...paged, items: paged.items.filter((item) => kidsTitleAllowed(item, true)) }
        : paged,
    [paged],
  );

  // The first page, then, on return from a title, enough pages to reach the tile left.
  const restoreTo = memoryFor(memoryKey).index;
  useEffect(() => {
    if (!pager) return;
    const { status, items } = pager.get();
    if (
      items.length === 0 ||
      (status === 'ready' && restoreTo !== undefined && items.length <= restoreTo)
    ) {
      pager.loadMore();
    }
  }, [pager, state, restoreTo]);

  // What a first page looked like settles whether a catalog is sport (data/sports.ts).
  const firstItems = paged.items.length > 0 ? paged.items : null;
  useEffect(() => {
    if (source && genre === undefined && firstItems) {
      noteFirstPage(source.addon, source.catalog, firstItems);
    }
  }, [source, genre, firstItems]);

  // A match in a sports catalog opens its event page, which asks only this addon. The
  // list is read for its clock-only times once drawn, not on the press. A kids
  // profile never opens an event page: every title goes through Details' checks.
  const items = state.items;
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
      if (event) push({ name: 'event', event });
      else openDetails(item);
    },
    [sportsSource],
  );

  const restored =
    restoreTo === undefined ||
    state.items.length > restoreTo ||
    state.status === 'done' ||
    state.status === 'error';
  useScreenFocus(gridTileKey(0), collection.ready && restored);

  const choose = (selection: DiscoverSelection) => {
    const memory = memoryFor(memoryKey);
    memory.selection = selection;
    memory.index = undefined;
    setWanted(selection);
  };

  if (collection.ready && !resolved) {
    return (
      <div className={styles.screen}>
        <div className={styles.header}>
          <h1 className={styles.title}>{t('rail.discover')}</h1>
        </div>
        <p className={styles.message}>{t('discover.noCatalogs')}</p>
      </div>
    );
  }

  const typeOptions: MenuOption[] = resolved
    ? resolved.types.map((type) => ({ value: type, label: typeLabel(t, type) }))
    : [];
  const manyAddons = resolved ? catalogsFromManyAddons(resolved) : false;
  const catalogOptions: MenuOption[] = resolved
    ? resolved.ofType.map((s) => ({
        value: s.key,
        label: manyAddons ? `${s.catalog.name} · ${s.addon.manifest.name}` : s.catalog.name,
      }))
    : [];
  const genreOptions: MenuOption[] =
    source && source.genres.length > 0
      ? (source.genreRequired ? [] : [{ value: '', label: t('discover.allGenres') }]).concat(
          source.genres.map((g) => ({ value: g, label: g })),
        )
      : [];

  return (
    <div className={styles.screen}>
      <div className={styles.header}>
        <h1 className={styles.title}>{t('rail.discover')}</h1>
        {resolved && source && (
          <div className={styles.pickers}>
            <Picker
              focusKey="discover-type"
              label={t('discover.type')}
              options={typeOptions}
              value={source.catalog.type}
              onChange={(type) => choose({ type, transportUrl: '', catalogId: '' })}
            />
            <Picker
              focusKey="discover-catalog"
              label={t('discover.catalog')}
              options={catalogOptions}
              value={source.key}
              onChange={(key) => {
                const next = resolved.ofType.find((s) => s.key === key);
                if (next) choose(discoverSelection(next, genre));
              }}
            />
            {genreOptions.length > 0 && (
              <Picker
                focusKey="discover-genre"
                label={t('discover.genre')}
                options={genreOptions}
                value={genre ?? ''}
                onChange={(value) =>
                  choose(discoverSelection(source, value === '' ? undefined : value))
                }
              />
            )}
          </div>
        )}
      </div>
      {source && (
        <PosterGrid
          key={`${source.key}|${genre ?? ''}`}
          memoryKey={`discover:${memoryKey}:${source.key}:${genre ?? ''}`}
          state={state}
          errorMessage={describeAddonError(t, state.error, source.addon.manifest.name)}
          emptyMessage={t('discover.empty')}
          onLoadMore={() => pager?.loadMore()}
          onRetry={() => pager?.retry()}
          onPress={onPress}
          onFocusTile={(index) => {
            memoryFor(memoryKey).index = index;
          }}
        />
      )}
    </div>
  );
}
