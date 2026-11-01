import { kidsTitleAllowed, libraryView } from '@bannertv/core';
import { library } from '@tv/data/library';
import { isKidsProfile } from '@tv/data/profiles';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { openTitle } from '../nav/routes';
import { NavBar, type NavTarget } from '../ui/NavBar';
import { Tile, tileSize } from '../ui/Tile';
import { color, layout, px, spacing, type } from '../ui/theme';

const COLUMNS = 7;

/** Where focus goes when My List is on top again: a nav item, or the title that was opened. */
type Back = { kind: 'nav'; target: NavTarget } | { kind: 'title'; id: string };

/** My List: the titles this profile kept, newest first. */
export function LibraryScreen({ active, fromNav }: { active: boolean; fromNav: boolean }) {
  const { t } = useTranslation();
  const [back, setBack] = useState<Back | null>(
    fromNav ? { kind: 'nav', target: 'current' } : null,
  );
  const version = useSyncExternalStore(library.subscribe, library.version);
  useEffect(() => {
    void library.load().catch(() => undefined);
  }, []);
  const items = useMemo(() => {
    const shown = libraryView(library.items(), 'all', 'added');
    return isKidsProfile() ? shown.filter((item) => kidsTitleAllowed(item, true)) : shown;
    // `version` stands for the list's contents.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);
  const size = tileSize('poster');
  return (
    <View style={styles.screen}>
      <NavBar
        current="library"
        active={active}
        focus={back?.kind === 'nav' ? back.target : null}
        onLeave={(target) => setBack({ kind: 'nav', target })}
      />
      {items.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.title}>{t('tv.myListEmpty')}</Text>
          <Text style={styles.lead}>{t('tv.myListEmptyLead')}</Text>
        </View>
      ) : (
        <FlatList
          data={items}
          numColumns={COLUMNS}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.grid}
          columnWrapperStyle={styles.gridRow}
          renderItem={({ item, index }) => (
            <View style={{ width: size.width }}>
              <Tile
                item={item}
                shape="poster"
                onPress={() => {
                  setBack({ kind: 'title', id: item.id });
                  openTitle(item);
                }}
                {...(active &&
                (back === null ? index === 0 : back.kind === 'title' && back.id === item.id)
                  ? { preferred: true }
                  : {})}
              />
            </View>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  grid: { paddingHorizontal: layout.heroLeft, paddingTop: spacing.xl, paddingBottom: px(200) },
  gridRow: { gap: layout.rowGap * 2, marginBottom: layout.rowGap * 2 },
  empty: { marginLeft: layout.heroLeft, marginTop: px(160), width: px(1100), gap: spacing.md },
  title: { ...type.heading, color: color.text },
  lead: { ...type.body, color: color.textMuted },
});
