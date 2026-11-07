import { formatHelperAddress } from '@tv/data/stream-helper';
import type { AndroidHelperState } from '@tv/platform/android';

/*
 * The stream helper screen's rules, as the TV's settings/StreamHelperScreen.tsx (RunHelper) has
 * them. That file draws with the remote's focus library, so the phone keeps these pure ones here.
 */

/** How often the open screen reads the helper again: its code changes once a TV pairs. */
export const HELPER_POLL_MS = 2000;

/** The service starts or stops a moment after the command, so the screen reads it again then. */
export const HELPER_SETTLE_MS = 500;

export interface HelperView {
  on: boolean;
  /** What to type on the TV, or null while off or on no network the TV can reach. */
  pairing: { address: string; code: string } | null;
  /** On, but not on Wi-Fi or Ethernet, so there is no address to show. */
  noWifi: boolean;
  /** How many paired TVs "Forget" would unpair; 0 hides it. */
  paired: number;
}

export function helperView(state: AndroidHelperState): HelperView {
  const pairing =
    state.on && state.address && state.port
      ? {
          address: formatHelperAddress({ host: state.address, port: state.port }),
          code: state.code ?? '',
        }
      : null;
  return {
    on: state.on,
    pairing,
    noWifi: state.on && pairing === null,
    paired: state.paired > 0 ? Math.floor(state.paired) : 0,
  };
}

/** Whether Android asks before the app may show notifications: Android 13 (API 33) and later. */
export function asksForNotifications(os: string, version: number | string): boolean {
  return os === 'android' && typeof version === 'number' && version >= 33;
}
