import { historyView, kidsTitleAllowed, libraryView, type LibraryKind } from '@bannertv/core';
import { useCalendar } from '@tv/data/calendar';
import { library } from '@tv/data/library';
import {
  fillLibraryCards,
  historyCard,
  historyCardsVersion,
  subscribeHistoryCards,
} from '@tv/data/library-cards';
import { playedVideos, progress } from '@tv/data/playback';
import { isKidsProfile } from '@tv/data/profiles';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { libraryWatch, type Watch } from '../data/library-watch';
import { syncForRefresh } from '../data/refresh';
import { openTitle } from '../nav/routes';
import { CalendarList } from '../ui/CalendarList';
import { Chip } from '../ui/Chip';
import { Grid } from '../ui/Grid';
import { Message } from '../ui/Message';
import { colors, gutter, space, type } from '../ui/theme';
import { usePullRefresh } from '../ui/use-pull-refresh';

type Show = 'list' | 'history' | 'calendar';

// My List follows the list alone, so the tab (which stays mounted under the player) is left as
// it is while a video saves its place every 10 seconds; History follows its stores too, and the
// cards made for titles that came from Trakt. The calendar follows its own (useCalendar), and
// only while it is on show: the screen itself needs no more for it than My List does.
const listWatch = libraryWatch('list', library, []);
const historyCards = { subscribe: subscribeHistoryCards, version: historyCardsVersion };
const watches: Readonly<Record<Show, Watch>> = {
  list: listWatch,
  history: libraryWatch('history', library, [progress, playedVideos, historyCards]),
  calendar: listWatch,
};

export function LibraryScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [loaded, setLoaded] = useState(false);
  const [show, setShow] = useState<Show>('list');
  const [kind, setKind] = useState<LibraryKind>('all');
  const version = useSyncExternalStore(watches[show].subscribe, watches[show].version);
  const calendar = useCalendar(kind, show === 'calendar');

  useEffect(() => {
    void Promise.all([library.load(), progress.load(), playedVideos.load()])
      .catch(() => undefined)
      .then(() => setLoaded(true));
  }, []);

  // Titles from Trakt arrive without artwork: it is fetched while this tab is the one on
  // show (it stays mounted behind the others).
  useFocusEffect(
    useCallback(
      () => (loaded && show !== 'calendar' ? fillLibraryCards(show) : undefined),
      [loaded, show],
    ),
  );

  const items = useMemo(() => {
    if (show === 'calendar') return [];
    const shown =
      show === 'list'
        ? libraryView(library.items(), kind, 'added')
        : historyView(progress.recent(), historyCard, kind);
    return isKidsProfile() ? shown.filter((item) => kidsTitleAllowed(item, true)) : shown;
    // `version` stands for the stores' contents.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, kind, version]);

  // Pull to refresh brings in what other screens and Trakt have, then asks for the artwork of
  // what came. The tab's own watch above keeps that going; this one only queues it.
  const refreshControl = usePullRefresh(() =>
    syncForRefresh().then(() => {
      if (loaded && show !== 'calendar') fillLibraryCards(show)();
    }),
  );

  // The calendar fills in as titles answer: the phone scrolls, so rows may move.
  let message: string | null = null;
  if (show === 'calendar') {
    if (calendar.days.length === 0) {
      message = calendar.loading ? t('calendar.loading') : t('calendar.empty');
    }
  } else if (loaded && items.length === 0) {
    message = show === 'list' ? t('library.emptyList') : t('library.emptyHistory');
  }

  const header = (
    <View style={[styles.header, { paddingTop: insets.top + space.m }]}>
      <Text style={styles.title} accessibilityRole="header">
        {t('phone.tabs.library')}
      </Text>
      <View style={styles.chips}>
        <Chip label={t('library.myList')} on={show === 'list'} onPress={() => setShow('list')} />
        <Chip
          label={t('library.history')}
          on={show === 'history'}
          onPress={() => setShow('history')}
        />
        <Chip
          label={t('calendar.show')}
          on={show === 'calendar'}
          onPress={() => setShow('calendar')}
        />
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.kinds}
        contentContainerStyle={styles.chips}
      >
        <Chip label={t('library.all')} on={kind === 'all'} onPress={() => setKind('all')} />
        <Chip label={t('library.films')} on={kind === 'movie'} onPress={() => setKind('movie')} />
        <Chip
          label={t('library.series')}
          on={kind === 'series'}
          onPress={() => setKind('series')}
        />
      </ScrollView>
      {show === 'calendar' && calendar.days.length > 0 ? (
        <Text style={styles.lead}>{t('calendar.lead')}</Text>
      ) : null}
      {message ? <Message lead={message} /> : null}
    </View>
  );

  return (
    <View style={styles.screen}>
      {show === 'calendar' ? (
        <CalendarList
          days={calendar.days}
          onPress={openTitle}
          header={header}
          refreshControl={refreshControl}
        />
      ) : (
        <Grid items={items} onPress={openTitle} header={header} refreshControl={refreshControl} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: { paddingBottom: space.m, gap: space.m },
  title: { ...type.display, color: colors.text, paddingHorizontal: gutter },
  chips: { flexDirection: 'row', gap: space.s, paddingHorizontal: gutter },
  kinds: { flexGrow: 0 },
  lead: { ...type.meta, color: colors.textMuted, paddingHorizontal: gutter },
});
