import { createIntroDbClient, type SkipSegment } from '@bannertv/core';
import { useMemo } from 'react';
import { fetchJson } from '../platform/http';
import { queryCache } from './addons';
import { useQuery } from './use-query';

/**
 * Intro and recap timings from IntroDB, for Skip intro and Skip recap. Not
 * behind the addon request limiter: it is one small request to its own host,
 * and an intro starts within a minute or two.
 */
export const skipTimings = createIntroDbClient({ fetchJson, queries: queryCache });

const NONE: readonly SkipSegment[] = [];

/**
 * The intro and recap of the episode playing, once IntroDB answers; none
 * while it hasn't, if it failed, or when `on` is false (the Lab, sports).
 */
export function useSkipSegments(
  type: string,
  videoId: string,
  on: boolean,
): readonly SkipSegment[] {
  const query = useMemo(
    () => (on ? skipTimings.segments(type, videoId) : null),
    [on, type, videoId],
  );
  return useQuery(query).data ?? NONE;
}
