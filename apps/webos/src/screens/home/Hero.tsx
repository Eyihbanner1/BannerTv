import { FocusContext, useFocusable } from '@noriginmedia/norigin-spatial-navigation';
import { useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { push } from '../../app/router';
import { Button } from '../../components/Button';
import { heroItem } from './hero-item';
import { artGradient } from './sample-data';
import styles from './Hero.module.css';

export function Hero() {
  const { t } = useTranslation();
  const item = useSyncExternalStore(heroItem.subscribe, heroItem.get);
  const { ref, focusKey } = useFocusable<object, HTMLElement>({ focusKey: 'home-hero' });

  return (
    <FocusContext.Provider value={focusKey}>
      <section ref={ref} className={styles.hero} aria-label={item.title}>
        <div className={styles.art} style={{ backgroundImage: artGradient(item, 120) }} />
        <div className={styles.text}>
          <h1 className={styles.title}>{item.title}</h1>
          <p className={styles.meta}>{t('home.heroMeta', { year: item.year })}</p>
          <Button
            focusKey="home-hero-details"
            label={t('home.details')}
            variant="primary"
            onPress={() => push({ name: 'details', itemId: item.id })}
          />
        </div>
      </section>
    </FocusContext.Provider>
  );
}
