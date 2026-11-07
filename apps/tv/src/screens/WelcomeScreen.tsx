import { finishWelcome } from '@tv/data/welcome';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import { Button } from '../ui/Button';
import { color, layout, px, radii, spacing, type } from '../ui/theme';

/** The first run: what BannerTV is and the notice about addons. */
export function WelcomeScreen() {
  const { t } = useTranslation();
  return (
    <View style={styles.screen}>
      <Text style={styles.title}>{t('welcome.title')}</Text>
      <Text style={styles.lead}>{t('welcome.lead')}</Text>
      <Text style={styles.body}>{t('welcome.ready')}</Text>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>{t('welcome.noticeTitle')}</Text>
        <Text style={styles.body}>{t('welcome.notice')}</Text>
      </View>
      <View style={styles.buttons}>
        <Button kind="primary" label={t('welcome.start')} onPress={finishWelcome} preferred />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: color.bg,
    paddingHorizontal: layout.heroLeft,
    paddingTop: px(140),
    gap: spacing.xl,
    width: px(1400),
  },
  title: { ...type.heroTitle, color: color.text },
  lead: { ...type.heading, color: color.focus },
  body: { ...type.body, color: color.textMuted },
  card: {
    backgroundColor: color.surface,
    borderRadius: radii.lg,
    padding: spacing.xl,
    gap: spacing.sm,
  },
  cardTitle: { ...type.rowTitle, color: color.text },
  buttons: { flexDirection: 'row', gap: spacing.lg },
});
