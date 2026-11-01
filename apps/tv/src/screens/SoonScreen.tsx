import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import type { Section } from '../nav/routes';
import { NavBar } from '../ui/NavBar';
import { color, layout, px, spacing, type } from '../ui/theme';

const NAMES: Record<Section, string> = {
  home: 'tv.nav.home',
  search: 'tv.nav.search',
  discover: 'tv.nav.discover',
  sports: 'tv.nav.sports',
  library: 'tv.nav.myList',
};

/** A place on the nav row this test build doesn't have yet, said plainly. */
export function SoonScreen({ section }: { section: Section }) {
  const { t } = useTranslation();
  const name = t(NAMES[section]);
  return (
    <View style={styles.screen}>
      <NavBar current={section} />
      <View style={styles.body}>
        <Text style={styles.title}>{t('tv.soonTitle', { section: name })}</Text>
        <Text style={styles.lead}>{t('tv.soonLead', { section: name })}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  body: { marginLeft: layout.heroLeft, marginTop: px(160), width: px(1100), gap: spacing.md },
  title: { ...type.heading, color: color.text },
  lead: { ...type.body, color: color.textMuted },
});
