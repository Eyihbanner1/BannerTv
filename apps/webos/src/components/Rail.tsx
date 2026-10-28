import { FocusContext, setFocus, useFocusable } from '@noriginmedia/norigin-spatial-navigation';
import { useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { currentSection, openSection, router } from '../app/router';
import { useVisibleSections } from '../app/sections';
import markUrl from '../../../../brand/logo/bannertv-mark.svg';
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
      </nav>
    </FocusContext.Provider>
  );
}
