import { describe, expect, it } from 'vitest';
import { memoryKeyValueStore } from '../storage';
import { createSubtitleOffsets, MAX_SUBTITLE_OFFSETS, subtitleFileKey } from './offsets';

describe('createSubtitleOffsets', () => {
  it('keeps each file’s timing in tenths of a second, and forgets a timing put back to 0', async () => {
    const storage = memoryKeyValueStore();
    const offsets = createSubtitleOffsets({ storage });
    await offsets.remember('a', 0.5);
    await offsets.remember('b', -1.2999);
    expect(offsets.get('a')).toBe(0.5);
    expect(offsets.get('b')).toBe(-1.3);
    expect(offsets.get('c')).toBeUndefined();

    await offsets.remember('a', 0.04);
    expect(offsets.get('a')).toBeUndefined();
    expect(await storage.get('subtitleOffsets')).toEqual([{ key: 'b', offset: -1.3 }]);

    const again = createSubtitleOffsets({ storage });
    await again.load();
    expect(again.get('b')).toBe(-1.3);
  });

  it('drops the least recently changed past the limit, and damaged entries', async () => {
    const storage = memoryKeyValueStore();
    await storage.set('subtitleOffsets', [
      { key: 'old', offset: 1 },
      { key: '', offset: 1 },
      { key: 'zero', offset: 0 },
      { key: 'nan', offset: Number.NaN },
      { key: 'far', offset: 4000 },
      { key: 'twice', offset: 1 },
      { key: 'twice', offset: 2 },
      null,
    ]);
    const offsets = createSubtitleOffsets({ storage });
    await offsets.load();
    expect(offsets.get('twice')).toBe(2);
    for (const key of ['zero', 'nan', 'far', '']) expect(offsets.get(key)).toBeUndefined();
    for (let i = 0; i < MAX_SUBTITLE_OFFSETS; i++) await offsets.remember(`f${i}`, 0.1);
    expect(offsets.get('old')).toBeUndefined();
    expect(offsets.get(`f${MAX_SUBTITLE_OFFSETS - 1}`)).toBe(0.1);
    // Changed again, the oldest becomes the newest: the next oldest goes instead.
    await offsets.remember('f0', 0.2);
    await offsets.remember('new', 0.1);
    expect(offsets.get('f0')).toBe(0.2);
    expect(offsets.get('f1')).toBeUndefined();
  });

  it('tells its listeners of a change', async () => {
    const offsets = createSubtitleOffsets({ storage: memoryKeyValueStore() });
    await offsets.load();
    let told = 0;
    const stop = offsets.subscribe(() => told++);
    await offsets.remember('a', 1);
    await offsets.remember('a', 1);
    stop();
    await offsets.remember('a', 2);
    expect(told).toBe(1);
  });
});

describe('subtitleFileKey', () => {
  it('is short, the same for the same file, and keeps nothing of what it was given', () => {
    const key = subtitleFileKey('tt1', 'org.stremio.opensubtitlesv3#123');
    expect(key).toBe(subtitleFileKey('tt1', 'org.stremio.opensubtitlesv3#123'));
    expect(key).not.toBe(subtitleFileKey('tt2', 'org.stremio.opensubtitlesv3#123'));
    expect(key).not.toBe(subtitleFileKey('tt1', 'org.stremio.opensubtitlesv3#124'));
    expect(key).toMatch(/^[0-9a-z]{2,14}$/);
    const link = subtitleFileKey('tt1', 'https://subs.example.com/secret-key/file.srt');
    expect(link).not.toContain('secret');
  });
});

describe('subtitle timings and the BannerTV account', () => {
  it('lists every timing and adopts the account’s, 0 being a removal', async () => {
    const offsets = createSubtitleOffsets({ storage: memoryKeyValueStore() });
    await offsets.remember('a', 0.5);
    await offsets.remember('b', 1);
    await offsets.adopt({
      set: [
        { key: 'c', offset: -2.04 },
        { key: 'b', offset: 0 },
      ],
      remove: ['a'],
    });
    expect(offsets.offsets()).toEqual([{ key: 'c', offset: -2 }]);
  });
});
