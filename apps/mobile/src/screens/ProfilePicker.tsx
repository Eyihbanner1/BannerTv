import type { Profile } from '@bannertv/core';
import {
  activeProfileId,
  chooseProfile,
  hiddenProfiles,
  pinGuard,
  profiles,
  profileSwitcher,
} from '@tv/data/profiles';
import { refreshAccount } from '@tv/data/sync';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { goBack } from '../nav/routes';
import { Avatar } from '../ui/Avatar';
import { Button } from '../ui/Button';
import { Icon } from '../ui/icons';
import { PinPad } from '../ui/PinPad';
import { colors, space, type } from '../ui/theme';
import { ForgotPin } from './profiles/ForgotPin';
import { useAccountRefresh } from './profiles/refresh';

/**
 * "Who's watching?": at launch (mode 'launch') or from the avatar on Home ('switch'). Picking
 * another profile starts the app again on it, as the TV does.
 */
export function ProfilePicker({ mode }: { mode: 'launch' | 'switch' }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { profiles: list } = useSyncExternalStore(profiles.subscribe, profiles.get);
  const current = useSyncExternalStore(activeProfileId.subscribe, activeProfileId.get);
  const hidden = useSyncExternalStore(hiddenProfiles.subscribe, hiddenProfiles.get);
  const [asking, setAsking] = useState<Profile | null>(null);
  const [message, setMessage] = useState<string | undefined>();
  const [forgetting, setForgetting] = useState<Profile | null>(null);
  const { refreshing, onRefresh } = useAccountRefresh();

  // While the picker is open, an account join waits to start the app again.
  useEffect(() => {
    if (mode !== 'switch') return;
    profileSwitcher.set(true);
    return () => profileSwitcher.set(false);
  }, [mode]);
  // Switching shows the account's profiles now, not as of the last sync (item A8). At launch
  // the account only starts once a profile is chosen, so the list is the last sync's.
  useEffect(() => {
    if (mode === 'switch') void refreshAccount();
  }, [mode]);

  const lockedMessage = (id: string) =>
    t('pin.locked', { seconds: Math.ceil(pinGuard.waitMs(id) / 1000) });
  const open = (profile: Profile) => {
    if (profile.id === current) {
      if (mode === 'switch') goBack();
      return;
    }
    if (!profile.pin) {
      chooseProfile(profile.id);
      return;
    }
    setMessage(pinGuard.waitMs(profile.id) > 0 ? lockedMessage(profile.id) : undefined);
    setAsking(profile);
  };
  const tryPin = (profile: Profile, digits: string) => {
    const result = pinGuard.attempt(profile, digits);
    if (result === 'ok') {
      setAsking(null);
      chooseProfile(profile.id);
    } else {
      setMessage(result === 'locked' ? lockedMessage(profile.id) : t('pin.wrong'));
    }
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top + space.xl }]}>
      <Text style={styles.title} accessibilityRole="header">
        {t('phone.whoIsWatching')}
      </Text>
      <ScrollView
        contentContainerStyle={styles.grid}
        {...(mode === 'switch'
          ? {
              refreshControl: (
                <RefreshControl
                  refreshing={refreshing}
                  onRefresh={onRefresh}
                  tintColor={colors.accent}
                  colors={[colors.action]}
                />
              ),
            }
          : {})}
      >
        {list.map((profile) => {
          const label = [
            profile.name,
            profile.kids ? t('profiles.kids') : '',
            profile.pin ? t('profiles.locked') : '',
          ]
            .filter(Boolean)
            .join(', ');
          return (
            <Pressable
              key={profile.id}
              onPress={() => open(profile)}
              accessibilityRole="button"
              accessibilityLabel={label}
              accessibilityState={{ selected: profile.id === current }}
              style={({ pressed }) => [styles.tile, pressed && styles.pressed]}
            >
              <Avatar profile={profile} size={96} />
              <View style={styles.nameRow}>
                <Text style={styles.name} numberOfLines={1}>
                  {profile.name}
                </Text>
                {profile.pin ? <Icon name="lock" size={16} color={colors.textMuted} /> : null}
              </View>
              {profile.kids ? <Text style={styles.kids}>{t('profiles.kids')}</Text> : null}
            </Pressable>
          );
        })}
      </ScrollView>
      {hidden > 0 ? (
        <Text style={styles.note}>{t('profiles.hidden', { count: hidden })}</Text>
      ) : null}
      {mode === 'switch' ? (
        <Button label={t('common.cancel')} kind="quiet" onPress={goBack} style={styles.cancel} />
      ) : null}
      <PinPad
        visible={asking !== null}
        title={asking ? t('phone.pinFor', { name: asking.name }) : ''}
        {...(message ? { message } : {})}
        onPin={(digits) => asking && tryPin(asking, digits)}
        onCancel={() => setAsking(null)}
        onForgot={() => {
          setForgetting(asking);
          setAsking(null);
        }}
      />
      {forgetting ? (
        <ForgotPin
          profile={forgetting}
          onCleared={() => {
            setForgetting(null);
            chooseProfile(forgetting.id);
          }}
          onClose={() => setForgetting(null)}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  title: { ...type.display, color: colors.text, textAlign: 'center', marginBottom: space.xl },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: space.xl,
    paddingHorizontal: space.l,
  },
  tile: { width: 120, alignItems: 'center', gap: space.s },
  pressed: { opacity: 0.7 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  name: { ...type.label, color: colors.text, maxWidth: 100 },
  kids: { ...type.small, color: colors.accent },
  note: { ...type.small, color: colors.textMuted, textAlign: 'center', padding: space.l },
  cancel: { alignSelf: 'center', marginBottom: space.xxl },
});
