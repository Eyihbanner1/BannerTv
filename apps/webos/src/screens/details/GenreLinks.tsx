import { genreSource } from '@bannertv/core';
import type { MetaPreview } from '@bannertv/protocol';
import { Fragment, memo, useMemo, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { push } from '../../app/router';
import { Pressable } from '../../components/Pressable';
import { addonCollection } from '../../data/addons';
import { isKidsProfile } from '../../data/profiles';
import { sportsState } from '../../data/sports';
import styles from './DetailsScreen.module.css';

const MAX_GENRES = 4;

/**
 * A title's genres. Each one an addon can filter its catalogs of the title's
 * type by opens Discover on it, as More like this's See all does; the rest
 * stay words. A kids profile browses Family only, so its genres stay words.
 */
export const GenreLinks = memo(function GenreLinks({
  item,
  type,
  onFocus,
}: {
  item: MetaPreview;
  type: string;
  onFocus: () => void;
}) {
  const { t } = useTranslation();
  const collection = useSyncExternalStore(addonCollection.subscribe, addonCollection.get);
  const sports = useSyncExternalStore(sportsState.subscribe, sportsState.get);
  const genres = item.genres.slice(0, MAX_GENRES);
  const key = genres.join('\n');
  const sources = useMemo(
    () =>
      collection.ready && sports.ready && !isKidsProfile()
        ? genres.map((genre) =>
            genreSource(collection.addons, item, type, genre, sports.homeLeaveOut),
          )
        : [],
    // The title's id and genres decide them; the rest of the item may fill in underneath.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [collection, sports.ready, sports.homeLeaveOut, item.id, key, type],
  );
  if (genres.length === 0) return null;
  return (
    <div className={styles.genres}>
      {genres.map((genre, index) => {
        const source = sources[index];
        return (
          <Fragment key={genre}>
            {index > 0 && ' · '}
            {source ? (
              <Pressable
                // By the genre, as React keeps it, so a list that changes as the
                // full details come in keeps each genre's focus.
                focusKey={`details-genre-${genre}`}
                label={t('browsing.browseGenre', { genre, addon: source.addon.manifest.name })}
                className={styles.genre}
                focusedClassName={styles.genreFocused}
                onFocus={onFocus}
                onPress={() =>
                  push({
                    name: 'catalog',
                    transportUrl: source.addon.transportUrl,
                    type,
                    catalogId: source.catalog.id,
                    genre,
                  })
                }
              >
                {genre}
              </Pressable>
            ) : (
              <span>{genre}</span>
            )}
          </Fragment>
        );
      })}
    </div>
  );
});
