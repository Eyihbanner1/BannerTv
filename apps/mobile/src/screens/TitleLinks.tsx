import { genreSource, type TmdbPerson, tmdbImageUrl } from '@bannertv/core';
import type { MetaPreview } from '@bannertv/protocol';
import { addonCollection } from '@tv/data/addons';
import { isKidsProfile } from '@tv/data/profiles';
import { sportsState } from '@tv/data/sports';
import { Fragment, useMemo, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { openCatalog, openSearch } from '../nav/routes';
import { Artwork } from '../ui/Artwork';
import { colors, radius, space, touch, type } from '../ui/theme';

const MAX_GENRES = 4;
const MAX_PEOPLE = 12;
const FACE = 64;
// A genre is a line of text: its tap target grows to touch.min tall.
const GENRE_SLOP = {
  top: (touch.min - type.meta.lineHeight) / 2,
  bottom: (touch.min - type.meta.lineHeight) / 2,
  left: space.xs,
  right: space.xs,
};

/**
 * A title's genres. Each one an addon can filter its catalogs of the title's
 * type by opens that catalog on it, as the TV's Details does; the rest stay
 * words. A kids profile browses Family only, so its genres stay words.
 */
export function GenreLinks({ item, type: kind }: { item: MetaPreview; type: string }) {
  const { t } = useTranslation();
  const collection = useSyncExternalStore(addonCollection.subscribe, addonCollection.get);
  const sports = useSyncExternalStore(sportsState.subscribe, sportsState.get);
  const genres = item.genres.slice(0, MAX_GENRES);
  const key = genres.join('\n');
  const sources = useMemo(
    () =>
      collection.ready && sports.ready && !isKidsProfile()
        ? genres.map((genre) =>
            genreSource(collection.addons, item, kind, genre, sports.homeLeaveOut),
          )
        : [],
    // The title's id and genres decide them; the rest of the item may fill in underneath.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [collection, sports.ready, sports.homeLeaveOut, item.id, key, kind],
  );
  if (genres.length === 0) return null;
  return (
    <View style={styles.genres}>
      {genres.map((genre, index) => {
        const source = sources[index];
        return (
          <Fragment key={genre}>
            {index > 0 ? <Text style={styles.genreText}>·</Text> : null}
            {source ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('browsing.browseGenre', {
                  genre,
                  addon: source.addon.manifest.name,
                })}
                hitSlop={GENRE_SLOP}
                onPress={() =>
                  openCatalog({
                    transportUrl: source.addon.transportUrl,
                    type: kind,
                    catalogId: source.catalog.id,
                    genre,
                    title: t('browsing.genreFrom', { genre, addon: source.addon.manifest.name }),
                  })
                }
                style={({ pressed }) => [styles.genre, pressed && styles.pressed]}
              >
                <Text style={styles.genreLink}>{genre}</Text>
              </Pressable>
            ) : (
              <Text style={styles.genreText}>{genre}</Text>
            )}
          </Fragment>
        );
      })}
    </View>
  );
}

/**
 * The cast, with TMDB's photos where it has them, else the addon's names.
 * A tap opens Search on the name, which answers a full name with a row of
 * that person's films and series.
 */
export function CastList({
  people,
  names,
}: {
  /** TMDB's cast, in billing order, when TMDB is on. */
  people: readonly TmdbPerson[] | undefined;
  /** The addon's cast names, for when TMDB has none. */
  names: readonly string[];
}) {
  const { t } = useTranslation();
  const cast: ReadonlyArray<{ name: string; photo?: string }> =
    people && people.length > 0
      ? people.slice(0, MAX_PEOPLE).map((person) => {
          const photo = tmdbImageUrl(person.profilePath, 'w185');
          return photo ? { name: person.name, photo } : { name: person.name };
        })
      : names.slice(0, MAX_PEOPLE).map((name) => ({ name }));
  if (cast.length === 0) return null;
  return (
    <View>
      <Text style={styles.heading} accessibilityRole="header">
        {t('details.castTitle')}
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.cast}
      >
        {cast.map((person, index) => (
          <Pressable
            key={`${index}:${person.name}`}
            accessibilityRole="button"
            accessibilityLabel={t('browsing.searchPerson', { name: person.name })}
            onPress={() => openSearch(person.name)}
            style={({ pressed }) => [styles.person, pressed && styles.pressed]}
          >
            <Artwork
              src={person.photo}
              seed={person.name}
              style={styles.face}
              fallback={
                <View style={[styles.face, styles.initials]}>
                  <Text style={styles.initialsText}>{initials(person.name)}</Text>
                </View>
              }
            />
            <Text style={styles.personName} numberOfLines={2}>
              {person.name}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase())
    .join('');
}

const styles = StyleSheet.create({
  genres: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.xs },
  genre: { borderRadius: radius.s, paddingHorizontal: space.xs },
  genreLink: {
    ...type.meta,
    color: colors.textSoft,
    textDecorationLine: 'underline',
  },
  genreText: { ...type.meta, color: colors.textMuted },
  pressed: { backgroundColor: colors.raised },
  heading: { ...type.label, color: colors.text, marginBottom: space.s },
  cast: { gap: space.m },
  person: { width: FACE + space.xl, alignItems: 'center', borderRadius: radius.m },
  face: { width: FACE, height: FACE, borderRadius: FACE / 2, overflow: 'hidden' },
  initials: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface2,
  },
  initialsText: { ...type.label, color: colors.textSoft },
  personName: {
    ...type.small,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: space.xs,
  },
});
