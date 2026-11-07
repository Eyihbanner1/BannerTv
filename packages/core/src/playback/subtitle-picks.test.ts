import { parseStream } from '@bannertv/protocol';
import { describe, expect, it } from 'vitest';
import { memoryKeyValueStore } from '../storage';
import { describeStream } from '../streams/facts';
import { createSubtitlePickMemory, MAX_SUBTITLE_PICKS, subtitleRelease } from './subtitle-picks';

function entry(title: string, bingeGroup?: string) {
  const stream = parseStream({
    url: 'https://cdn.example.org/film.mkv?key=secret',
    name: 'Addon\n1080p',
    title,
    ...(bingeGroup ? { behaviorHints: { bingeGroup } } : {}),
  })!;
  return { stream, facts: describeStream(stream) };
}

describe('subtitleRelease', () => {
  it('names the release by its group, else the binge group, else the video, never the link', () => {
    expect(subtitleRelease(entry('Film.2021.1080p.WEB-DL-FLUX', 'tio|1080p'), 'tt1')).toBe(
      'group:flux',
    );
    expect(subtitleRelease(entry('Film 1080p', 'tio|1080p|WEB-DL'), 'tt1')).toBe(
      'binge:tio|1080p|WEB-DL',
    );
    expect(subtitleRelease(entry('Film 1080p'), 'tt1:1:2')).toBe('video:tt1:1:2');
    expect(subtitleRelease(entry('Film 1080p', 'https://x.example/?key=1'), 'tt1')).toBe(
      'video:tt1',
    );
  });
});

describe('createSubtitlePickMemory', () => {
  it('keeps the version picked for each release of a title, and reads it back', async () => {
    const storage = memoryKeyValueStore();
    const memory = createSubtitlePickMemory({ storage });
    await memory.remember({ metaId: 'tt1', release: 'group:flux', file: 'k1' });
    await memory.remember({ metaId: 'tt1', release: 'group:ntb', file: 'k2', hearing: true });
    // A newer pick for the same release replaces the older one.
    await memory.remember({ metaId: 'tt1', release: 'group:flux', file: 'k3' });
    expect(memory.get('tt1', 'group:flux')).toEqual({
      metaId: 'tt1',
      release: 'group:flux',
      file: 'k3',
    });
    expect(memory.get('tt1', 'group:other')).toBeUndefined();
    expect(await storage.get('subtitlePicks')).toEqual([
      { metaId: 'tt1', release: 'group:ntb', file: 'k2', hearing: true },
      { metaId: 'tt1', release: 'group:flux', file: 'k3' },
    ]);

    const again = createSubtitlePickMemory({ storage });
    await again.load();
    expect(again.get('tt1', 'group:ntb')?.file).toBe('k2');
    await again.forget('tt1', 'group:ntb');
    expect(again.get('tt1', 'group:ntb')).toBeUndefined();
  });

  it('wants files for the hard of hearing where the version picked was one', async () => {
    const memory = createSubtitlePickMemory({ storage: memoryKeyValueStore() });
    await memory.remember({ metaId: 'series', release: 'video:s:1:1', file: 'a', hearing: true });
    // Another episode, with nothing picked for it: the title's last pick says.
    expect(memory.wantsHearing('series', 'video:s:1:2')).toBe(true);
    await memory.remember({ metaId: 'series', release: 'video:s:1:2', file: 'b' });
    expect(memory.wantsHearing('series', 'video:s:1:2')).toBe(false);
    // The release's own pick comes first.
    expect(memory.wantsHearing('series', 'video:s:1:1')).toBe(true);
    expect(memory.wantsHearing('film', 'video:film')).toBe(false);
  });

  it('never keeps a link, drops damaged entries and the least recently picked past the limit', async () => {
    const storage = memoryKeyValueStore();
    await storage.set('subtitlePicks', [
      { metaId: 'old', release: 'video:old', file: 'k' },
      { metaId: 'tt2', release: 'group:x', file: 'https://subs.example/file.srt' },
      { metaId: '', release: 'group:x', file: 'k' },
      { metaId: 'tt3', release: 'group:x', file: 'k', hearing: 'yes' },
      null,
    ]);
    const memory = createSubtitlePickMemory({ storage });
    await memory.load();
    expect(memory.get('tt2', 'group:x')).toBeUndefined();
    expect(memory.get('tt3', 'group:x')).toEqual({ metaId: 'tt3', release: 'group:x', file: 'k' });
    await memory.remember({
      metaId: 'tt4',
      release: 'group:x',
      file: 'https://subs.example/a.srt',
    });
    expect(memory.get('tt4', 'group:x')).toBeUndefined();
    for (let i = 0; i < MAX_SUBTITLE_PICKS; i++) {
      await memory.remember({ metaId: `t${i}`, release: 'video:v', file: 'k' });
    }
    expect(memory.get('old', 'video:old')).toBeUndefined();
    expect(memory.get(`t${MAX_SUBTITLE_PICKS - 1}`, 'video:v')).toBeDefined();
    expect(JSON.stringify(await storage.get('subtitlePicks'))).not.toContain('://');
  });

  it('tells its listeners of a change, and not of a pick that changes nothing', async () => {
    const memory = createSubtitlePickMemory({ storage: memoryKeyValueStore() });
    await memory.load();
    let told = 0;
    const stop = memory.subscribe(() => told++);
    await memory.remember({ metaId: 'tt1', release: 'group:x', file: 'k' });
    await memory.remember({ metaId: 'tt1', release: 'group:x', file: 'k' });
    await memory.forget('tt1', 'group:none');
    stop();
    expect(told).toBe(1);
  });
});
