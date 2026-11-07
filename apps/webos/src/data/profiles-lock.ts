import type { Profile } from '@bannertv/core';

/**
 * Grown-up profiles anyone can open: no kids rating and no PIN. "Who's
 * watching?" opens such a profile at once, so while any of them is left a
 * kids profile does not keep a child to family titles (item A5).
 */
export function unlockedGrownUps(list: readonly Profile[]): Profile[] {
  return list.filter((profile) => !profile.kids && !profile.pin);
}

/**
 * Whether saving `saved` should offer to lock the grown-up profiles: it is a
 * kids profile now, it was not one before (a new profile counts as not), and
 * some grown-up profile has no PIN.
 */
export function offerLockAfterSave(
  before: Profile | undefined,
  saved: Profile | undefined,
  list: readonly Profile[],
): boolean {
  if (!saved?.kids || before?.kids) return false;
  return unlockedGrownUps(list).length > 0;
}
