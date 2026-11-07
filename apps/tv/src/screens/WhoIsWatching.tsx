import type { Profile } from '@bannertv/core';
import {
  activeProfileId,
  chooseProfile,
  hiddenProfiles,
  pinGuard,
  profiles,
  profileSwitcher,
} from '@tv/data/profiles';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { BackHandler, StyleSheet, Text, View } from 'react-native';
import { goBack } from '../nav/routes';
import { Avatar } from '../ui/Avatar';
import { Focusable } from '../ui/Focusable';
import { Icon } from '../ui/icons';
import { PinPad } from '../ui/PinPad';
import { color, layout, px, spacing, type } from '../ui/theme';

/**
 * "Who's watching?": at launch (mode 'launch') or from the avatar on the nav row ('switch').
 * Picking another profile starts the app again on it, as on the LG and the phone.
 */
export function WhoIsWatching({ mode, active }: { mode: 'launch' | 'switch'; active: boolean }) {
  const { t } = useTranslation();
  const { profiles: list } = useSyncExternalStore(profiles.subscribe, profiles.get);
  const current = useSyncExternalStore(activeProfileId.subscribe, activeProfileId.get);
  const hidden = useSyncExternalStore(hiddenProfiles.subscribe, hiddenProfiles.get);
  const [asking, setAsking] = useState<Profile | null>(null);
  const [message, setMessage] = useState<string | undefined>();

  // While the picker is open, an account join waits to start the app again.
  useEffect(() => {
    if (mode !== 'switch') return;
    profileSwitcher.set(true);
    return () => profileSwitcher.set(false);
  }, [mode]);
  // Back closes the PIN first.
  useEffect(() => {
    if (!active || !asking) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      setAsking(null);
      return true;
    });
    return () => subscription.remove();
  }, [active, asking]);

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

  const size = layout.avatar;
  if (asking) {
    return (
      <View style={styles.screen}>
        <PinPad
          title={t('pin.enterFor', { name: asking.name })}
          {...(message ? { message } : {})}
          onPin={(digits) => tryPin(asking, digits)}
        />
      </View>
    );
  }
  return (
    <View style={styles.screen}>
      <Text style={styles.title}>{t('profiles.whoIsWatching')}</Text>
      <View style={styles.grid}>
        {list.map((profile, index) => (
          <View key={profile.id} style={styles.person}>
            <Focusable
              radius={size / 2}
              grow
              onPress={() => open(profile)}
              {...((current ? profile.id === current : index === 0) && active
                ? { preferred: true }
                : {})}
              accessibilityLabel={[
                profile.name,
                profile.kids ? t('profiles.kids') : '',
                profile.pin ? t('profiles.locked') : '',
              ]
                .filter(Boolean)
                .join(', ')}
              style={{ width: size, height: size }}
            >
              <Avatar profile={profile} size={size} />
            </Focusable>
            <View style={styles.nameRow}>
              <Text style={styles.name} numberOfLines={1}>
                {profile.name}
              </Text>
              {profile.pin ? <Icon name="lock" size={px(28)} tint={color.textMuted} /> : null}
            </View>
            {profile.kids ? <Text style={styles.kids}>{t('profiles.kids')}</Text> : null}
          </View>
        ))}
      </View>
      {hidden > 0 ? (
        <Text style={styles.note}>{t('profiles.hidden', { count: hidden })}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: color.bg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: px(72),
  },
  title: { ...type.heroTitle, color: color.text },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: px(64) },
  person: { alignItems: 'center', gap: spacing.md, width: layout.avatar + px(40) },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md },
  name: { ...type.rowTitle, color: color.text },
  kids: { ...type.meta, color: color.kidsText },
  note: { ...type.meta, color: color.textMuted },
});
