import { historyView, kidsTitleAllowed, libraryView, type LibraryKind } from '@bannertv/core';
import { useCalendar } from '@tv/data/calendar';
import { library } from '@tv/data/library';
import { playedVideos, progress } from '@tv/data/playback';
import { isKidsProfile } from '@tv/data/profiles';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { libraryWatch } from '../data/library-watch';
import { openTitle } from '../nav/routes';
import { CalendarList } from '../ui/CalendarList';
import { Chip } from '../ui/Chip';
import { Grid } from '../ui/Grid';
import { Message } from '../ui/Message';
import { colors, gutter, space, type } from '../ui/theme';

type Show = 'list' | 'history' | 'calendar';

// My List follows the list alone, so the tab (which stays mounted under the player) is left as
// it is while a video saves its place every 10 seconds; History follows its stores too.
const watches = {
  list: libraryWatch('list', library, []),
  history: libraryWatch('history', library, [progress, playedVideos]),
} as const;

export function LibraryScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [loaded, setLoaded] = useState(false);
  const [show, setShow] = useState<Show>('list');
  const [kind, setKind] = useState<LibraryKind>('all');
  const calendar = useCalendar(kind, show === 'calendar');
  // The calendar keeps its own list, so it follows My List's stores, which it never reads.
  const watch = watches[show === 'history' ? 'history' : 'list'];
  const version = useSyncExternalStore(watch.subscribe, watch.version);

  useEffect(() => {
    void Promise.all([library.load(), progress.load(), playedVideos.load()])
      .catch(() => undefined)
      .then(() => setLoaded(true));
  }, []);

  const items = useMemo(() => {
    if (show === 'calendar') return [];
    const shown =
      show === 'list'
        ? libraryView(library.items(), kind, 'added')
        : historyView(progress.recent(), playedVideos.get, kind);
    return isKidsProfile() ? shown.filter((item) => kidsTitleAllowed(item, true)) : shown;
    // `version` stands for the stores' contents.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, kind, version]);

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
        <CalendarList days={calendar.days} onPress={openTitle} header={header} />
      ) : (
        <Grid items={items} onPress={openTitle} header={header} />
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
