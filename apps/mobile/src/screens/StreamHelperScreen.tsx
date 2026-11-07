import {
  type AndroidHelperState,
  androidHelperState,
  sendHelperCommand,
} from '@tv/platform/android';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  PermissionsAndroid,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import {
  asksForNotifications,
  HELPER_POLL_MS,
  HELPER_SETTLE_MS,
  helperView,
} from '../data/stream-helper-view';
import { Button, ListRow } from '../ui/Button';
import { ScreenHeader } from '../ui/ScreenHeader';
import { colors, radius, space, type } from '../ui/theme';

/**
 * The stream helper for an LG on the home network (ADR 0005, decision 13), as the Android TV
 * app's Settings runs it (the TV's RunHelper): switch it on, then type the address and code shown
 * here on the LG once. It keeps running with the screen off until it is switched off here or
 * from its notification.
 */
export function StreamHelperScreen() {
  const { t } = useTranslation();
  const [state, setState] = useState<AndroidHelperState | null>(androidHelperState);
  /** The switch's new position until the service has started or stopped. */
  const [asked, setAsked] = useState<boolean | null>(null);
  const [notificationsOff, setNotificationsOff] = useState(false);
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null);

  const read = useCallback(() => setState(androidHelperState()), []);

  // While the screen is in front: the code changes once a TV pairs, and the notification's Stop
  // button can switch the helper off from outside.
  useFocusEffect(
    useCallback(() => {
      let live = true;
      read();
      const timer = setInterval(read, HELPER_POLL_MS);
      if (asksForNotifications(Platform.OS, Platform.Version)) {
        PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS)
          .then((granted) => {
            if (live) setNotificationsOff(!granted);
          })
          .catch(() => undefined);
      }
      return () => {
        live = false;
        clearInterval(timer);
      };
    }, [read]),
  );
  useEffect(
    () => () => {
      if (settle.current) clearTimeout(settle.current);
    },
    [],
  );

  const command = (name: 'start' | 'stop' | 'forget') => {
    sendHelperCommand(name);
    if (settle.current) clearTimeout(settle.current);
    // The service starts or stops a moment later.
    settle.current = setTimeout(() => {
      read();
      setAsked(null);
    }, HELPER_SETTLE_MS);
  };

  const turn = async (on: boolean) => {
    setAsked(on);
    if (!on) {
      command('stop');
      return;
    }
    // From Android 13 the notification, and its Stop button, show only once this is allowed.
    if (asksForNotifications(Platform.OS, Platform.Version)) {
      try {
        const answer = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
        );
        setNotificationsOff(answer !== PermissionsAndroid.RESULTS.GRANTED);
      } catch {
        // Nothing was asked: the helper runs anyway.
      }
    }
    command('start');
  };

  if (!state) {
    return (
      <View style={styles.screen}>
        <ScreenHeader title={t('streamHelper.title')} />
        <Text style={[styles.lead, styles.alone]}>{t('streamHelper.updateApp')}</Text>
      </View>
    );
  }
  const view = helperView(state);
  const on = asked ?? view.on;
  const switchTitle = t('phone.streamHelperSwitch');

  return (
    <View style={styles.screen}>
      <ScreenHeader title={t('streamHelper.title')} />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.lead}>{t('streamHelper.leadAndroid')}</Text>

        <View style={styles.group}>
          <ListRow
            title={switchTitle}
            onPress={() => void turn(!on)}
            right={
              <Switch
                value={on}
                onValueChange={(next) => void turn(next)}
                trackColor={{ true: colors.action, false: colors.surface3 }}
                thumbColor={colors.text}
                accessibilityLabel={switchTitle}
              />
            }
          />
        </View>
        <Text style={styles.small}>
          {t(view.on ? 'streamHelper.onNote' : 'streamHelper.offNote')}
        </Text>
        {view.on && notificationsOff ? (
          <Text style={styles.note}>{t('phone.streamHelperNotificationsOff')}</Text>
        ) : null}

        {view.pairing ? (
          <View style={styles.card} accessibilityLiveRegion="polite">
            <Text style={styles.lead}>{t('streamHelper.typeOnTv')}</Text>
            <Text style={styles.label}>{t('streamHelper.address')}</Text>
            <Text style={styles.address} selectable>
              {view.pairing.address}
            </Text>
            <Text style={styles.label}>{t('streamHelper.code')}</Text>
            <Text style={styles.code} selectable>
              {view.pairing.code}
            </Text>
          </View>
        ) : view.noWifi ? (
          <Text style={styles.note}>{t('streamHelper.noWifi')}</Text>
        ) : null}

        {view.paired > 0 ? (
          <Button
            label={t('streamHelper.forget', { count: view.paired })}
            onPress={() => command('forget')}
          />
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.l, gap: space.l, paddingBottom: space.xxl * 2 },
  alone: { padding: space.l },
  lead: { ...type.body, color: colors.textMuted },
  small: { ...type.small, color: colors.textSubtle, marginTop: -space.s },
  group: { borderRadius: radius.l, overflow: 'hidden' },
  note: {
    ...type.body,
    color: colors.text,
    backgroundColor: colors.surface2,
    borderRadius: radius.m,
    padding: space.m,
  },
  card: {
    backgroundColor: colors.surface1,
    borderRadius: radius.l,
    padding: space.l,
    gap: space.xs,
  },
  label: { ...type.overline, color: colors.accent, marginTop: space.s },
  address: { ...type.title, color: colors.text },
  code: { ...type.display, fontSize: 44, lineHeight: 52, color: colors.prismTop, letterSpacing: 4 },
});
