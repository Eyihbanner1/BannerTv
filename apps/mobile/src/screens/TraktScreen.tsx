import type { DeviceSignInState } from '@bannertv/core';
import { lastSync, syncTrakt, traktAccount, traktDevice } from '@tv/data/trakt';
import * as Clipboard from 'expo-clipboard';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '../ui/Button';
import { ScreenHeader } from '../ui/ScreenHeader';
import { colors, gutter, radius, space, type } from '../ui/theme';

/** The address without its scheme, to read out. */
function shortUrl(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

function clock(at: number): string {
  return new Date(at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

/** How long the code on show has left, counting down. */
function MinutesLeft({ expiresAt }: { expiresAt: number }) {
  const { t } = useTranslation();
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(timer);
  }, []);
  return (
    <Text style={styles.help}>
      {t('trakt.codeLasts', { count: Math.max(1, Math.ceil((expiresAt - now) / 60000)) })}
    </Text>
  );
}

/**
 * Signing in with Trakt's code, as on the TV. On a phone the code page opens in the browser on
 * the same phone: copy the code, open the page, paste, and come back.
 */
function SignIn({ device, expired }: { device: DeviceSignInState; expired: boolean }) {
  const { t } = useTranslation();
  const waiting = device.status === 'waiting';

  let note: string | null = expired ? t('trakt.signInExpired') : null;
  let action = t('trakt.signIn');
  if (device.status === 'starting') note = t('trakt.starting');
  if (waiting || device.status === 'expired') action = t('trakt.newCode');
  if (device.status === 'expired') note = t('trakt.codeExpired');
  if (device.status === 'denied') note = t('trakt.denied');
  if (device.status === 'failed') note = t(`trakt.failed.${device.kind}`);
  if (device.status === 'denied' || device.status === 'failed') action = t('common.tryAgain');

  return (
    <View style={styles.block}>
      {waiting ? (
        <View style={styles.code} accessibilityLiveRegion="polite">
          <Text style={styles.help}>{t('phone.traktSteps')}</Text>
          <Text style={styles.userCode} selectable accessibilityLabel={device.userCode}>
            {device.userCode}
          </Text>
          <MinutesLeft key={device.userCode} expiresAt={device.expiresAt} />
          <Button
            kind="play"
            label={t('phone.traktOpen', { url: shortUrl(device.verificationUrl) })}
            onPress={() => {
              void Clipboard.setStringAsync(device.userCode)
                .catch(() => undefined)
                .then(() => Linking.openURL(device.verificationUrl))
                .catch(() => undefined);
            }}
          />
          <Text style={styles.small}>{t('phone.traktCopied')}</Text>
        </View>
      ) : null}
      <Button
        kind={waiting ? 'secondary' : 'play'}
        label={action}
        onPress={() => void traktDevice.start()}
      />
      {waiting ? (
        <Button kind="quiet" label={t('common.cancel')} onPress={() => traktDevice.stop()} />
      ) : null}
      {note ? <Text style={styles.note}>{note}</Text> : null}
    </View>
  );
}

function SignedIn({ username }: { username?: string }) {
  const { t } = useTranslation();
  const last = useSyncExternalStore(lastSync.subscribe, lastSync.get);
  const [syncing, setSyncing] = useState(false);
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );

  let status: string | null = null;
  if (syncing) status = t('trakt.syncing');
  else if (last?.result === 'done') status = t('trakt.synced', { time: clock(last.at) });
  else if (last?.result === 'failed') status = t('trakt.syncFailed');

  return (
    <View style={styles.block}>
      <Text style={styles.account}>
        {username ? t('trakt.signedInAs', { name: username }) : t('trakt.signedIn')}
      </Text>
      <Button
        kind="play"
        label={t('trakt.syncNow')}
        busy={syncing}
        onPress={() => {
          if (syncing) return;
          setSyncing(true);
          void syncTrakt().then(() => {
            if (mounted.current) setSyncing(false);
          });
        }}
      />
      <Button
        label={t('trakt.signOut')}
        onPress={() =>
          Alert.alert(t('trakt.signOutTitle'), t('trakt.signOutMessage'), [
            { text: t('common.cancel'), style: 'cancel' },
            {
              text: t('trakt.signOut'),
              style: 'destructive',
              onPress: () => void traktAccount.signOut(),
            },
          ])
        }
      />
      {status ? (
        <Text style={styles.note} accessibilityLiveRegion="polite">
          {status}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * Settings > Trakt: signing in with a code entered at trakt.tv, then syncing now and signing
 * out. Trakt's sign-in stays on this phone and profile (ADR 0006), as on each TV.
 */
export function TraktScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const account = useSyncExternalStore(traktAccount.subscribe, traktAccount.get);
  const device = useSyncExternalStore(traktDevice.subscribe, traktDevice.get);
  useEffect(() => {
    void traktAccount.load();
    return () => traktDevice.stop();
  }, []);

  return (
    <View style={styles.screen}>
      <ScreenHeader title={t('trakt.title')} />
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + space.xxl }]}
      >
        <Text style={styles.lead}>{t('trakt.lead')}</Text>
        {account.status === 'signedIn' ? <SignedIn username={account.username} /> : null}
        {account.status === 'signedOut' ? (
          <SignIn device={device} expired={account.expired === true} />
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: gutter, gap: space.xl },
  lead: { ...type.body, color: colors.textMuted },
  block: { gap: space.m },
  code: {
    gap: space.m,
    padding: space.l,
    borderRadius: radius.l,
    backgroundColor: colors.surface2,
    alignItems: 'stretch',
  },
  help: { ...type.body, color: colors.textSoft },
  userCode: {
    ...type.display,
    fontSize: 36,
    lineHeight: 44,
    letterSpacing: 4,
    color: colors.text,
    textAlign: 'center',
    paddingVertical: space.s,
  },
  small: { ...type.small, color: colors.textMuted },
  note: { ...type.body, color: colors.textMuted },
  account: { ...type.heading, color: colors.text },
});
