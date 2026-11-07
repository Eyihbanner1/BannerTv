import type { Profile } from '@bannertv/core';
import {
  activeProfileId,
  canAddProfile,
  hiddenProfiles,
  pinGuard,
  profiles,
  setAskAtLaunch,
} from '@tv/data/profiles';
import { refreshAccount } from '@tv/data/sync';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { Avatar } from '../../ui/Avatar';
import { ListRow } from '../../ui/Button';
import { Icon } from '../../ui/icons';
import { PinPad } from '../../ui/PinPad';
import { ScreenHeader } from '../../ui/ScreenHeader';
import { colors, gutter, radius, space, touch, type } from '../../ui/theme';
import { ForgotPin } from './ForgotPin';
import { useAccountRefresh } from './refresh';
import { unlockForEdit } from './unlocked';

/**
 * Settings > Profiles on the phone (item A1), as on the TV: everyone here, a way to add
 * someone, and whether BannerTV asks who is watching when it opens. Opening a locked profile
 * other than your own asks for its PIN first. It asks the account for changes each time it
 * shows, and on pull to refresh (item A8).
 */
export function ProfilesScreen() {
  const { t } = useTranslation();
  const state = useSyncExternalStore(profiles.subscribe, profiles.get);
  const hidden = useSyncExternalStore(hiddenProfiles.subscribe, hiddenProfiles.get);
  const current = activeProfileId.get();
  const [asking, setAsking] = useState<Profile | null>(null);
  const [message, setMessage] = useState<string | undefined>();
  const [forgetting, setForgetting] = useState<Profile | null>(null);
  const { refreshing, onRefresh } = useAccountRefresh();

  useFocusEffect(
    useCallback(() => {
      // Back from a profile's page: its PIN is asked for again next time.
      unlockForEdit(null);
      void refreshAccount();
    }, []),
  );

  const edit = (profile: Profile, unlocked = false) => {
    unlockForEdit(unlocked ? profile.id : null);
    router.push({ pathname: '/profile-edit', params: { id: profile.id } });
  };
  const lockedMessage = (id: string) =>
    t('pin.locked', { seconds: Math.ceil(pinGuard.waitMs(id) / 1000) });

  return (
    <View style={styles.screen}>
      <ScreenHeader title={t('profiles.title')} />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.accent}
            colors={[colors.action]}
          />
        }
      >
        <Text style={styles.lead}>{t('profiles.lead')}</Text>
        <View style={styles.list}>
          {state.profiles.map((profile) => {
            const note = [
              profile.id === current ? t('profiles.you') : '',
              profile.kids ? t('profiles.kidsUpTo', { rating: profile.kids }) : '',
              profile.pin ? t('profiles.locked') : '',
            ]
              .filter(Boolean)
              .join(' · ');
            return (
              <Pressable
                key={profile.id}
                onPress={() => {
                  if (!profile.pin || profile.id === current) {
                    edit(profile);
                    return;
                  }
                  setMessage(
                    pinGuard.waitMs(profile.id) > 0 ? lockedMessage(profile.id) : undefined,
                  );
                  setAsking(profile);
                }}
                accessibilityRole="button"
                accessibilityLabel={[profile.name, note].filter(Boolean).join(', ')}
                style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              >
                <Avatar profile={profile} size={44} round />
                <View style={styles.rowText}>
                  <Text style={styles.name} numberOfLines={1}>
                    {profile.name}
                  </Text>
                  {note ? <Text style={styles.note}>{note}</Text> : null}
                </View>
                {profile.pin ? <Icon name="lock" size={18} color={colors.textMuted} /> : null}
                <Icon name="chevron" size={20} color={colors.textMuted} />
              </Pressable>
            );
          })}
          {canAddProfile() ? (
            <ListRow
              title={t('profiles.add')}
              icon="plus"
              onPress={() => {
                unlockForEdit(null);
                router.push('/profile-edit');
              }}
            />
          ) : null}
        </View>
        {state.profiles.length > 1 ? (
          <View style={styles.list}>
            <ListRow
              title={t('phone.askAtLaunch')}
              onPress={() => setAskAtLaunch(!state.askAtLaunch)}
              right={
                <Switch
                  value={state.askAtLaunch}
                  onValueChange={setAskAtLaunch}
                  trackColor={{ true: colors.action, false: colors.surface3 }}
                  thumbColor={colors.text}
                  accessibilityLabel={t('phone.askAtLaunch')}
                />
              }
            />
          </View>
        ) : null}
        {hidden > 0 ? (
          <Text style={styles.aside}>{t('profiles.hidden', { count: hidden })}</Text>
        ) : null}
      </ScrollView>
      <PinPad
        visible={asking !== null}
        title={asking ? t('pin.enterFor', { name: asking.name }) : ''}
        {...(message ? { message } : {})}
        onPin={(digits) => {
          if (!asking) return;
          const result = pinGuard.attempt(asking, digits);
          if (result === 'ok') {
            setAsking(null);
            edit(asking, true);
          } else {
            setMessage(result === 'locked' ? lockedMessage(asking.id) : t('pin.wrong'));
          }
        }}
        onCancel={() => setAsking(null)}
        onForgot={() => {
          setForgetting(asking);
          setAsking(null);
        }}
      />
      {forgetting ? (
        <ForgotPin
          profile={forgetting}
          // Its page opens with Set a PIN, the PIN being off now.
          onCleared={() => {
            setForgetting(null);
            edit(forgetting);
          }}
          onClose={() => setForgetting(null)}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: gutter, paddingBottom: space.xxl * 2, gap: 22 },
  lead: { ...type.body, color: colors.textMuted },
  // The 1-unit gaps show the raised colour behind the rows: the dividers.
  list: { borderRadius: radius.l, overflow: 'hidden', gap: 1, backgroundColor: colors.raised },
  row: {
    minHeight: touch.row,
    paddingHorizontal: space.l,
    paddingVertical: space.m,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.m,
    backgroundColor: colors.surface2,
  },
  rowPressed: { backgroundColor: colors.raised },
  rowText: { flex: 1, gap: 2 },
  name: { ...type.heading, fontSize: 17, color: colors.text },
  note: { ...type.meta, color: colors.textMuted },
  aside: { ...type.small, color: colors.textMuted },
});
