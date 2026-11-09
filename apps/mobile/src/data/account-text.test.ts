import type { SyncStatus } from '@bannertv/core';
import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';
import { bringTotal, joinPlan, matchesLastFour, statusLine, syncedLine } from './account-text';

const t = ((key: string, options?: Record<string, unknown>) =>
  options ? `${key} ${JSON.stringify(options)}` : key) as unknown as TFunction;

describe('statusLine', () => {
  const now = 10 * 24 * 60 * 60_000;
  it('names the state while syncing, waiting or paused', () => {
    expect(statusLine(t, { state: 'syncing' }, now)).toBe('account.status.syncing');
    expect(statusLine(t, { state: 'waiting' }, now)).toBe('account.status.waiting');
    expect(statusLine(t, { state: 'paused' }, now)).toBe('account.status.paused.offline');
    expect(statusLine(t, { state: 'paused', reason: 'limit' }, now)).toBe(
      'account.status.paused.limit',
    );
  });
  it('says how long ago it last synced', () => {
    expect(statusLine(t, { state: 'idle' }, now)).toBe('account.status.idle');
    expect(statusLine(t, { state: 'idle', lastSync: now - 30_000 }, now)).toBe(
      'account.status.justNow',
    );
    expect(statusLine(t, { state: 'idle', lastSync: now - 5 * 60_000 }, now)).toBe(
      'account.status.minutes {"count":5}',
    );
    expect(statusLine(t, { state: 'idle', lastSync: now - 3 * 60 * 60_000 }, now)).toBe(
      'account.status.hours {"count":3}',
    );
    expect(statusLine(t, { state: 'idle', lastSync: now - 2 * 24 * 60 * 60_000 }, now)).toBe(
      'account.status.days {"count":2}',
    );
  });
});

describe('syncedLine', () => {
  const now = 10 * 24 * 60 * 60_000;
  const line = (status: SyncStatus, profileId: string | null = 'main') =>
    syncedLine(t, status, now, profileId);
  it('says how long ago the account was last pulled', () => {
    expect(line({ state: 'idle', lastPull: now - 30_000 })).toBe('phone.synced.justNow');
    // A pull that came in after the clock was last read is just now too.
    expect(line({ state: 'idle', lastPull: now + 5_000 })).toBe('phone.synced.justNow');
    expect(line({ state: 'syncing', lastPull: now - 3 * 60_000 })).toBe(
      'phone.synced.minutes {"count":3}',
    );
    expect(line({ state: 'paused', lastPull: now - 2 * 60 * 60_000 })).toBe(
      'phone.synced.hours {"count":2}',
    );
    expect(line({ state: 'waiting', lastPull: now - 3 * 24 * 60 * 60_000 })).toBe(
      'phone.synced.days {"count":3}',
    );
  });
  it('says nothing before the first pull, or without an account', () => {
    // A sync that only pushed is not a look at what other screens changed.
    expect(line({ state: 'idle', lastSync: now })).toBeUndefined();
    expect(line({ state: 'off', lastSync: now, lastPull: now })).toBeUndefined();
    expect(line({ state: 'setup', lastPull: now })).toBeUndefined();
    expect(line({ state: 'gone', lastPull: now })).toBeUndefined();
  });
  it('says nothing away from Main, as only Main sees the account', () => {
    // A kids profile is never Main; nor is any other profile, nor none chosen yet.
    expect(line({ state: 'idle', lastPull: now }, 'kids1')).toBeUndefined();
    expect(line({ state: 'idle', lastPull: now }, 'guest4')).toBeUndefined();
    expect(line({ state: 'idle', lastPull: now }, null)).toBeUndefined();
  });
});

describe('joinPlan', () => {
  const here = [
    { id: 'main', name: 'Main' },
    { id: 'kid', name: 'Ada' },
  ];
  const account = [
    { id: 'main', name: 'Eyitayo' },
    { id: 'tv', name: 'Guest' },
  ];
  it('says who joins, who is added and who arrives when bringing', () => {
    expect(joinPlan(t, 'bring', here, account)).toEqual([
      'account.planJoins {"name":"Main","other":"Eyitayo"}',
      'account.planAdded {"name":"Ada"}',
      'account.planArrives {"name":"Guest"}',
    ]);
  });
  it('says who is replaced and who is removed when using the account', () => {
    expect(joinPlan(t, 'use', here, account)).toEqual([
      'account.planReplaced {"name":"Main","other":"Eyitayo"}',
      'account.planRemoved {"name":"Ada"}',
      'account.planArrives {"name":"Guest"}',
    ]);
  });
});

describe('bringTotal', () => {
  it('counts profiles in both once', () => {
    const here = [{ id: 'main', name: 'Main' }];
    const account = [{ id: 'main', name: 'Main' }];
    expect(bringTotal(here, account)).toEqual({ total: 1, tooMany: false });
  });
  it('refuses more than six', () => {
    const account = Array.from({ length: 5 }, (_, i) => ({ id: `a${i}`, name: `A${i}` }));
    const here = [
      { id: 'b1', name: 'B1' },
      { id: 'b2', name: 'B2' },
    ];
    expect(bringTotal(here, account)).toEqual({ total: 7, tooMany: true });
  });
});

describe('matchesLastFour', () => {
  const code = 'ABCD2345EFGH6789JKLM';
  it('takes the last four in any case, with spaces and dashes', () => {
    expect(matchesLastFour('JKLM', code)).toBe(true);
    expect(matchesLastFour(' jk-lm ', code)).toBe(true);
  });
  it('refuses anything else', () => {
    expect(matchesLastFour('', code)).toBe(false);
    expect(matchesLastFour('KLM', code)).toBe(false);
    expect(matchesLastFour('HJKLM', code)).toBe(false);
  });
});
