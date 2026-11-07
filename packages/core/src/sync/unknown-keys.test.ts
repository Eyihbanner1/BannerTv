import { describe, expect, it } from 'vitest';
import { profileKeyPrefix } from '../profiles/profiles';
import { profileKeyValueStore } from '../profiles/scoped';
import { type KeyValueStore, memoryKeyValueStore } from '../storage';
import { createAccountClock } from './clock';
import { createSyncEngine } from './engine';
import type { Items } from './items';
import { deriveAccountKeys, wireName } from './keys';
import { createProfileStores, profileParts } from './parts';
import { openDocument } from './seal';
import { fakeSyncService, manualTimers, memoryPart, webCryptoForTests } from './testing';

const crypto = webCryptoForTests();
const START = Date.UTC(2026, 10, 7, 3, 0, 0);
const SETTINGS = 'p/main/settings';

async function settle() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

function world() {
  const time = manualTimers();
  const now = () => START + time.elapsed();
  return { time, now, service: fakeSyncService({ now }) };
}

type World = ReturnType<typeof world>;

/**
 * A screen with the usual profile parts. Unless `older`, it also has a part
 * for `drift/` items in the profile's settings, as a newer build would.
 */
function screen(w: World, options: { older?: boolean; storage?: KeyValueStore } = {}) {
  const storage = options.storage ?? memoryKeyValueStore();
  const clock = createAccountClock({ now: w.now });
  const profiles = memoryPart('profiles');
  profiles.set('main', 1, 0);
  const drifts = memoryPart(SETTINGS, ['drift/']);
  const stores = createProfileStores(
    profileKeyValueStore(storage, Promise.resolve(profileKeyPrefix('main'))),
    clock.now,
  );
  const partsOf = () => {
    const parts = profileParts('main', stores);
    return options.older ? parts : [...parts, drifts.part];
  };
  const engine = createSyncEngine({
    crypto,
    transport: w.service.transport,
    storage,
    clock,
    timers: w.time.timers,
    accountParts: [profiles.part],
    profileParts: partsOf,
  });
  return {
    storage,
    stores,
    drifts,
    engine,
    start: () => engine.start({ id: 'main', parts: partsOf() }),
  };
}

async function accountSettings(w: World, code: string): Promise<Items> {
  const keys = await deriveAccountKeys(crypto, code);
  const doc = w.service.documents(keys.accountId).get(await wireName(crypto, keys, SETTINGS))!;
  return openDocument(crypto, keys, SETTINGS, doc.ver, doc.body);
}

describe('a profile setting a build has no part for', () => {
  it('stays in the account through that build’s own pushes, catch-up and restarts', async () => {
    const w = world();
    const a = screen(w);
    await a.start();
    await a.stores.subtitleOffsets.remember('file-1', 1.5);
    a.drifts.set('drift/file-1', 'auto');
    a.drifts.set('drift/file-2', 'ahead');
    await settle();
    const code = await a.engine.create();
    await a.engine.confirmCreate();
    await a.engine.flush();
    expect(await accountSettings(w, code)).toMatchObject({
      'offset/file-1': { v: 1.5 },
      'drift/file-1': { v: 'auto' },
      'drift/file-2': { v: 'ahead' },
    });

    // An older screen joins, changes a timing of its own and pushes.
    const old = screen(w, { older: true });
    await old.start();
    await old.engine.join(code, 'use');
    await settle();
    await w.time.advance(1000);
    await old.stores.subtitleOffsets.remember('file-1', -2);
    await old.stores.subtitleOffsets.remember('file-3', 0.5);
    await settle();
    await old.engine.flush();
    let items = await accountSettings(w, code);
    expect(items['offset/file-1']).toMatchObject({ v: -2 });
    expect(items['offset/file-3']).toMatchObject({ v: 0.5 });
    expect(items['drift/file-1']).toMatchObject({ v: 'auto' });
    expect(items['drift/file-2']).toMatchObject({ v: 'ahead' });

    // Restarted, it catches up with the account: still nothing sent about drift/.
    const again = screen(w, { older: true, storage: old.storage });
    await again.start();
    await settle();
    await again.engine.syncNow();
    await settle();
    await again.engine.flush();
    items = await accountSettings(w, code);
    expect(items['drift/file-1']).toMatchObject({ v: 'auto' });
    expect(items['drift/file-2']).toMatchObject({ v: 'ahead' });

    // The newer screen takes the timing and keeps its drifts.
    await a.engine.syncNow();
    await settle();
    expect(a.stores.subtitleOffsets.get('file-1')).toBe(-2);
    expect(a.drifts.get('drift/file-1')).toMatchObject({ v: 'auto' });
    expect(a.drifts.get('drift/file-2')).toMatchObject({ v: 'ahead' });

    // Updated in place, the older screen brings the account's drifts in.
    const updated = screen(w, { storage: old.storage });
    await updated.start();
    await settle();
    await updated.engine.syncNow();
    await settle();
    expect(updated.drifts.keys()).toEqual(['drift/file-1', 'drift/file-2']);
    expect((await accountSettings(w, code))['drift/file-2']).toMatchObject({ v: 'ahead' });
  });
});
