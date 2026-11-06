import {
  historyView,
  kidsTitleAllowed,
  type LibraryKind,
  type LibrarySort,
  libraryView,
  type PagerState,
} from '@bannertv/core';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { useScreenFocus } from '../../app/use-screen-focus';
import type { MenuOption } from '../../components/Menu';
import { Picker } from '../../components/Picker';
import { library } from '../../data/library';
import {
  fillLibraryCards,
  historyCard,
  historyCardsVersion,
  subscribeHistoryCards,
} from '../../data/library-cards';
import { playedVideos, progress } from '../../data/playback';
import { isKidsProfile } from '../../data/profiles';
import { PosterGrid } from '../discover/PosterGrid';
import { openDetails } from '../home/Hero';
import discover from '../discover/DiscoverScreen.module.css';

type LibraryShow = 'list' | 'history';

interface LibraryChoice {
  show: LibraryShow;
  kind: LibraryKind;
  sort: LibrarySort;
}

// Kept for the run, so the Library opens as it was left.
let lastChoice: LibraryChoice = { show: 'list', kind: 'all', sort: 'added' };

const subscribeAll = (listener: () => void) => {
  const undo = [
    library.subscribe(listener),
    progress.subscribe(listener),
    playedVideos.subscribe(listener),
    subscribeHistoryCards(listener),
  ];
  return () => undo.forEach((stop) => stop());
};
const versions = () =>
  `${library.version()}:${progress.version()}:${playedVideos.version()}:${historyCardsVersion()}`;

/**
 * The Library: My List (saved with the button on a title's page, and synced
 * with a Trakt watchlist) and History (everything this profile played), as
 * a grid of posters, by kind, in the chosen order.
 */
export function LibraryScreen() {
  const { t } = useTranslation();
  const [choice, setChoice] = useState(lastChoice);
  const [loaded, setLoaded] = useState(false);
  const version = useSyncExternalStore(subscribeAll, versions);

  useEffect(() => {
    let live = true;
    void Promise.all([library.load(), progress.load(), playedVideos.load()])
      .catch(() => undefined)
      .then(() => {
        if (live) setLoaded(true);
      });
    return () => {
      live = false;
    };
  }, []);

  // Titles from Trakt arrive without artwork: it is fetched while they are on show.
  const show = choice.show;
  useEffect(() => (loaded ? fillLibraryCards(show) : undefined), [loaded, show]);

  const items = useMemo(() => {
    const shown =
      choice.show === 'list'
        ? libraryView(library.items(), choice.kind, choice.sort)
        : historyView(progress.recent(), historyCard, choice.kind);
    // Titles that say they are not for children stay out of a kids profile's
    // Library; the rest open on Details, which checks them.
    return isKidsProfile() ? shown.filter((item) => kidsTitleAllowed(item, true)) : shown;
    // `version` changes with any of the stores read here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [choice, version]);
  const state: PagerState = { items, status: 'done' };
  // The grid picks its remembered tile, or the nearest one drawn. A tile
  // remembered from before a title left the list falls back to the grid.
  useScreenFocus(items.length > 0 ? 'discover-grid' : 'library-show', loaded, true);

  const choose = (change: Partial<LibraryChoice>) => {
    lastChoice = { ...choice, ...change };
    setChoice(lastChoice);
  };

  const showOptions: MenuOption[] = [
    { value: 'list', label: t('library.myList') },
    { value: 'history', label: t('library.history') },
  ];
  const kindOptions: MenuOption[] = [
    { value: 'all', label: t('library.all') },
    { value: 'movie', label: t('library.films') },
    { value: 'series', label: t('library.series') },
  ];
  const sortOptions: MenuOption[] = [
    { value: 'added', label: t('library.sortAdded') },
    { value: 'name', label: t('library.sortName') },
    { value: 'year', label: t('library.sortYear') },
  ];

  return (
    <div className={discover.screen}>
      <div className={discover.header}>
        <h1 className={discover.title}>{t('rail.library')}</h1>
        <div className={discover.pickers}>
          <Picker
            focusKey="library-show"
            label={t('library.show')}
            options={showOptions}
            value={choice.show}
            onChange={(show) => choose({ show: show as LibraryShow })}
          />
          <Picker
            focusKey="library-kind"
            label={t('library.kind')}
            options={kindOptions}
            value={choice.kind}
            onChange={(kind) => choose({ kind: kind as LibraryKind })}
          />
          {choice.show === 'list' && (
            <Picker
              focusKey="library-sort"
              label={t('library.sort')}
              options={sortOptions}
              value={choice.sort}
              onChange={(sort) => choose({ sort: sort as LibrarySort })}
            />
          )}
        </div>
      </div>
      {loaded && (
        <PosterGrid
          key={`${choice.show}|${choice.kind}|${choice.sort}`}
          memoryKey={`library:${choice.show}:${choice.kind}:${choice.sort}`}
          state={state}
          errorMessage=""
          emptyMessage={choice.show === 'list' ? t('library.emptyList') : t('library.emptyHistory')}
          onLoadMore={() => undefined}
          onRetry={() => undefined}
          onPress={openDetails}
          onFocusTile={() => undefined}
        />
      )}
    </div>
  );
}
