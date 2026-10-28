import type { Profile } from '@bannertv/core';
import { useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { push } from '../../app/router';
import { useScreenFocus } from '../../app/use-screen-focus';
import { Avatar } from '../../components/Avatar';
import { Button } from '../../components/Button';
import { PinPad } from '../../components/PinPad';
import {
  activeProfileId,
  canAddProfile,
  pinGuard,
  profiles,
  setAskAtLaunch,
} from '../../data/profiles';
import { useProfileLabel } from './ProfilePicker';
import screen from '../Screen.module.css';
import styles from './ProfilesScreen.module.css';

/**
 * Settings > Profiles: everyone on this TV, a way to add someone, and whether
 * BannerTV asks who is watching when it opens. Changing a locked profile
 * other than your own asks for its PIN first.
 */
export function ProfilesScreen() {
  const { t } = useTranslation();
  const state = useSyncExternalStore(profiles.subscribe, profiles.get);
  const current = activeProfileId.get();
  const label = useProfileLabel();
  const [asking, setAsking] = useState<Profile | null>(null);
  const [message, setMessage] = useState<string | undefined>(undefined);
  useScreenFocus(`profiles-${state.profiles[0]!.id}`, true, true);

  const edit = (profile: Profile) =>
    push({ name: 'profile-edit', id: profile.id }, `profiles-${profile.id}`);
  const lockedMessage = (id: string) =>
    t('pin.locked', { seconds: Math.ceil(pinGuard.waitMs(id) / 1000) });

  return (
    <div className={screen.screen}>
      <h1 className={screen.title}>{t('profiles.title')}</h1>
      <p className={screen.lead}>{t('profiles.lead')}</p>
      <div className={screen.column}>
        {state.profiles.map((profile) => (
          <Button
            key={profile.id}
            block
            focusKey={`profiles-${profile.id}`}
            label={label(profile)}
            onPress={() => {
              if (!profile.pin || profile.id === current) {
                edit(profile);
                return;
              }
              setMessage(pinGuard.waitMs(profile.id) > 0 ? lockedMessage(profile.id) : undefined);
              setAsking(profile);
            }}
          >
            <span className={styles.entry}>
              <Avatar profile={profile} size="small" />
              <span className={styles.name}>{profile.name}</span>
              <span className={styles.note}>
                {[
                  profile.id === current ? t('profiles.you') : '',
                  profile.kids ? t('profiles.kidsUpTo', { rating: profile.kids }) : '',
                  profile.pin ? t('profiles.locked') : '',
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </span>
          </Button>
        ))}
        {canAddProfile() && (
          <Button
            block
            focusKey="profiles-add"
            label={t('profiles.add')}
            onPress={() => push({ name: 'profile-edit' })}
          />
        )}
        {state.profiles.length > 1 && (
          <Button
            block
            focusKey="profiles-ask"
            label={t('profiles.askAtLaunch', {
              value: state.askAtLaunch ? t('common.on') : t('common.off'),
            })}
            onPress={() => setAskAtLaunch(!state.askAtLaunch)}
          />
        )}
      </div>
      {asking && (
        <PinPad
          focusKey="profiles-pin"
          title={t('pin.enterFor', { name: asking.name })}
          message={message}
          returnFocusKey={`profiles-${asking.id}`}
          onPin={(digits) => {
            const result = pinGuard.attempt(asking, digits);
            if (result === 'ok') {
              setAsking(null);
              edit(asking);
            } else {
              setMessage(result === 'locked' ? lockedMessage(asking.id) : t('pin.wrong'));
            }
          }}
          onClose={() => setAsking(null)}
        />
      )}
    </div>
  );
}
