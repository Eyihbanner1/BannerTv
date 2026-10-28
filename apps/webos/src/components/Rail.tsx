import { FocusContext, setFocus, useFocusable } from '@noriginmedia/norigin-spatial-navigation';
import { useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { currentSection, openSection, router } from '../app/router';
import { useVisibleSections } from '../app/sections';
import markUrl from '../../../../brand/logo/bannertv-mark.svg';
import { activeProfile, profiles, profileSwitcher } from '../data/profiles';
import { RAIL_PROFILE_FOCUS_KEY } from '../screens/profiles/ProfilePicker';
import { Avatar } from './Avatar';
import { Pressable } from './Pressable';
import { RailIcon } from './RailIcon';
import styles from './Rail.module.css';

export const RAIL_FOCUS_KEY = 'rail';

/**
 * The only global navigation. Collapsed to icons until focus enters it, and it
 * always opens on the current section rather than the last item touched.
 */
export function Rail() {
  const { t } = useTranslation();
  const section = useSyncExternalStore(router.subscribe, () => currentSection());
  const sections = useVisibleSections();
  const { profiles: list } = useSyncExternalStore(profiles.subscribe, profiles.get);
  // With one profile there is nobody to switch to, so no avatar.
  const profile = list.length > 1 ? activeProfile() : undefined;
  const { ref, focusKey, hasFocusedChild } = useFocusable<object, HTMLElement>({
    focusKey: RAIL_FOCUS_KEY,
    trackChildren: true,
    saveLastFocusedChild: false,
    preferredChildFocusKey: `rail-${section}`,
  });

  return (
    <FocusContext.Provider value={focusKey}>
      <nav
        ref={ref}
        aria-label={t('rail.label')}
        className={hasFocusedChild ? `${styles.rail} ${styles.expanded}` : styles.rail}
      >
        <div className={styles.backdrop} />
        <img className={styles.logo} src={markUrl} alt="BannerTV" />
        {sections.map((item) => (
          <Pressable
            key={item}
            focusKey={`rail-${item}`}
            label={t(`rail.${item}`)}
            className={item === section ? `${styles.item} ${styles.active}` : styles.item}
            focusedClassName={styles.focused}
            onPress={() => {
              if (item === section) void setFocus('content');
              else openSection(item);
            }}
          >
            <RailIcon section={item} />
            <span className={styles.label}>{t(`rail.${item}`)}</span>
          </Pressable>
        ))}
        {profile && (
          <Pressable
            focusKey={RAIL_PROFILE_FOCUS_KEY}
            label={t('profiles.switch', { name: profile.name })}
            className={`${styles.item} ${styles.profile}`}
            focusedClassName={styles.focused}
            onPress={() => profileSwitcher.set(true)}
          >
            <span className={styles.avatar}>
              <Avatar profile={profile} size="small" />
            </span>
            <span className={styles.label}>{profile.name}</span>
          </Pressable>
        )}
      </nav>
    </FocusContext.Provider>
  );
}
