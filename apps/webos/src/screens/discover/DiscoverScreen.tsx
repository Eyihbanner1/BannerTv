import {
  createCatalogPager,
  type DiscoverSource,
  discoverSources,
  orderedTypes,
  type PagerState,
} from '@bannertv/core';
import type { ExtraArg, MetaPreview } from '@bannertv/protocol';
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { push } from '../../app/router';
import { useScreenFocus } from '../../app/use-screen-focus';
import type { MenuOption } from '../../components/Menu';
import { Picker } from '../../components/Picker';
import { addonClient, addonCollection } from '../../data/addons';
import { describeAddonError, typeLabel } from '../../data/describe';
import { eventsFromItems, noteFirstPage } from '../../data/sports';
import { openDetails } from '../home/Hero';
import { gridTileKey, PosterGrid } from './PosterGrid';
import styles from './DiscoverScreen.module.css';

/** What Discover shows. Kept by addon URL and catalog id, which survive reordering. */
export interface DiscoverSelection {
  type: string;
  transportUrl: string;
  catalogId: string;
  genre?: string;
}

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

const IDLE: PagerState = { items: [], status: 'loading' };
const noSubscription = () => () => undefined;

interface Resolved {
  types: string[];
  ofType: DiscoverSource[];
  source: DiscoverSource;
  genre: string | undefined;
}

/** Turns a wish into what the addons can do now: an unknown catalog falls back to the first of its type. */
function resolve(
  sources: readonly DiscoverSource[],
  wanted: DiscoverSelection | undefined,
): Resolved | null {
  const types = orderedTypes(sources);
  if (types.length === 0) return null;
  const type = wanted && types.indexOf(wanted.type) !== -1 ? wanted.type : types[0]!;
  const ofType = sources.filter((s) => s.catalog.type === type);
  const source =
    (wanted &&
      ofType.find(
        (s) => s.addon.transportUrl === wanted.transportUrl && s.catalog.id === wanted.catalogId,
      )) ||
    ofType[0]!;
  let genre = wanted?.genre;
  if (genre !== undefined && source.genres.indexOf(genre) === -1) genre = undefined;
  if (genre === undefined && source.genreRequired) genre = source.genres[0];
  return { types, ofType, source, genre };
}

function selectionOf(source: DiscoverSource, genre: string | undefined): DiscoverSelection {
  return {
    type: source.catalog.type,
    transportUrl: source.addon.transportUrl,
    catalogId: source.catalog.id,
    genre,
  };
}

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
  const collection = useSyncExternalStore(addonCollection.subscribe, addonCollection.get);
  const sources = useMemo(() => discoverSources(collection.addons), [collection.addons]);
  const [wanted, setWanted] = useState(() => memoryFor(memoryKey).selection ?? preset);
  const resolved = useMemo(() => resolve(sources, wanted), [sources, wanted]);
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
  const state = useSyncExternalStore(
    pager ? pager.subscribe : noSubscription,
    pager ? pager.get : () => IDLE,
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
  const firstItems = state.items.length > 0 ? state.items : null;
  useEffect(() => {
    if (source && genre === undefined && firstItems) {
      noteFirstPage(source.addon, source.catalog, firstItems);
    }
  }, [source, genre, firstItems]);

  // A match in a sports catalog opens its event page, which asks only this addon.
  const onPress = useCallback(
    (item: MetaPreview) => {
      const [event, ...more] = source ? eventsFromItems(source.addon, source.catalog, [item]) : [];
      if (event && more.length === 0 && event.kind !== 'channel') push({ name: 'event', event });
      else openDetails(item);
    },
    [source],
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
  const manyAddons = resolved
    ? resolved.ofType.some((s) => s.addon !== resolved.ofType[0]!.addon)
    : false;
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
                if (next) choose(selectionOf(next, genre));
              }}
            />
            {genreOptions.length > 0 && (
              <Picker
                focusKey="discover-genre"
                label={t('discover.genre')}
                options={genreOptions}
                value={genre ?? ''}
                onChange={(value) => choose(selectionOf(source, value === '' ? undefined : value))}
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
