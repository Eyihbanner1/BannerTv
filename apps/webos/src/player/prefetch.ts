import { parseRuntime } from '@bannertv/core';
import { useEffect, useRef } from 'react';
import type { EventPlay } from '../app/router';
import { preferences } from '../data/preferences';
import { isAndroid } from '../platform/android';
import { knownCapabilities } from '../platform/capabilities';
import { tuning } from '../platform/tuning';
import { stopProbing, type StreamFinder, streamFinder } from './finder';

/**
 * How long focus must rest on Watch or an episode before BannerTV starts
 * looking: 1.5 s unless the `prefetchRestMs` tuning switch says otherwise.
 */
export const PREFETCH_REST_MS = tuning.prefetchRestMs;

/**
 * The rest on a page where nothing moves focus, so opening it is the intent
 * to watch (the phone's title and event pages): still long enough to skip a
 * quick look and back out.
 */
export const OPEN_PAGE_REST_MS = 300;

/**
 * Whether links may be tested before Play. Off on webOS 5 TVs under "auto"
 * until probing has been measured on one (docs/PLAN.md, auto-play). Off on
 * Android too: the test runs in the WebView's player, which fails files
 * Android's own player plays, so it would set good links aside.
 */
export function probingAllowed(): boolean {
  const setting = preferences.get().probing;
  if (setting !== 'auto') return setting === 'on';
  if (isAndroid()) return false;
  return knownCapabilities().webOS !== 5;
}

/** One rest on a video: the wait, then the lookup and the link test. */
export interface Prefetch {
  /** The title's running time, which can arrive after the rest has begun. */
  setRuntime(runtime: string | undefined): void;
  /** Focus moved on: no lookup if the rest has not ended, and any link test stops. */
  stop(): void;
}

/**
 * After `restMs`, asks the addons for the video's streams and then quietly
 * tests the best links. A running time given later goes to the finder, which
 * ranks again by itself: neither the wait nor a link test starts over.
 */
export function startPrefetch(
  type: string,
  videoId: string,
  event: EventPlay | undefined,
  restMs: number,
  runtime: string | undefined,
): Prefetch {
  let finder: StreamFinder | undefined;
  let unsubscribe: (() => void) | undefined;
  const timer = window.setTimeout(() => {
    const found = streamFinder(type, videoId, event);
    finder = found;
    // The running time tells a heavy file from a long one.
    found.setRuntime(parseRuntime(runtime));
    found.start();
    if (!probingAllowed()) return;
    const probeWhenSettled = () => {
      if (!found.get().settled) return;
      unsubscribe?.();
      unsubscribe = undefined;
      found.probe();
    };
    unsubscribe = found.subscribe(probeWhenSettled);
    probeWhenSettled();
  }, restMs);
  return {
    setRuntime(next) {
      runtime = next;
      finder?.setRuntime(parseRuntime(next));
    },
    stop() {
      clearTimeout(timer);
      unsubscribe?.();
      stopProbing();
    },
  };
}

/**
 * While focus rests on Watch or an episode, asks the addons for its streams
 * and then quietly tests the best links, so Play starts at once. Moving on
 * stops the test straight away; the answers stay cached for the player.
 * `restMs`: how long the rest is, PREFETCH_REST_MS by default; a page where
 * nothing moves focus passes a short one that still skips a quick back-out.
 */
export function usePrefetch(
  type: string,
  videoId: string | null,
  runtime?: string,
  event?: EventPlay,
  restMs: number = PREFETCH_REST_MS,
): void {
  const latestRuntime = useRef(runtime);
  const current = useRef<Prefetch | null>(null);
  // Before the rest below, so a rest that begins in the same render reads the new time.
  useEffect(() => {
    latestRuntime.current = runtime;
    current.current?.setRuntime(runtime);
  }, [runtime]);
  useEffect(() => {
    if (videoId === null) return;
    const prefetch = startPrefetch(type, videoId, event, restMs, latestRuntime.current);
    current.current = prefetch;
    return () => {
      current.current = null;
      prefetch.stop();
    };
  }, [type, videoId, event, restMs]);
}
