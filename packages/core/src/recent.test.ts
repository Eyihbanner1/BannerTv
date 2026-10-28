import { describe, expect, it } from 'vitest';
import { createRecentList } from './recent';
import { memoryKeyValueStore } from './storage';

describe('createRecentList', () => {
  it('keeps the newest first, once each whatever the case, up to the limit', async () => {
    const storage = memoryKeyValueStore();
    const recent = createRecentList({ storage, key: 'recent', max: 3 });
    await recent.load();
    recent.add(' dune ');
    recent.add('Alien');
    recent.add('');
    recent.add('DUNE');
    recent.add('Heat');
    recent.add('Up');
    expect(recent.get()).toEqual(['Up', 'Heat', 'DUNE']);
    expect(await storage.get('recent')).toEqual(['Up', 'Heat', 'DUNE']);

    const again = createRecentList({ storage, key: 'recent', max: 3 });
    again.add('Alien');
    await again.load();
    expect(again.get()).toEqual(['Alien', 'Up', 'Heat']);
  });

  it('ignores a saved value that is not a list of terms, and clears', async () => {
    const storage = memoryKeyValueStore();
    await storage.set('recent', ['ok', 42, '  ']);
    const recent = createRecentList({ storage, key: 'recent', max: 5 });
    await recent.load();
    expect(recent.get()).toEqual(['ok']);
    recent.clear();
    expect(recent.get()).toEqual([]);
    expect(await storage.get('recent')).toEqual([]);
  });
});
