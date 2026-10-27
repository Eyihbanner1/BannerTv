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
  /** Each change of backdrop is a new layer, even back to an earlier one. */
  id: number;
  src: string;
  /** The addon's own address, tried if the sized one fails. */
  retrySrc: string | undefined;
  /** Decoding, fading in or on show, or fading out (the next one failed). */
  state: 'loading' | 'shown' | 'gone';
}

const LAYER_CLASS = {
  loading: styles.backdrop,
  shown: `${styles.backdrop} ${styles.loaded}`,
  // Still drifting while it fades: a new animation would make it jump.
  gone: `${styles.backdrop} ${styles.loaded} ${styles.gone}`,
};

/**
 * The backdrop. A new one is decoded before it fades in over the old one, so
 * the hero never goes dark between titles and the fade never waits on a
 * decode. Once it is in, the old one goes, and the new one drifts slowly. A
 * title whose backdrop fails to load fades the old one out.
 */
function Backdrop({ src, retrySrc }: { src: string | undefined; retrySrc: string | undefined }) {
  const [wanted, setWanted] = useState({ id: 0, src });
  const [layers, setLayers] = useState<readonly Layer[]>(() =>
    src ? [{ id: 0, src, retrySrc, state: 'loading' }] : [],
  );
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const wantedId = useRef(wanted.id);
  useLayoutEffect(() => {
    wantedId.current = wanted.id;
  });

  if (src !== wanted.src) {
    const id = wanted.id + 1;
    setWanted({ id, src });
    // Keep only the last backdrop on show under the new one. Back to that
    // same backdrop before the new one is in: keep it, and nothing waits.
    const below = layers.filter((layer) => layer.state === 'shown').slice(-1);
    if (src && below[0]?.src === src) setLayers(below);
    else setLayers(src ? below.concat({ id, src, retrySrc, state: 'loading' }) : []);
  }
  useEffect(() => () => clearTimeout(timer.current), []);

  // Once the fade is over, drop what it covered or faded out.
  const settle = (keep: (layers: readonly Layer[]) => readonly Layer[]) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setLayers(keep), FADE_MS);
  };

  const show = (id: number, image: HTMLImageElement) => {
    const reveal = () => {
      // A backdrop that was passed over while it decoded never shows.
      if (id !== wantedId.current) return;
      setLayers((current) =>
        current.map((entry) => (entry.id === id ? { ...entry, state: 'shown' } : entry)),
      );
      settle((current) => {
        const index = current.findIndex((entry) => entry.id === id && entry.state === 'shown');
        return index > 0 ? current.slice(index) : current;
      });
    };
    if (typeof image.decode === 'function') image.decode().then(reveal, reveal);
    else reveal();
  };

  const fail = (id: number) => {
    if (id !== wantedId.current) return;
    setLayers((current) =>
      current.filter((entry) => entry.id !== id).map((entry) => ({ ...entry, state: 'gone' })),
    );
    settle((current) => current.filter((entry) => entry.state !== 'gone'));
  };

  return (
    <>
      {layers.map((layer) => (
        <Artwork
          key={layer.id}
          src={layer.src}
          retrySrc={layer.retrySrc}
          className={LAYER_CLASS[layer.state]}
          onLoad={(image) => show(layer.id, image)}
          onFail={() => fail(layer.id)}
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
