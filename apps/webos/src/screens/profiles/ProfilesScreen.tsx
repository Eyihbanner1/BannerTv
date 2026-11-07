import type { Profile } from '@bannertv/core';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { push } from '../../app/router';
import { useScreenFocus } from '../../app/use-screen-focus';
import { Avatar } from '../../components/Avatar';
import { Button } from '../../components/Button';
import { PinPad } from '../../components/PinPad';
import {
  activeProfileId,
  canAddProfile,
  hiddenProfiles,
  pinGuard,
  profiles,
  setAskAtLaunch,
} from '../../data/profiles';
import { refreshAccount } from '../../data/sync';
import { ForgotPin } from './ForgotPin';
import { useProfileLabel } from './ProfilePicker';
import screen from '../Screen.module.css';
import styles from './ProfilesScreen.module.css';

/**
 * Settings > Profiles: everyone on this TV, a way to add someone, and whether
 * BannerTV asks who is watching when it opens. Changing a locked profile
 * other than your own asks for its PIN first; changing a PIN, your own
 * included, asks for the one it has (see ProfileEditScreen). A note says
 * when the BannerTV account has more profiles than this screen shows.
 */
export function ProfilesScreen() {
  const { t } = useTranslation();
  const state = useSyncExternalStore(profiles.subscribe, profiles.get);
  const hidden = useSyncExternalStore(hiddenProfiles.subscribe, hiddenProfiles.get);
  const current = activeProfileId.get();
  const label = useProfileLabel();
  const [asking, setAsking] = useState<Profile | null>(null);
  const [message, setMessage] = useState<string | undefined>(undefined);
  const [forgetting, setForgetting] = useState<Profile | null>(null);
  useScreenFocus(`profiles-${state.profiles[0]!.id}`);
  // The list shows what the account has now, not what it had at the last sync (item A8).
  useEffect(() => {
    void refreshAccount();
  }, []);

  /** `unlocked`: its PIN was just entered, so its page does not ask for it again. */
  const edit = (profile: Profile, unlocked = false) =>
    push({ name: 'profile-edit', id: profile.id, unlocked }, `profiles-${profile.id}`);
  const lockedMessage = (id: string) =>
    t('pin.locked', { seconds: Math.ceil(pinGuard.waitMs(id) / 1000) });

  return (
    <div className={screen.screen}>
      <h1 className={screen.title}>{t('profiles.title')}</h1>
      <p className={screen.lead}>{t('profiles.lead')}</p>
      <div className={`${screen.column} ${styles.list}`}>
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
            // With a sixth profile added the button goes, so Back lands on the newest profile.
            onPress={() =>
              push({ name: 'profile-edit' }, () => {
                const list = profiles.get().profiles;
                return canAddProfile() ? 'profiles-add' : `profiles-${list[list.length - 1]!.id}`;
              })
            }
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
      {hidden > 0 && (
        <p className={`${screen.muted} ${styles.aside}`}>
          {t('profiles.hidden', { count: hidden })}
        </p>
      )}
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
              edit(asking, true);
            } else {
              setMessage(result === 'locked' ? lockedMessage(asking.id) : t('pin.wrong'));
            }
          }}
          onClose={() => setAsking(null)}
          onForgot={() => {
            setForgetting(asking);
            setAsking(null);
          }}
        />
      )}
      {forgetting && (
        <ForgotPin
          profile={forgetting}
          returnFocusKey={`profiles-${forgetting.id}`}
          // Its page opens with Set a PIN, the PIN being off now.
          onCleared={() => {
            setForgetting(null);
            edit(forgetting);
          }}
          onClose={() => setForgetting(null)}
        />
      )}
    </div>
  );
}
