import { historyView, kidsTitleAllowed, libraryView, type LibraryKind } from '@bannertv/core';
import { library } from '@tv/data/library';
import { playedVideos, progress } from '@tv/data/playback';
import { isKidsProfile } from '@tv/data/profiles';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { libraryWatch } from '../data/library-watch';
import { openTitle } from '../nav/routes';
import { Chip } from '../ui/Chip';
import { Grid } from '../ui/Grid';
import { Message } from '../ui/Message';
import { colors, gutter, space, type } from '../ui/theme';

type Show = 'list' | 'history';

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
  const version = useSyncExternalStore(watches[show].subscribe, watches[show].version);

  useEffect(() => {
    void Promise.all([library.load(), progress.load(), playedVideos.load()])
      .catch(() => undefined)
      .then(() => setLoaded(true));
  }, []);

  const items = useMemo(() => {
    const shown =
      show === 'list'
        ? libraryView(library.items(), kind, 'added')
        : historyView(progress.recent(), playedVideos.get, kind);
    return isKidsProfile() ? shown.filter((item) => kidsTitleAllowed(item, true)) : shown;
    // `version` stands for the stores' contents.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, kind, version]);

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
      {loaded && items.length === 0 ? (
        <Message lead={show === 'list' ? t('library.emptyList') : t('library.emptyHistory')} />
      ) : null}
    </View>
  );

  return (
    <View style={styles.screen}>
      <Grid items={items} onPress={openTitle} header={header} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: { paddingBottom: space.m, gap: space.m },
  title: { ...type.display, color: colors.text, paddingHorizontal: gutter },
  chips: { flexDirection: 'row', gap: space.s, paddingHorizontal: gutter },
  kinds: { flexGrow: 0 },
});
