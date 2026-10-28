import type { MetaPreview } from '@bannertv/protocol';
import type { PlayedVideo } from '../playback/continue';
import type { ProgressEntry } from '../playback/progress';
import type { LibraryItem } from './library';

export type LibraryKind = 'all' | 'movie' | 'series';
export type LibrarySort = 'added' | 'name' | 'year';

/** The most titles History lists. */
export const HISTORY_LIMIT = 200;

/** A saved title as a tile's preview. */
export function libraryPreview(item: LibraryItem): MetaPreview {
  const preview: MetaPreview = {
    id: item.id,
    type: item.type,
    name: item.name,
    posterShape: 'poster',
    genres: item.genres ? item.genres.slice() : [],
    trailers: [],
  };
  if (item.poster) preview.poster = item.poster;
  if (item.background) preview.background = item.background;
  if (item.logo) preview.logo = item.logo;
  if (item.releaseInfo) preview.releaseInfo = item.releaseInfo;
  if (item.imdbRating) preview.imdbRating = item.imdbRating;
  return preview;
}

/** The first year in a release line such as "2008" or "2011–2019"; 0 when there is none. */
function yearOf(releaseInfo: string | undefined): number {
  const match = releaseInfo ? /\d{4}/.exec(releaseInfo) : null;
  return match ? Number(match[0]) : 0;
}

/**
 * My List for the Library screen: one kind or both, newest added first,
 * A to Z, or newest release first (titles with no year last).
 */
export function libraryView(
  items: readonly LibraryItem[],
  kind: LibraryKind,
  sort: LibrarySort,
): MetaPreview[] {
  const chosen = items
    .filter((item) => kind === 'all' || item.type === kind)
    .map((item, index) => ({ item, index }));
  // Chromium 68 sorts unstably, so ties fall back to the saved order by hand.
  if (sort === 'name') {
    chosen.sort(
      (a, b) =>
        a.item.name.localeCompare(b.item.name, 'en', { sensitivity: 'base' }) || a.index - b.index,
    );
  } else if (sort === 'year') {
    chosen.sort(
      (a, b) => yearOf(b.item.releaseInfo) - yearOf(a.item.releaseInfo) || a.index - b.index,
    );
  }
  return chosen.map(({ item }) => libraryPreview(item));
}

/**
 * Everything the profile played, a tile per title, most recent first. Only
 * videos with a saved card (name and artwork) can be shown; progress that
 * came from Trakt alone has none until the title plays here.
 */
export function historyView(
  entries: readonly ProgressEntry[],
  card: (videoId: string) => PlayedVideo | undefined,
  kind: LibraryKind,
): MetaPreview[] {
  const seen = new Set<string>();
  const previews: MetaPreview[] = [];
  for (const entry of entries) {
    if (previews.length >= HISTORY_LIMIT) break;
    if (seen.has(entry.metaId) || (kind !== 'all' && entry.type !== kind)) continue;
    const played = card(entry.videoId);
    if (!played) continue;
    seen.add(entry.metaId);
    const preview: MetaPreview = {
      id: entry.metaId,
      type: entry.type,
      name: played.name,
      posterShape: 'poster',
      genres: played.genres ? played.genres.slice() : [],
      trailers: [],
    };
    if (played.poster) preview.poster = played.poster;
    if (played.background) preview.background = played.background;
    if (played.logo) preview.logo = played.logo;
    if (played.releaseInfo) preview.releaseInfo = played.releaseInfo;
    if (played.imdbRating) preview.imdbRating = played.imdbRating;
    previews.push(preview);
  }
  return previews;
}
