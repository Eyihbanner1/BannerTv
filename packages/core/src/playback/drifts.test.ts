import { describe, expect, it } from 'vitest';
import { memoryKeyValueStore } from '../storage';
import { createSubtitleDrifts, MAX_SUBTITLE_DRIFTS } from './drifts';

describe('createSubtitleDrifts', () => {
  it('keeps each file’s drift fix, forgets a fix taken off, and reads it back', async () => {
    const storage = memoryKeyValueStore();
    const drifts = createSubtitleDrifts({ storage });
    await drifts.remember('a', 'ahead');
    await drifts.remember('b', 'behind');
    expect(drifts.get('a')).toBe('ahead');
    expect(drifts.get('b')).toBe('behind');
    expect(drifts.get('c')).toBeUndefined();
    await drifts.remember('a', null);
    expect(drifts.get('a')).toBeUndefined();
    expect(await storage.get('subtitleDrift')).toEqual([{ key: 'b', drift: 'behind' }]);

    const again = createSubtitleDrifts({ storage });
    await again.load();
    expect(again.get('b')).toBe('behind');
  });

  it('keeps "none" for a file whose fix made by the player was taken off, until it is forgotten', async () => {
    const storage = memoryKeyValueStore();
    const drifts = createSubtitleDrifts({ storage });
    await drifts.remember('a', 'none');
    expect(drifts.get('a')).toBe('none');
    const again = createSubtitleDrifts({ storage });
    await again.load();
    expect(again.get('a')).toBe('none');
    await again.remember('a', 'behind');
    expect(again.get('a')).toBe('behind');
    await again.remember('a', null);
    expect(again.get('a')).toBeUndefined();
  });

  it('keeps "auto", the player’s own fix kept with the viewer’s timing, until a fix is chosen', async () => {
    const storage = memoryKeyValueStore();
    const drifts = createSubtitleDrifts({ storage });
    await drifts.remember('a', 'auto');
    expect(drifts.get('a')).toBe('auto');
    const again = createSubtitleDrifts({ storage });
    await again.load();
    expect(again.get('a')).toBe('auto');
    await again.remember('a', 'ahead');
    expect(again.get('a')).toBe('ahead');
    await again.remember('b', 'aligned');
    const third = createSubtitleDrifts({ storage });
    await third.load();
    expect(third.get('b')).toBe('aligned');
  });

  it('drops damaged entries and the least recently changed past the limit', async () => {
    const storage = memoryKeyValueStore();
    await storage.set('subtitleDrift', [
      { key: 'old', drift: 'ahead' },
      { key: '', drift: 'ahead' },
      { key: 'odd', drift: 'sideways' },
      { key: 'twice', drift: 'ahead' },
      { key: 'twice', drift: 'behind' },
      null,
    ]);
    const drifts = createSubtitleDrifts({ storage });
    await drifts.load();
    expect(drifts.get('twice')).toBe('behind');
    expect(drifts.get('odd')).toBeUndefined();
    for (let i = 0; i < MAX_SUBTITLE_DRIFTS; i++) await drifts.remember(`f${i}`, 'ahead');
    expect(drifts.get('old')).toBeUndefined();
    expect(drifts.get(`f${MAX_SUBTITLE_DRIFTS - 1}`)).toBe('ahead');
  });

  it('tells its listeners of a change, and not of a choice that changes nothing', async () => {
    const drifts = createSubtitleDrifts({ storage: memoryKeyValueStore() });
    await drifts.load();
    let told = 0;
    const stop = drifts.subscribe(() => told++);
    await drifts.remember('a', 'ahead');
    await drifts.remember('a', 'ahead');
    await drifts.remember('b', null);
    stop();
    expect(told).toBe(1);
  });
});

describe('drift fixes adopted from elsewhere', () => {
  it('lists every fix, the least recently changed first, and adopts a change', async () => {
    const storage = memoryKeyValueStore();
    const drifts = createSubtitleDrifts({ storage });
    await drifts.remember('a', 'ahead');
    await drifts.remember('b', 'behind');
    await drifts.remember('c', 'ahead');
    expect(drifts.drifts()).toEqual([
      { key: 'a', drift: 'ahead' },
      { key: 'b', drift: 'behind' },
      { key: 'c', drift: 'ahead' },
    ]);

    await drifts.adopt({
      set: [
        { key: 'a', drift: 'behind' },
        // A fix it does not know is a removal.
        { key: 'b', drift: 'sideways' as 'ahead' },
      ],
      remove: ['c', 'never-kept'],
    });
    expect(drifts.drifts()).toEqual([{ key: 'a', drift: 'behind' }]);
    expect(await storage.get('subtitleDrift')).toEqual([{ key: 'a', drift: 'behind' }]);
  });

  it('changes nothing, and tells nobody, when the change is already there', async () => {
    const drifts = createSubtitleDrifts({ storage: memoryKeyValueStore() });
    await drifts.remember('a', 'ahead');
    let told = 0;
    const stop = drifts.subscribe(() => told++);
    await drifts.adopt({ remove: ['b'] });
    await drifts.adopt({});
    stop();
    expect(told).toBe(0);
    expect(drifts.get('a')).toBe('ahead');
  });

  it('adopts before the saved fixes are read, keeping both', async () => {
    const storage = memoryKeyValueStore();
    await storage.set('subtitleDrift', [{ key: 'saved', drift: 'ahead' }]);
    const drifts = createSubtitleDrifts({ storage });
    await drifts.adopt({ set: [{ key: 'new', drift: 'behind' }] });
    expect(drifts.drifts()).toEqual([
      { key: 'saved', drift: 'ahead' },
      { key: 'new', drift: 'behind' },
    ]);
  });
});
