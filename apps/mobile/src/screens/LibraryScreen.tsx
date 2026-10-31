import { historyView, kidsTitleAllowed, libraryView, type LibraryKind } from '@bannertv/core';
import { library } from '@tv/data/library';
import { playedVideos, progress } from '@tv/data/playback';
import { isKidsProfile } from '@tv/data/profiles';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { openTitle } from '../nav/routes';
import { Grid } from '../ui/Grid';
import { Message } from '../ui/Message';
import { colors, radius, space, type } from '../ui/theme';

type Show = 'list' | 'history';

const subscribeAll = (listener: () => void) => {
  const undo = [
    library.subscribe(listener),
    progress.subscribe(listener),
    playedVideos.subscribe(listener),
  ];
  return () => undo.forEach((stop) => stop());
};
const versions = () => `${library.version()}:${progress.version()}:${playedVideos.version()}`;

function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      style={[styles.chip, on && styles.chipOn]}
    >
      <Text style={[styles.chipText, on && styles.chipTextOn]}>{label}</Text>
    </Pressable>
  );
}

export function LibraryScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const version = useSyncExternalStore(subscribeAll, versions);
  const [loaded, setLoaded] = useState(false);
  const [show, setShow] = useState<Show>('list');
  const [kind, setKind] = useState<LibraryKind>('all');

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
      <View style={styles.chips}>
        <Chip label={t('library.myList')} on={show === 'list'} onPress={() => setShow('list')} />
        <Chip
          label={t('library.history')}
          on={show === 'history'}
          onPress={() => setShow('history')}
        />
      </View>
      <View style={styles.chips}>
        <Chip label={t('library.all')} on={kind === 'all'} onPress={() => setKind('all')} />
        <Chip label={t('library.films')} on={kind === 'movie'} onPress={() => setKind('movie')} />
        <Chip
          label={t('library.series')}
          on={kind === 'series'}
          onPress={() => setKind('series')}
        />
      </View>
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
  header: { paddingBottom: space.m, gap: space.s },
  chips: { flexDirection: 'row', gap: space.s, paddingHorizontal: space.l },
  chip: {
    paddingHorizontal: space.l,
    paddingVertical: space.s,
    borderRadius: radius.pill,
    backgroundColor: colors.surface2,
  },
  chipOn: { backgroundColor: colors.action },
  chipText: { ...type.label, color: colors.textMuted },
  chipTextOn: { color: colors.text },
});
