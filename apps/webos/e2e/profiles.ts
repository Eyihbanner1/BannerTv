import type { Page } from '@playwright/test';
import {
  makePin,
  type Profile,
  type ProfilesState,
} from '../../../packages/core/src/profiles/profiles';

export const KIDS_ID = 'kids23';
export const GUEST_ID = 'guest4';

export function lockedWith(digits: string): Pick<Profile, 'pin'> {
  return { pin: makePin(digits, Math.random) };
}

/**
 * Starts the TV with these profiles saved, as if they were added on an
 * earlier day. Only the first launch of the test is seeded: what the app
 * saves later (a switch, a new profile) survives a reload. A reload is
 * never seeded, as nothing seeds a TV's: Chromium here can start one before
 * the last localStorage writes have arrived, and the app must cope with that.
 */
export async function seedProfiles(page: Page, state: ProfilesState): Promise<void> {
  await page.addInitScript((saved) => {
    const navigation = performance.getEntriesByType('navigation')[0] as
      PerformanceNavigationTiming | undefined;
    if (navigation?.type === 'reload') return;
    if (localStorage.getItem('bannertv.profiles') === null) {
      localStorage.setItem('bannertv.profiles', saved);
    }
  }, JSON.stringify(state));
}

export const main = (extra: Partial<Profile> = {}): Profile => ({
  id: 'main',
  name: 'Main',
  colour: 0,
  ...extra,
});
