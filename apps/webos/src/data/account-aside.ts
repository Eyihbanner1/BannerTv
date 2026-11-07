import type { AsideCopy } from '@bannertv/core';
import type { TFunction } from 'i18next';
import { MAIN_NAME } from './profiles';

/*
 * The words for the copy a join with Use keeps of a screen, as Settings >
 * BannerTV account shows it on the TV and on the phone. Kept here rather
 * than in a screen, so the phone, which cannot import the TV's screens,
 * shares them.
 */

/** The day the copy runs out, as "6 December 2026". */
export function asideDate(until: number): string {
  return new Date(until).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/** What the copy holds, a line each: its profiles, My List, what was part way, and its addons. */
export function asideLines(t: TFunction, copy: AsideCopy): string[] {
  const names = copy.profiles.map((profile) => profile.name ?? MAIN_NAME);
  const lines = [t('account.aside.profiles', { count: names.length, names: names.join(', ') })];
  if (copy.list > 0) lines.push(t('account.aside.list', { count: copy.list }));
  if (copy.watching > 0) lines.push(t('account.aside.watching', { count: copy.watching }));
  if (copy.addons.length > 0) {
    lines.push(t('account.aside.addons', { names: copy.addons.join(', ') }));
  }
  return lines;
}

/**
 * Whether bringing the copy back would put profiles back on this screen's
 * list, which starts the app again: one of its profiles is not there now.
 */
export function asideRestarts(copy: AsideCopy, here: readonly { id: string }[]): boolean {
  return copy.profiles.some((profile) => !here.some((other) => other.id === profile.id));
}
