import { MAX_PROFILES, type JoinMode, type SyncStatus } from '@bannertv/core';
import type { AccountProfile } from '@tv/data/sync';
import type { TFunction } from 'i18next';

/*
 * The account screen's wording, as the TV's settings/AccountScreen.tsx has it. That file draws
 * with the remote's focus library, so the phone keeps its own copy of these pure helpers.
 */

const MINUTE_MS = 60_000;

/** One line on how the account's syncing is going. */
export function statusLine(t: TFunction, status: SyncStatus, now: number): string {
  if (status.state === 'syncing') return t('account.status.syncing');
  if (status.state === 'waiting') return t('account.status.waiting');
  if (status.state === 'paused') return t(`account.status.paused.${status.reason ?? 'offline'}`);
  if (status.lastSync === undefined) return t('account.status.idle');
  const minutes = Math.floor(Math.max(0, now - status.lastSync) / MINUTE_MS);
  if (minutes < 1) return t('account.status.justNow');
  if (minutes < 60) return t('account.status.minutes', { count: minutes });
  if (minutes < 24 * 60) return t('account.status.hours', { count: Math.floor(minutes / 60) });
  return t('account.status.days', { count: Math.floor(minutes / (24 * 60)) });
}

/** What happens to each profile, here and in the account, when joining one way or the other. */
export function joinPlan(
  t: TFunction,
  mode: JoinMode,
  here: readonly AccountProfile[],
  account: readonly AccountProfile[],
): string[] {
  const lines: string[] = [];
  for (const profile of here) {
    const there = account.find((other) => other.id === profile.id);
    if (mode === 'bring') {
      lines.push(
        there
          ? t('account.planJoins', { name: profile.name, other: there.name })
          : t('account.planAdded', { name: profile.name }),
      );
    } else {
      lines.push(
        there
          ? t('account.planReplaced', { name: profile.name, other: there.name })
          : t('account.planRemoved', { name: profile.name }),
      );
    }
  }
  for (const profile of account) {
    if (!here.some((other) => other.id === profile.id)) {
      lines.push(t('account.planArrives', { name: profile.name }));
    }
  }
  return lines;
}

/** How many profiles bringing this phone's would make, and whether that is too many. */
export function bringTotal(
  here: readonly AccountProfile[],
  account: readonly AccountProfile[],
): { total: number; tooMany: boolean } {
  const total =
    account.length + here.filter((profile) => !account.some((a) => a.id === profile.id)).length;
  return { total, tooMany: total > MAX_PROFILES };
}

/**
 * Whether `typed` is the last four characters of the new account's `code`, typed back so the
 * person knows they have it. Capitals, spaces and dashes don't matter, as on the TV.
 */
export function matchesLastFour(typed: string, code: string): boolean {
  return typed.toUpperCase().replace(/[\s-]+/g, '') === code.slice(-4);
}
