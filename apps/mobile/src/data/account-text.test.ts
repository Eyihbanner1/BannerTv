import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';
import { bringTotal, joinPlan, statusLine } from './account-text';

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
