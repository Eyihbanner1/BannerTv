import { isKidsProfile } from '@tv/data/profiles';
import type { ErrorBoundaryProps } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { handOver, handsOver, noteProblem, shareReport } from '../runtime/crash-catcher';
import { startAgain } from '../runtime/web-globals';
import { Button } from '../ui/Button';
import { PrismMark } from '../ui/PrismMark';
import { colors, gutter, space, type } from '../ui/theme';

/** Send a report is for grown-ups, as the TV keeps reports from kids; if unsure, it stays hidden. */
function grownUp(): boolean {
  try {
    return !isKidsProfile();
  } catch {
    return false;
  }
}

/**
 * What the app shows when a screen fails to draw, instead of a blank screen. It is the root
 * layout's ErrorBoundary (app/_layout.tsx), so it covers every screen. Start again starts the
 * app again with the same profile chosen; Send a report shares what went wrong.
 *
 * Before an over-the-air update's first screen has shown it draws nothing and hands the error
 * on as a crash instead (runtime/crash-catcher.ts, handsOver): drawing would count as the
 * update's first screen, and expo-updates would keep an update that cannot start.
 */
export function CrashScreen({ error }: ErrorBoundaryProps) {
  if (handsOver()) {
    handOver(error);
    throw error;
  }
  return <CrashCard error={error} />;
}

function CrashCard({ error }: { error: Error }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [sharing, setSharing] = useState(false);
  const [notShared, setNotShared] = useState(false);
  useEffect(() => noteProblem(error, 'screen'), [error]);

  const send = () => {
    setSharing(true);
    void shareReport(t('phone.reportTitle')).then((shared) => {
      setSharing(false);
      setNotShared(!shared);
    });
  };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + space.xxl, paddingBottom: insets.bottom + space.xxl },
      ]}
    >
      <PrismMark size={56} />
      <Text style={styles.title} accessibilityRole="header">
        {t('phone.crash.title')}
      </Text>
      <Text style={styles.lead}>{t('phone.crash.lead')}</Text>
      <View style={styles.buttons}>
        <Button
          label={t('phone.crash.startAgain')}
          kind="primary"
          onPress={() => void startAgain()}
        />
        {grownUp() ? <Button label={t('phone.sendReport')} onPress={send} busy={sharing} /> : null}
      </View>
      {notShared ? <Text style={styles.note}>{t('phone.reportNotShared')}</Text> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: gutter, gap: space.l },
  title: { ...type.display, color: colors.text },
  lead: { ...type.body, color: colors.textMuted },
  buttons: { gap: space.m, marginTop: space.s },
  note: { ...type.meta, color: colors.textMuted },
});
