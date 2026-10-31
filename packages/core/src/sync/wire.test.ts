import { describe, expect, it, vi } from 'vitest';
import { createAccountClock } from './clock';
import {
  checkSyncService,
  readPullAnswer,
  readPushAnswer,
  readRefusal,
  readServiceStatus,
  type SyncTransport,
} from './wire';

describe('readServiceStatus', () => {
  it('reads the status, keeping pullMinutes between 15 minutes and a day', () => {
    expect(readServiceStatus({ ok: true, v: 1, now: 1, create: true, pullMinutes: 30 })).toEqual({
      create: true,
      pullMinutes: 30,
    });
    expect(readServiceStatus({ ok: true, v: 1, pullMinutes: 1 })!.pullMinutes).toBe(15);
    expect(readServiceStatus({ ok: true, v: 1, pullMinutes: 1e9 })!.pullMinutes).toBe(1440);
    expect(readServiceStatus({ ok: true, v: 1 })).toEqual({ create: false, pullMinutes: 30 });
    expect(readServiceStatus({ ok: true, v: 2 })).toBeUndefined();
    expect(readServiceStatus('ok')).toBeUndefined();
  });
});

describe('checkSyncService', () => {
  it('asks for the status and sets the account clock from it', async () => {
    let local = 1000;
    const clock = createAccountClock({ now: () => local });
    const transport: SyncTransport = {
      get: vi.fn(() => {
        local += 200;
        return Promise.resolve({
          status: 200,
          body: { ok: true, v: 1, now: 50000, create: false, pullMinutes: 30 },
        });
      }),
      post: () => Promise.reject(new Error('unused')),
    };
    expect(await checkSyncService(transport, clock)).toEqual({ create: false, pullMinutes: 30 });
    expect(transport.get).toHaveBeenCalledWith('/v1/status');
    expect(clock.now()).toBe(50100);
  });

  it('is undefined when nothing or something else answers', async () => {
    const offline: SyncTransport = {
      get: () => Promise.reject(new Error('Network')),
      post: () => Promise.reject(new Error('Network')),
    };
    expect(await checkSyncService(offline)).toBeUndefined();
    const broken: SyncTransport = {
      get: () => Promise.resolve({ status: 503, body: { error: 'unavailable', now: 1 } }),
      post: offline.post,
    };
    expect(await checkSyncService(broken)).toBeUndefined();
  });
});

describe('answers', () => {
  it('reads a pull, leaving out anything malformed', () => {
    const answer = readPullAnswer({
      now: 1,
      epoch: 'e',
      vers: { a: 2, b: -1, __proto__x: 1 },
      docs: { a: { ver: 2, at: 5, body: '1.x.y' }, c: { ver: 'no', at: 5, body: '1.x.y' } },
      more: true,
    })!;
    expect(answer.epoch).toBe('e');
    expect(Array.from(answer.vers)).toEqual([
      ['a', 2],
      ['__proto__x', 1],
    ]);
    expect(Array.from(answer.docs.keys())).toEqual(['a']);
    expect(answer.more).toBe(true);
    expect(readPullAnswer({ now: 1 })).toBeUndefined();
  });

  it('reads a push', () => {
    expect(
      readPushAnswer({
        epoch: 'e',
        done: [{ name: 'a', ver: 3, at: 9 }, { name: 'b' }],
        conflicts: ['c', 4],
      }),
    ).toEqual({ epoch: 'e', done: [{ name: 'a', ver: 3, at: 9 }], conflicts: ['c'] });
  });

  it('reads a refusal', () => {
    expect(readRefusal({ error: 'limit', now: 1, retryAfter: 60 })).toEqual({
      error: 'limit',
      retryAfter: 60,
    });
    expect(readRefusal('Bad gateway')).toEqual({});
  });
});
