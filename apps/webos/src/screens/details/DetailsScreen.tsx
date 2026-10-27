import type { MetaDetail, MetaPreview } from '@bannertv/protocol';
import { FocusContext, useFocusable } from '@noriginmedia/norigin-spatial-navigation';
import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useScreenFocus } from '../../app/use-screen-focus';
import { Artwork } from '../../components/Artwork';
import { Button } from '../../components/Button';
import { Pressable } from '../../components/Pressable';
import { addonClient } from '../../data/addons';
import { describeAddonError, metaFacts } from '../../data/describe';
import { useQuery } from '../../data/use-query';
import { playTrailer } from '../../platform/youtube';
import { EpisodeList } from './EpisodeList';
import { defaultSeason, groupSeasons, type Season } from './seasons';
import styles from './DetailsScreen.module.css';

const MAX_CAST = 4;

interface DetailsScreenProps {
  type: string;
  id: string;
  preview?: MetaPreview;
}

function SeasonTabs({
  seasons,
  selected,
  onSelect,
}: {
  seasons: readonly Season[];
  selected: number;
  onSelect: (index: number) => void;
}) {
  const { t } = useTranslation();
  const trackRef = useRef<HTMLDivElement>(null);
  const { ref, focusKey } = useFocusable<object, HTMLDivElement>({
    focusKey: 'details-seasons',
    saveLastFocusedChild: false,
    preferredChildFocusKey: `details-season-${selected}`,
  });

  return (
    <FocusContext.Provider value={focusKey}>
      <div ref={ref} className={styles.seasons}>
        <div ref={trackRef} className={styles.seasonTrack}>
          {seasons.map((season, index) => {
            const label =
              season.number === null
                ? t('details.episodes')
                : season.number === 0
                  ? t('details.specials')
                  : t('details.season', { number: season.number });
            return (
              <Pressable
                key={index}
                focusKey={`details-season-${index}`}
                label={label}
                className={index === selected ? `${styles.season} ${styles.active}` : styles.season}
                focusedClassName={styles.seasonFocused}
                onFocus={(layout) => {
                  // Seasons switch as focus moves, so Down lands straight in the episodes.
                  onSelect(index);
                  const track = trackRef.current;
                  if (track) {
                    const overflow =
                      layout.left + layout.width - (track.parentElement!.offsetWidth - 48);
                    track.style.transform = overflow > 0 ? `translateX(${-overflow}px)` : '';
                  }
                }}
              >
                {label}
              </Pressable>
            );
          })}
        </div>
      </div>
    </FocusContext.Provider>
  );
}

// The season last shown per title, for this session.
const seasonMemory = new Map<string, number>();

function Episodes({ meta, onPress }: { meta: MetaDetail; onPress: () => void }) {
  const seasons = useMemo(() => groupSeasons(meta.videos), [meta.videos]);
  const [selected, setSelected] = useState(() => {
    const saved = seasonMemory.get(meta.id);
    return saved !== undefined && saved < seasons.length ? saved : defaultSeason(seasons);
  });
  const season = seasons[selected]!;
  return (
    <>
      {seasons.length > 1 && (
        <SeasonTabs
          seasons={seasons}
          selected={selected}
          onSelect={(index) => {
            seasonMemory.set(meta.id, index);
            setSelected(index);
          }}
        />
      )}
      <EpisodeList
        key={selected}
        focusKey="details-episodes"
        memoryKey={`details-${meta.id}-${selected}`}
        videos={season.videos}
        onPress={onPress}
      />
    </>
  );
}

/**
 * Backdrop, logo, facts and synopsis on the left; for a series, seasons and
 * episodes in a panel on the right. It draws what the tile knew at once and
 * fills in the rest when the addon answers.
 */
export function DetailsScreen({ type, id, preview }: DetailsScreenProps) {
  const { t } = useTranslation();
  const query = useMemo(() => addonClient.meta(type, id), [type, id]);
  const state = useQuery(query);
  const meta = state.data;
  const item: MetaPreview | undefined = meta ?? preview;
  const [note, setNote] = useState<string | null>(null);
  const trailer = item?.trailers[0];
  const isMovie = type === 'movie';
  const failed = state.status === 'error';
  const hasEpisodes = !isMovie && meta !== undefined && meta.videos.length > 0;
  // Titles without episodes get Watch, which uses the addon's default video in Phase 2.
  const canWatch = isMovie || (meta !== undefined && !hasEpisodes);

  const defaultFocus = failed
    ? 'details-retry'
    : hasEpisodes
      ? 'details-episodes'
      : 'details-watch';
  useScreenFocus(defaultFocus, isMovie || failed || state.status === 'success');

  const facts = item ? metaFacts(t, item) : [];
  const separator = t('common.listSeparator');
  const error = failed ? describeAddonError(t, state.error, t('rail.addons')) : undefined;

  return (
    <section className={styles.details} aria-label={item?.name}>
      <div className={styles.art}>
        {item?.background && (
          <Artwork key={item.background} src={item.background} className={styles.backdrop} />
        )}
      </div>
      <div className={isMovie ? `${styles.info} ${styles.wide}` : styles.info}>
        <div className={styles.logoBox}>
          {item ? (
            <Artwork
              key={item.logo}
              src={item.logo}
              className={styles.logo}
              fallback={<h1 className={styles.title}>{item.name}</h1>}
            />
          ) : (
            <h1 className={styles.title}>{t('details.loading')}</h1>
          )}
        </div>
        {facts.length > 0 && <p className={styles.facts}>{facts.join(' · ')}</p>}
        {item && item.genres.length > 0 && (
          <p className={styles.genres}>{item.genres.slice(0, 4).join(' · ')}</p>
        )}
        {item?.description && <p className={styles.description}>{item.description}</p>}
        {meta && meta.cast.length > 0 && (
          <p className={styles.credits}>
            {t('details.cast', { names: meta.cast.slice(0, MAX_CAST).join(separator) })}
          </p>
        )}
        {meta && meta.directors.length > 0 && (
          <p className={styles.credits}>
            {t('details.directors', { names: meta.directors.join(separator) })}
          </p>
        )}
        {error && <p className={styles.error}>{error}</p>}
        <div className={styles.actions}>
          {canWatch && (
            <Button
              focusKey="details-watch"
              label={t('details.watch')}
              variant="primary"
              onPress={() => setNote(t('details.comingInPhase2'))}
            />
          )}
          {trailer && (
            <Button
              focusKey="details-trailer"
              label={t('details.trailer')}
              onPress={() => {
                setNote(null);
                playTrailer(trailer).catch(() => setNote(t('details.trailerFailed')));
              }}
            />
          )}
          {failed && (
            <Button
              focusKey="details-retry"
              label={t('common.tryAgain')}
              onPress={() => query.retry()}
            />
          )}
        </div>
        {note && <p className={styles.note}>{note}</p>}
      </div>
      {!isMovie && !canWatch && !failed && (
        <div className={styles.panel}>
          {meta && hasEpisodes ? (
            <Episodes meta={meta} onPress={() => setNote(t('details.comingInPhase2'))} />
          ) : (
            <p className={styles.note}>{t('details.loading')}</p>
          )}
        </div>
      )}
    </section>
  );
}
