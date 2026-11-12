import { describe, expect, it } from 'vitest';
import type { UpdateInfo } from './contract';
import {
  boot,
  freshState,
  isNewer,
  MAX_BAD,
  MAX_TRIES,
  markBad,
  markGood,
  readState,
  sameAsBuiltIn,
  type ShellState,
  takeBuiltIn,
  takeUpdate,
} from './state';

const BUILD = 'b'.repeat(32);
const A: UpdateInfo = {
  id: '00000000-0000-4000-8000-00000000000a',
  createdAt: '2026-11-11T10:00:00.000Z',
  version: '0.1.7',
  commit: 'abcdef1',
};
const B: UpdateInfo = { ...A, id: '00000000-0000-4000-8000-00000000000b', version: '0.1.8' };

describe('readState', () => {
  it('starts fresh with nothing stored, junk, another version or another .ipk', () => {
    for (const text of [null, '', 'not json', '[]', '{"v":2}']) {
      expect(readState(text, BUILD)).toEqual(freshState(BUILD));
    }
    const other = JSON.stringify({ ...freshState('other'), current: A });
    expect(readState(other, BUILD)).toEqual(freshState(BUILD));
  });

  it('reads back what was stored', () => {
    const state = { ...freshState(BUILD), current: A, next: B, tries: 1, floor: B.createdAt };
    expect(readState(JSON.stringify(state), BUILD)).toEqual(state);
    const back = { ...freshState(BUILD), current: A, next: 'built-in' as const };
    expect(readState(JSON.stringify(back), BUILD)).toEqual(back);
  });

  it('drops what is out of form, and counts unreadable tries as used up', () => {
    const stored = {
      v: 1,
      build: BUILD,
      floor: 'yesterday',
      current: { id: 7 },
      next: { ...B, createdAt: 'soon' },
      tries: 'two',
      failed: A,
      bad: ['x', 3, 'y'],
    };
    expect(readState(JSON.stringify(stored), BUILD)).toEqual({
      ...freshState(BUILD),
      tries: MAX_TRIES,
      failed: A,
      bad: ['x', 'y'],
    });
  });
});

describe('boot', () => {
  it('runs the .ipk’s code when nothing is stored', () => {
    expect(boot(freshState(BUILD))).toEqual({ state: freshState(BUILD), run: null });
  });

  it('starts what waits, and counts the start', () => {
    const { state, run } = boot({ ...freshState(BUILD), current: A, next: B, tries: 1 });
    expect(run).toEqual(B);
    expect(state).toMatchObject({ current: B, next: null, tries: 1 });
  });

  it('goes back to the .ipk’s code when told to', () => {
    const { state, run } = boot({ ...freshState(BUILD), current: A, next: 'built-in', tries: 1 });
    expect(run).toBeNull();
    expect(state).toMatchObject({ current: null, next: null, tries: 0 });
  });

  it('puts aside an update that has started MAX_TRIES times without going well', () => {
    let state: ShellState = { ...freshState(BUILD), next: A };
    for (let start = 1; start <= MAX_TRIES; start++) {
      const booted = boot(state);
      expect(booted.run).toEqual(A);
      expect(booted.state.tries).toBe(start);
      state = booted.state;
    }
    const last = boot(state);
    expect(last.run).toBeNull();
    expect(last.state).toMatchObject({ current: null, tries: 0, failed: A, bad: [A.id] });
  });

  it('keeps an update that went well, start after start', () => {
    let state: ShellState = { ...freshState(BUILD), next: A };
    for (let start = 0; start < 5; start++) {
      const booted = boot(state);
      expect(booted.run).toEqual(A);
      state = markGood(booted.state);
    }
    expect(state.tries).toBe(0);
  });

  it('never starts an update put aside', () => {
    const { run } = boot({ ...freshState(BUILD), next: A, bad: [A.id] });
    expect(run).toBeNull();
  });
});

describe('markBad', () => {
  it('takes the update out of what runs and what waits, and remembers it', () => {
    expect(markBad({ ...freshState(BUILD), current: A, tries: 2 }, A)).toMatchObject({
      current: null,
      tries: 0,
      failed: A,
      bad: [A.id],
    });
    expect(markBad({ ...freshState(BUILD), current: A, next: B }, B)).toMatchObject({
      current: A,
      next: null,
      bad: [B.id],
    });
  });

  it('remembers the last MAX_BAD only', () => {
    let state = freshState(BUILD);
    for (let n = 0; n < MAX_BAD + 3; n++) state = markBad(state, { ...A, id: `id-${n}` });
    expect(state.bad).toHaveLength(MAX_BAD);
    expect(state.bad[MAX_BAD - 1]).toBe(`id-${MAX_BAD + 2}`);
  });
});

describe('isNewer', () => {
  const built = '2026-11-11T09:00:00.000Z';

  it('takes only what was published after the .ipk was built and after anything taken', () => {
    const state = freshState(BUILD);
    expect(isNewer(state, '2026-11-11T09:00:01.000Z', built)).toBe(true);
    expect(isNewer(state, built, built)).toBe(false);
    expect(isNewer(state, '2026-11-10T09:00:00.000Z', built)).toBe(false);
    const taken = { ...state, floor: '2026-11-11T12:00:00.000Z' };
    expect(isNewer(taken, '2026-11-11T11:00:00.000Z', built)).toBe(false);
    expect(isNewer(taken, '2026-11-11T12:00:00.001Z', built)).toBe(true);
  });

  it('refuses a time that cannot be read', () => {
    expect(isNewer(freshState(BUILD), 'later', '2026-11-11T09:00:00.000Z')).toBe(false);
  });
});

describe('takeUpdate and takeBuiltIn', () => {
  it('has a downloaded update wait for the next start', () => {
    expect(takeUpdate({ ...freshState(BUILD), current: A }, B)).toMatchObject({
      current: A,
      next: B,
      floor: B.createdAt,
    });
  });

  it('sends a TV running an update back to its own code, and changes nothing on one that is not', () => {
    const at = '2026-11-12T00:00:00.000Z';
    expect(takeBuiltIn({ ...freshState(BUILD), current: A }, at)).toMatchObject({
      next: 'built-in',
      floor: at,
    });
    expect(takeBuiltIn({ ...freshState(BUILD), next: B }, at)).toMatchObject({
      current: null,
      next: null,
      floor: at,
    });
  });
});

describe('sameAsBuiltIn', () => {
  const builtIn = {
    'assets/index-a.js': { sha256: '1'.repeat(64), size: 10 },
    'vendor/hls.min.js': { sha256: '2'.repeat(64), size: 20 },
  };

  it('is true only when every file is the .ipk’s own', () => {
    expect(sameAsBuiltIn({ 'assets/index-a.js': builtIn['assets/index-a.js'] }, builtIn)).toBe(
      true,
    );
    expect(sameAsBuiltIn(builtIn, builtIn)).toBe(true);
    expect(
      sameAsBuiltIn({ 'assets/index-a.js': { sha256: '3'.repeat(64), size: 10 } }, builtIn),
    ).toBe(false);
    expect(
      sameAsBuiltIn({ 'data/sports-data.js': { sha256: '4'.repeat(64), size: 5 } }, builtIn),
    ).toBe(false);
  });
});
