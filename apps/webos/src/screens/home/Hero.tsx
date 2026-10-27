import type { MetaPreview } from '@bannertv/protocol';
import { FocusContext, useFocusable } from '@noriginmedia/norigin-spatial-navigation';
import { useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { push } from '../../app/router';
import { Artwork } from '../../components/Artwork';
import { Button } from '../../components/Button';
import { metaFacts } from '../../data/describe';
import { heroItem } from './hero-item';
import styles from './Hero.module.css';

export function openDetails(item: MetaPreview): void {
  push({ name: 'details', type: item.type, id: item.id, preview: item });
}

/** The backdrop fades in once loaded, then drifts slowly. */
function Backdrop({ src }: { src: string | undefined }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <Artwork
      src={src}
      className={loaded ? `${styles.backdrop} ${styles.loaded}` : styles.backdrop}
      onLoad={() => setLoaded(true)}
    />
  );
}

/**
 * The big banner at the top of Home, Netflix style: the focused title's
 * backdrop, its logo, the facts line and the synopsis.
 */
export function Hero() {
  const { t } = useTranslation();
  const item = useSyncExternalStore(heroItem.subscribe, heroItem.get);
  const { ref, focusKey } = useFocusable<object, HTMLElement>({ focusKey: 'home-hero' });
  const facts = item ? metaFacts(t, item) : [];
  const genres = item ? item.genres.slice(0, 3) : [];

  return (
    <FocusContext.Provider value={focusKey}>
      <section ref={ref} className={styles.hero} aria-label={item?.name ?? t('home.heroLoading')}>
        <div className={styles.art}>
          {item && <Backdrop key={item.background} src={item.background} />}
        </div>
        {item ? (
          <div className={styles.text}>
            <div className={styles.logoBox}>
              <Artwork
                key={item.logo}
                src={item.logo}
                className={styles.logo}
                fallback={<h1 className={styles.title}>{item.name}</h1>}
              />
            </div>
            <p className={styles.facts}>
              {facts.join(' · ')}
              {genres.length > 0 && <span className={styles.genres}>{genres.join(' · ')}</span>}
            </p>
            <p className={styles.description}>{item.description}</p>
            <Button
              focusKey="home-hero-details"
              label={t('home.details')}
              variant="primary"
              onPress={() => openDetails(item)}
            />
          </div>
        ) : (
          <div className={styles.text}>
            <p className={styles.facts}>{t('home.heroLoading')}</p>
          </div>
        )}
      </section>
    </FocusContext.Provider>
  );
}
