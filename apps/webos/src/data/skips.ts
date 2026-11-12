import {
  createIntroDbClient,
  createLearnedIntros,
  type EpisodeMarks,
  type LearnedIntro,
  withLearnedIntro,
} from '@bannertv/core';
import { useMemo, useSyncExternalStore } from 'react';
import { fetchJson } from '../platform/http';
import { queryCache } from './addons';
import { API_SERVICE } from './api-service';
import { profileKv } from './storage';
import { storeNow } from './sync-clock';
import { useQuery } from './use-query';

/**
 * Intro, recap and end credits timings from IntroDB, for Skip intro, Skip
 * recap and Up Next. Asked through BannerTV's service: IntroDB's own answers
 * are open only to its website, so the TV's browser throws them away. IntroDB
 * itself is asked when the service has no answer, which only a phone can
 * read. Not behind the addon request limiter: it is one small request, and an
 * intro starts within a minute or two.
 */
export const skipTimings = createIntroDbClient({
  proxyUrl: API_SERVICE ? `${API_SERVICE}/introdb` : undefined,
  fetchJson,
  queries: queryCache,
});

/**
 * Intros learned from the viewer's own skips, by series, for series IntroDB
 * has no timings for. Per profile, on this screen only (not synced).
 */
export const learnedIntros = createLearnedIntros({ storage: profileKv, now: storeNow });

const NONE: EpisodeMarks = { segments: [] };
const nothingLearned = () => undefined;
const noChange = () => () => undefined;

/**
 * The intro and recap of the episode playing, and its end credits, once
 * IntroDB answers; none while it hasn't, or when `on` is false (the Lab,
 * sports). Where IntroDB has no intro (it answered without one, has nothing
 * for the series, or failed), the intro learned for the series, if any,
 * unless IntroDB says the episode has none.
 */
export function useEpisodeMarks(
  type: string,
  metaId: string,
  videoId: string,
  on: boolean,
): EpisodeMarks {
  const query = useMemo(() => (on ? skipTimings.marks(type, videoId) : null), [on, type, videoId]);
  const answer = useQuery(query);
  const learns = on && type === 'series';
  const learned = useSyncExternalStore<LearnedIntro | undefined>(
    learns ? learnedIntros.subscribe : noChange,
    learns ? () => learnedIntros.get(metaId) : nothingLearned,
  );
  if (learns) void learnedIntros.load();
  const settled = answer.status === 'success' || answer.status === 'error';
  const marks = answer.data ?? NONE;
  return useMemo(() => {
    // Nor where IntroDB's viewers agree there is no intro.
    if (!settled || !learned || marks.noIntro) return marks;
    const segments = withLearnedIntro(marks.segments, learned);
    return segments === marks.segments ? marks : { ...marks, segments };
  }, [settled, learned, marks]);
}
