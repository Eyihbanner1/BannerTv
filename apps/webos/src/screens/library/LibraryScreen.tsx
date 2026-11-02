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
import { useCalendar } from '../../data/calendar';
import { library } from '../../data/library';
import { playedVideos, progress } from '../../data/playback';
import { isKidsProfile } from '../../data/profiles';
import { PosterGrid } from '../discover/PosterGrid';
import { openDetails } from '../home/Hero';
import { CalendarList } from './CalendarList';
import discover from '../discover/DiscoverScreen.module.css';

type LibraryShow = 'list' | 'history' | 'calendar';

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
  ];
  return () => undo.forEach((stop) => stop());
};
const versions = () => `${library.version()}:${progress.version()}:${playedVideos.version()}`;

/**
 * The Library: My List (saved with the button on a title's page, and synced
 * with a Trakt watchlist) and History (everything this profile played), as
 * a grid of posters, by kind, in the chosen order; and the Calendar, the
 * next episodes of the series it follows and the films on its list, by day.
 */
export function LibraryScreen() {
  const { t } = useTranslation();
  const [choice, setChoice] = useState(lastChoice);
  const [loaded, setLoaded] = useState(false);
  const version = useSyncExternalStore(subscribeAll, versions);
  const showCalendar = choice.show === 'calendar';
  const calendar = useCalendar(choice.kind, showCalendar);

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

  const items = useMemo(() => {
    if (choice.show === 'calendar') return [];
    const shown =
      choice.show === 'list'
        ? libraryView(library.items(), choice.kind, choice.sort)
        : historyView(progress.recent(), playedVideos.get, choice.kind);
    // Titles that say they are not for children stay out of a kids profile's
    // Library; the rest open on Details, which checks them.
    return isKidsProfile() ? shown.filter((item) => kidsTitleAllowed(item, true)) : shown;
    // `version` changes with any of the stores read here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [choice, version]);
  const state: PagerState = { items, status: 'done' };
  // The calendar is drawn once every followed title has answered, so its rows
  // do not move under the remote.
  const calendarReady = showCalendar && !calendar.loading;
  const hasRows = showCalendar ? calendarReady && calendar.days.length > 0 : items.length > 0;
  // The grid picks its remembered tile, or the nearest one drawn. A tile
  // remembered from before a title left the list falls back to the grid.
  useScreenFocus(
    hasRows ? (showCalendar ? 'library-calendar' : 'discover-grid') : 'library-show',
    loaded && (!showCalendar || calendarReady),
    true,
  );

  const choose = (change: Partial<LibraryChoice>) => {
    lastChoice = { ...choice, ...change };
    setChoice(lastChoice);
  };

  const showOptions: MenuOption[] = [
    { value: 'list', label: t('library.myList') },
    { value: 'history', label: t('library.history') },
    { value: 'calendar', label: t('calendar.show') },
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
      {loaded && showCalendar && !calendarReady && (
        <p className={discover.message}>{t('calendar.loading')}</p>
      )}
      {calendarReady && calendar.days.length === 0 && (
        <p className={discover.message}>{t('calendar.empty')}</p>
      )}
      {calendarReady && calendar.days.length > 0 && (
        <CalendarList
          key={choice.kind}
          focusKey="library-calendar"
          days={calendar.days}
          onPress={openDetails}
        />
      )}
      {loaded && !showCalendar && (
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
