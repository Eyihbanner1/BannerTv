import { FocusContext, setFocus, useFocusable } from '@noriginmedia/norigin-spatial-navigation';
import type { Profile } from '@bannertv/core';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { Avatar } from '../../components/Avatar';
import { PinPad } from '../../components/PinPad';
import { Pressable } from '../../components/Pressable';
import {
  activeProfileId,
  chooseProfile,
  pinGuard,
  profiles,
  profileSwitcher,
} from '../../data/profiles';
import { refreshAccount } from '../../data/sync';
import { useBack } from '../../navigation/use-back';
import { ForgotPin } from './ForgotPin';
import styles from './ProfilePicker.module.css';

export const RAIL_PROFILE_FOCUS_KEY = 'rail-profile';

/** What Audio Guidance reads for a profile: its name, and whether it is for kids or locked. */
export function useProfileLabel(): (profile: Profile) => string {
  const { t } = useTranslation();
  return (profile) =>
    [
      profile.name,
      profile.kids ? t('profiles.kidsUpTo', { rating: profile.kids }) : '',
      profile.pin ? t('profiles.locked') : '',
    ]
      .filter(Boolean)
      .join(', ');
}

function LockIcon() {
  return (
    <svg width="40" height="40" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M6.5 10.5h11v9h-11zM8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function closeSwitcher(): void {
  profileSwitcher.set(false);
}

interface ProfilePickerProps {
  /**
   * 'launch' asks before anything else opens, and Back leaves the app as it
   * does on Home. 'switch' is opened from the rail, and Back closes it.
   */
  mode: 'launch' | 'switch';
}

/** "Who's watching?": one tile per profile. A locked profile asks for its PIN. */
export function ProfilePicker({ mode }: ProfilePickerProps) {
  const { t } = useTranslation();
  const { profiles: list, lastId } = useSyncExternalStore(profiles.subscribe, profiles.get);
  const current = useSyncExternalStore(activeProfileId.subscribe, activeProfileId.get);
  const label = useProfileLabel();
  const [asking, setAsking] = useState<Profile | null>(null);
  const [message, setMessage] = useState<string | undefined>(undefined);
  const [forgetting, setForgetting] = useState<Profile | null>(null);
  const { ref, focusKey } = useFocusable<object, HTMLDivElement>({
    focusKey: 'profile-picker',
    isFocusBoundary: true,
  });

  const start = current ?? lastId;
  useEffect(() => {
    const first = list.some((p) => p.id === start) ? start : list[0]!.id;
    void setFocus(`profile-${first}`);
    // Focus lands once, on the profile most likely to be wanted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A profile just made on another screen shows here without waiting for the next sync (item
  // A8). At launch the account starts once someone is chosen, and its first pull follows.
  useEffect(() => {
    if (mode === 'switch') void refreshAccount();
  }, [mode]);

  useBack(
    'overlay',
    () => {
      closeSwitcher();
      void setFocus(RAIL_PROFILE_FOCUS_KEY);
      return true;
    },
    mode === 'switch',
  );

  const lockedMessage = (id: string) =>
    t('pin.locked', { seconds: Math.ceil(pinGuard.waitMs(id) / 1000) });

  const open = (profile: Profile) => {
    if (profile.id === current) {
      closeSwitcher();
      void setFocus('content');
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
    <FocusContext.Provider value={focusKey}>
      <div
        ref={ref}
        className={styles.picker}
        role="dialog"
        aria-label={t('profiles.whoIsWatching')}
      >
        <h1 className={styles.title}>{t('profiles.whoIsWatching')}</h1>
        <div className={styles.row}>
          {list.map((profile) => (
            <Pressable
              key={profile.id}
              focusKey={`profile-${profile.id}`}
              label={label(profile)}
              className={profile.id === current ? `${styles.tile} ${styles.current}` : styles.tile}
              focusedClassName={styles.focused}
              onPress={() => open(profile)}
            >
              <Avatar profile={profile} size="large" />
              <span className={styles.name}>{profile.name}</span>
              <span className={styles.badges}>
                {profile.kids && <span className={styles.kids}>{t('profiles.kids')}</span>}
                {profile.pin && <LockIcon />}
              </span>
            </Pressable>
          ))}
        </div>
        <p className={styles.hint}>{t('profiles.manageHint')}</p>
      </div>
      {asking && (
        <PinPad
          focusKey="picker-pin"
          title={t('pin.enterFor', { name: asking.name })}
          message={message}
          returnFocusKey={() => `profile-${asking.id}`}
          onPin={(digits) => tryPin(asking, digits)}
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
          returnFocusKey={() => `profile-${forgetting.id}`}
          // The PIN is off: the profile opens as an unlocked one would.
          onCleared={() => {
            setForgetting(null);
            chooseProfile(forgetting.id);
          }}
          onClose={() => setForgetting(null)}
        />
      )}
    </FocusContext.Provider>
  );
}
