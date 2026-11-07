import type { Cue } from '@bannertv/core';
import { describe, expect, it } from 'vitest';
import { createSubtitleChecks } from './subtitle-checks';

const cues: Cue[] = [
  { start: 1, end: 3, lines: [[{ text: '[door creaks]' }]] },
  { start: 4, end: 6, lines: [[{ text: 'Who is there?' }]] },
];

/** A loader the test answers by hand. */
function loader() {
  const calls: string[] = [];
  const waiting = new Map<string, { resolve: (cues: Cue[]) => void; reject: () => void }>();
  const load = (file: { url: string }) => {
    calls.push(file.url);
    return new Promise<Cue[]>((resolve, reject) =>
      waiting.set(file.url, { resolve, reject: () => reject(new Error('404')) }),
    );
  };
  return { load, calls, answer: (url: string) => waiting.get(url)! };
}

describe('createSubtitleChecks', () => {
  it('reads a file once at a time, keeps what its lines say, and tells listeners first', async () => {
    const { load, calls, answer } = loader();
    const checks = createSubtitleChecks(load);
    const heard: string[] = [];
    checks.subscribe(() => heard.push(`told:${checks.profile('a') ? 'read' : 'not read'}`));
    const file = { url: 'a', lang: 'eng', label: 'Film.SDH' };
    const first = checks.read(file);
    const second = checks.read(file);
    expect(second).toBe(first);
    expect(calls).toEqual(['a']);
    expect(checks.reading('a')).toBe(true);
    // Nothing is told when a read starts.
    expect(heard).toEqual([]);
    const before = checks.profiles();
    answer('a').resolve(cues);
    await first.then(() => heard.push('caller'));
    expect(heard).toEqual(['told:read', 'caller']);
    expect(checks.reading('a')).toBe(false);
    expect(checks.profile('a')).toMatchObject({ lines: 2, hearingLines: 1, hearingLabel: true });
    // A new map for each file read, the same one otherwise.
    expect(checks.profiles()).not.toBe(before);
    expect(checks.profiles()).toBe(checks.profiles());
  });

  it('marks a file that could not be read until it reads', async () => {
    const { load, answer } = loader();
    const checks = createSubtitleChecks(load);
    const failing = checks.read({ url: 'b', lang: 'eng' });
    answer('b').reject();
    await expect(failing).rejects.toThrow('404');
    expect(checks.failed('b')).toBe(true);
    expect(checks.profile('b')).toBeUndefined();
    const again = checks.read({ url: 'b', lang: 'eng' });
    answer('b').resolve(cues);
    await again;
    expect(checks.failed('b')).toBe(false);
    expect(checks.profile('b')?.lines).toBe(2);
  });
});
