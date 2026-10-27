import type { MetaPreview } from '@bannertv/protocol';
import { FocusContext, useFocusable } from '@noriginmedia/norigin-spatial-navigation';
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { push } from '../../app/router';
import { Artwork } from '../../components/Artwork';
import { artworkUrl } from '../../components/artwork-size';
import { Button } from '../../components/Button';
import { metaFacts } from '../../data/describe';
import { heroItem } from './hero-item';
import styles from './Hero.module.css';

export function openDetails(item: MetaPreview): void {
  push({ name: 'details', type: item.type, id: item.id, preview: item });
}

/** How long a new backdrop takes to fade in over the old one (Hero.module.css). */
const FADE_MS = 400;

interface Layer {
  src: string;
  /** The addon's own address, tried if the sized one fails. */
  retrySrc: string | undefined;
  shown: boolean;
}

/**
 * The backdrop. A new one is decoded before it fades in over the old one, so
 * the hero never goes dark between titles and the fade never waits on a
 * decode. Once it is in, the old one goes, and the new one drifts slowly.
 */
function Backdrop({ src, retrySrc }: { src: string | undefined; retrySrc: string | undefined }) {
  const [layers, setLayers] = useState<readonly Layer[]>(() =>
    src ? [{ src, retrySrc, shown: false }] : [],
  );
  const [shownSrc, setShownSrc] = useState(src);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const wanted = useRef(src);
  useLayoutEffect(() => {
    wanted.current = src;
  });

  if (src !== shownSrc) {
    setShownSrc(src);
    // Keep only the last backdrop on show under the new one.
    const below = layers.filter((layer) => layer.shown).slice(-1);
    setLayers(src ? below.concat({ src, retrySrc, shown: false }) : []);
  }
  useEffect(() => () => clearTimeout(timer.current), []);

  const show = (layer: string, image: HTMLImageElement) => {
    const reveal = () => {
      // A backdrop that was passed over while it decoded never shows.
      if (layer !== wanted.current) return;
      setLayers((current) =>
        current.map((entry) => (entry.src === layer ? { ...entry, shown: true } : entry)),
      );
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        setLayers((current) => {
          const index = current.findIndex((entry) => entry.src === layer && entry.shown);
          return index > 0 ? current.slice(index) : current;
        });
      }, FADE_MS);
    };
    if (typeof image.decode === 'function') image.decode().then(reveal, reveal);
    else reveal();
  };

  return (
    <>
      {layers.map((layer) => (
        <Artwork
          key={layer.src}
          src={layer.src}
          retrySrc={layer.retrySrc}
          className={layer.shown ? `${styles.backdrop} ${styles.loaded}` : styles.backdrop}
          onLoad={(image) => show(layer.src, image)}
        />
      ))}
    </>
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
  const logo = artworkUrl(item?.logo, 'titleLogo');

  return (
    <FocusContext.Provider value={focusKey}>
      <section ref={ref} className={styles.hero} aria-label={item?.name ?? t('home.heroLoading')}>
        <div className={styles.art}>
          <Backdrop src={artworkUrl(item?.background, 'backdrop')} retrySrc={item?.background} />
        </div>
        {item ? (
          <div className={styles.text}>
            <div className={styles.logoBox}>
              <Artwork
                key={logo}
                src={logo}
                retrySrc={item.logo}
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
