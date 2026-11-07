import type { QueryState } from '@bannertv/core';
import { useEffect, useRef } from 'react';
import { addonCollection } from '../data/addons';
import { homeLayout } from '../data/library';
import { playedVideos, progress } from '../data/playback';
import { launchKind, scriptAt } from '../platform/boot';
import { bootMark } from '../platform/marks';
import { tuning } from '../platform/tuning';

/** The navigation's own steps read beside the marks, by their PerformanceNavigationTiming names. */
const NAVIGATION_STEPS = [
  'responseEnd',
  'domInteractive',
  'domContentLoadedEventEnd',
  'loadEventEnd',
] as const;

/** Marks of the launch: `boot:` steps, and the team and league data's `matcher:` ones. */
const LAUNCH_MARK = /^(?:boot|matcher):/;

export interface BootReport {
  /** `cold` for a start, `reload` for the app starting itself again (see launchKind). */
  launch: string;
  /**
   * Each step's time in ms since the page began to load, in time order:
   * `nav:` steps of the navigation, `paint:` ones, then the marks.
   */
  steps: Record<string, number>;
}

const tenths = (ms: number) => Math.round(ms * 10) / 10;

/** The launch so far, from the page's navigation and paint entries and the launch marks. */
export function readBoot(): BootReport {
  const steps: Array<[string, number]> = [];
  const add = (name: string, at: number) => {
    if (at > 0) steps.push([name, tenths(at)]);
  };
  const [navigation] = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[];
  if (navigation) for (const step of NAVIGATION_STEPS) add(`nav:${step}`, navigation[step]);
  for (const entry of performance.getEntriesByType('paint'))
    add(`paint:${entry.name}`, entry.startTime);
  for (const entry of performance.getEntriesByType('mark')) {
    if (LAUNCH_MARK.test(entry.name)) add(entry.name, entry.startTime);
  }
  steps.sort((a, b) => a[1] - b[1]);
  const ordered: Record<string, number> = {};
  for (const [name, at] of steps) if (!(name in ordered)) ordered[name] = at;
  return { launch: launchKind(), steps: ordered };
}

declare global {
  interface Window {
    __bannertvBoot?: () => BootReport;
  }
}

/**
 * Where a Home row's tiles came from, followed through its query's states:
 * the first fill is `cached` when the row was not fetched for it, and
 * `network` once an addon's answer is in. A row already filled when it was
 * drawn (this session's memory) tells nothing until it is fetched again.
 */
export function rowFills(): (state: QueryState<unknown>) => 'cached' | 'network' | undefined {
  let last: QueryState<unknown> | undefined;
  let fetched = false;
  let fills = 0;
  return (state) => {
    if (state === last) return undefined;
    const first = last === undefined;
    last = state;
    if (state.status === 'loading') fetched = true;
    if (state.status !== 'success' || state.error) return undefined;
    const from = fetched || fills > 0 ? 'network' : 'cached';
    fills++;
    return first ? undefined : from;
  };
}

/**
 * With the `marks` switch, marks the first time a Home row is filled from
 * the cache (`boot:first-row-cached`) and from an addon's answer
 * (`boot:first-row-network`).
 */
export function useRowFillMarks(query: object, state: QueryState<unknown>): void {
  const followed = useRef<{ query: object; fills: ReturnType<typeof rowFills> } | null>(null);
  useEffect(() => {
    if (!tuning.marks) return;
    if (followed.current?.query !== query) followed.current = { query, fills: rowFills() };
    const from = followed.current.fills(state);
    if (from) bootMark(`boot:first-row-${from}`);
  }, [query, state]);
}

/**
 * With the `marks` switch, marks the steps of the launch that are read
 * rather than drawn (the bundle running, the addon collection, the profile's
 * Home layout and Continue Watching read), and sets `window.__bannertvBoot()`
 * for the web inspector. Off, as it ships, it does nothing.
 */
export function startBootMarks(): void {
  if (!tuning.marks) return;
  bootMark('boot:script', scriptAt);
  const onCollection = () => {
    if (!addonCollection.get().ready) return;
    bootMark('boot:addons-read');
    stopCollection();
  };
  const stopCollection = addonCollection.subscribe(onCollection);
  onCollection();
  // Each of these is read once and shared: asking again starts nothing new.
  void homeLayout.load().then(
    () => bootMark('boot:layout-read'),
    () => undefined,
  );
  void Promise.all([progress.load(), playedVideos.load()]).then(
    () => bootMark('boot:continue-read'),
    () => undefined,
  );
  window.__bannertvBoot = readBoot;
}
