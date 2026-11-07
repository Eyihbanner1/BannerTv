import { MAIN_PROFILE_ID } from '@bannertv/core';
import { activeProfileId } from '@tv/data/profiles';
import { accountSection, accountState, checkAccountSection, openAccount } from '@tv/data/sync';
import { syncOn } from '@tv/data/sync-clock';
import { finishWelcome } from '@tv/data/welcome';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ICON from '../../assets/images/icon.png';
import { Button } from '../ui/Button';
import { colors, radius, space, type } from '../ui/theme';

/** The first run: what BannerTV is, the notice about addons, and joining an account. */
export function WelcomeScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const section = useSyncExternalStore(accountSection.subscribe, accountSection.get);
  const account = useSyncExternalStore(accountState.subscribe, accountState.get);
  const isMain = activeProfileId.get() === MAIN_PROFILE_ID;

  useEffect(() => {
    if (!isMain) return;
    checkAccountSection();
    openAccount();
  }, [isMain]);

  const offer =
    isMain &&
    section.shown &&
    !syncOn() &&
    account.engine === 'running' &&
    account.status.state === 'off';

  const go = (path: '/addons' | '/account', params: Record<string, string>) => {
    router.push({ pathname: path, params });
    finishWelcome();
  };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + space.xxl, paddingBottom: insets.bottom + space.xxl },
      ]}
    >
      <Image source={ICON} style={styles.icon} accessibilityIgnoresInvertColors />
      <Text style={styles.title} accessibilityRole="header">
        {t('welcome.title')}
      </Text>
      <Text style={styles.lead}>{t('welcome.lead')}</Text>
      <Text style={styles.body}>{t('welcome.ready')}</Text>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>{t('welcome.noticeTitle')}</Text>
        <Text style={styles.body}>{t('welcome.notice')}</Text>
      </View>

      <View style={styles.buttons}>
        <Button label={t('welcome.start')} kind="primary" onPress={finishWelcome} />
        <Button label={t('welcome.addAddon')} onPress={() => go('/addons', { add: '1' })} />
      </View>

      {offer ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t('welcome.accountTitle')}</Text>
          <Text style={styles.body}>{t('phone.welcomeJoinLead')}</Text>
          <Button label={t('welcome.join')} onPress={() => go('/account', { join: '1' })} />
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: space.xl, gap: space.l },
  icon: { width: 72, height: 72, borderRadius: radius.l },
  title: { ...type.display, color: colors.text },
  lead: { ...type.heading, color: colors.prismTop },
  body: { ...type.body, color: colors.textMuted },
  card: {
    backgroundColor: colors.surface1,
    borderRadius: radius.l,
    padding: space.l,
    gap: space.s,
  },
  cardTitle: { ...type.heading, color: colors.text },
  buttons: { gap: space.m },
});
