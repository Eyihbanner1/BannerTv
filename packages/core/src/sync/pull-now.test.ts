import type { MetaPreview } from '@bannertv/protocol';
import { describe, expect, it } from 'vitest';
import { profileKeyPrefix } from '../profiles/profiles';
import { profileKeyValueStore } from '../profiles/scoped';
import { memoryKeyValueStore } from '../storage';
import { createAccountClock } from './clock';
import { createSyncEngine } from './engine';
import { createProfileStores, profileParts } from './parts';
import { fakeSyncService, manualTimers, memoryPart, webCryptoForTests } from './testing';

const crypto = webCryptoForTests();
const START = Date.UTC(2026, 10, 6, 12, 0, 0) + 123;

function preview(id: string): MetaPreview {
  return {
    id,
    type: 'movie',
    name: `Title ${id}`,
    posterShape: 'poster',
    genres: [],
    trailers: [],
  };
}

function world() {
  const time = manualTimers();
  const now = () => START + time.elapsed();
  return { time, service: fakeSyncService({ now, maxAccounts: 1 }), now };
}

/** One screen with Main as its only profile. */
function screen(w: ReturnType<typeof world>) {
  const storage = memoryKeyValueStore();
  const clock = createAccountClock({ now: w.now });
  const profiles = memoryPart('profiles');
  profiles.set('main', 1, 0);
  const storesOf = (id: string) =>
    createProfileStores(
      profileKeyValueStore(storage, Promise.resolve(profileKeyPrefix(id))),
      clock.now,
    );
  const stores = storesOf('main');
  const engine = createSyncEngine({
    crypto,
    transport: w.service.transport,
    storage,
    clock,
    timers: w.time.timers,
    accountParts: [profiles.part, memoryPart('addons', ['a/', 'order']).part],
    profileParts: (id) => profileParts(id, storesOf(id)),
    onJoined: () => undefined,
  });
  return {
    stores,
    engine,
    start: () => engine.start({ id: 'main', parts: profileParts('main', stores) }),
  };
}

describe('pullNow (a screen opening Who’s watching or Settings, Profiles)', () => {
  it('brings what another screen changed without waiting for the timer', async () => {
    const w = world();
    const a = screen(w);
    await a.start();
    const code = await a.engine.create();
    await a.engine.confirmCreate();
    const b = screen(w);
    await b.start();
    await b.engine.join(code, 'use');

    await a.stores.library.add(preview('a1'));
    await a.engine.flush();
    expect(b.stores.library.get('a1')).toBeUndefined();
    await b.engine.pullNow();
    expect(b.stores.library.get('a1')).toBeDefined();
  });

  it('asks nothing while the service is being given time to come back', async () => {
    const w = world();
    const a = screen(w);
    await a.start();
    await a.engine.create();
    await a.engine.confirmCreate();
    for (let i = 0; i < 3; i++) w.service.failNext({ network: true });
    await a.engine.syncNow();
    expect(a.engine.status()).toMatchObject({ state: 'paused', reason: 'offline' });
    const pulls = w.service.count('/v1/pull');
    await a.engine.pullNow();
    expect(w.service.count('/v1/pull')).toBe(pulls);
  });

  it('asks nothing on a screen with no account', async () => {
    const w = world();
    const a = screen(w);
    await a.start();
    await a.engine.pullNow();
    expect(w.service.requests).toEqual([]);
  });
});
