import type { MetaPreview } from '@bannertv/protocol';
import { FocusContext, useFocusable } from '@noriginmedia/norigin-spatial-navigation';
import { memo, useEffect, useLayoutEffect, useReducer, useRef, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { push } from '../../app/router';
import { Artwork } from '../../components/Artwork';
import { artworkUrl } from '../../components/artwork-size';
import { Button } from '../../components/Button';
import { metaFacts } from '../../data/describe';
import { mark } from '../../platform/marks';
import { tuning } from '../../platform/tuning';
import { backdrops, firstBackdrops } from './backdrops';
import { heroItem, showWaitingHero } from './hero-item';
import styles from './Hero.module.css';

export function openDetails(item: MetaPreview): void {
  push({ name: 'details', type: item.type, id: item.id, preview: item });
}

/** How long a new backdrop takes to fade in over the old one (Hero.module.css), if it fades. */
const FADE_MS = tuning.heroFade ? 400 : 0;

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
  const [{ layers }, dispatch] = useReducer(backdrops, undefined, () =>
    firstBackdrops(src, retrySrc),
  );
  // Before paint, so the new layer starts loading in the same frame.
  useLayoutEffect(() => dispatch({ type: 'want', src, retrySrc }), [src, retrySrc]);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  // Once the fade is over, drop what it covered or faded out. With no fade,
  // in the same render, so no frame draws both backdrops and none draws the
  // hero twice.
  const settle = () => {
    clearTimeout(timer.current);
    if (FADE_MS === 0) dispatch({ type: 'settled' });
    else timer.current = setTimeout(() => dispatch({ type: 'settled' }), FADE_MS);
  };

  const show = (id: number, image: HTMLImageElement) => {
    const reveal = () => {
      dispatch({ type: 'shown', id });
      settle();
    };
    if (typeof image.decode === 'function') image.decode().then(reveal, reveal);
    else reveal();
  };

  // For a TV trace: a new backdrop on show, and the one it covered gone.
  const top = layers[layers.length - 1];
  const shownId = top && top.state === 'shown' ? top.id : -1;
  useLayoutEffect(() => {
    if (shownId >= 0) mark('backdrop:shown');
  }, [shownId]);
  const covering = layers.length > 1;
  const wasCovering = useRef(false);
  useLayoutEffect(() => {
    if (wasCovering.current && !covering) mark('backdrop:settled');
    wasCovering.current = covering;
  }, [covering]);

  return (
    <>
      {layers.map((layer) => (
        <Artwork
          key={layer.id}
          src={layer.src}
          retrySrc={layer.retrySrc}
          className={LAYER_CLASS[layer.state]}
          onLoad={(image) => show(layer.id, image)}
          onFail={() => {
            dispatch({ type: 'failed', id: layer.id });
            settle();
          }}
        />
      ))}
    </>
  );
}

/**
 * The big banner at the top of Home, Netflix style: the focused title's
 * backdrop, its logo, the facts line and the synopsis. It follows the hero
 * store alone, so Home drawing again on each focus move leaves it be.
 */
export const Hero = memo(function Hero() {
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
              onFocus={showWaitingHero}
              onPress={() => openDetails(heroItem.get() ?? item)}
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
});
