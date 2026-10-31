import { parseRuntime } from '@bannertv/core';
import { useEffect } from 'react';
import type { EventPlay } from '../app/router';
import { preferences } from '../data/preferences';
import { isAndroid } from '../platform/android';
import { knownCapabilities } from '../platform/capabilities';
import { stopProbing, streamFinder } from './finder';

/** How long focus must rest on Watch or an episode before BannerTV starts looking. */
export const PREFETCH_REST_MS = 1500;

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

/**
 * While focus rests on Watch or an episode, asks the addons for its streams
 * and then quietly tests the best links, so Play starts at once. Moving on
 * stops the test straight away; the answers stay cached for the player.
 */
export function usePrefetch(
  type: string,
  videoId: string | null,
  runtime?: string,
  event?: EventPlay,
): void {
  useEffect(() => {
    if (videoId === null) return;
    let unsubscribe: (() => void) | undefined;
    const timer = window.setTimeout(() => {
      const finder = streamFinder(type, videoId, event);
      // The running time tells a heavy file from a long one.
      finder.setRuntime(parseRuntime(runtime));
      finder.start();
      if (!probingAllowed()) return;
      const probeWhenSettled = () => {
        if (!finder.get().settled) return;
        unsubscribe?.();
        unsubscribe = undefined;
        finder.probe();
      };
      unsubscribe = finder.subscribe(probeWhenSettled);
      probeWhenSettled();
    }, PREFETCH_REST_MS);
    return () => {
      clearTimeout(timer);
      unsubscribe?.();
      stopProbing();
    };
  }, [type, videoId, runtime, event]);
}
