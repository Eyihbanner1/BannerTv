import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const marked = vi.hoisted(() => [] as string[]);
const remote = vi.hoisted(() => ({ lastKeyAt: 0 }));
vi.mock('./marks', () => ({ bootMark: (name: string) => marked.push(name) }));
// Before any key, the activity clock reads as long ago as can be, as at launch.
vi.mock('../navigation/activity', () => ({
  sinceActivity: () => Date.now() - remote.lastKeyAt,
}));

/** A fresh copy of the module: a new page load, at the fake clock's start. */
async function load() {
  vi.resetModules();
  return import('./launch');
}

beforeEach(() => {
  vi.useFakeTimers({ now: 1_000_000 });
  remote.lastKeyAt = 0;
});

afterEach(() => {
  marked.length = 0;
  vi.useRealTimers();
});

describe('noteHomeFocused', () => {
  it('marks Home’s first focus of the page load, and no later showing', async () => {
    const { noteHomeFocused } = await load();
    noteHomeFocused();
    noteHomeFocused();
    expect(marked).toEqual(['boot:first-focus']);
  });
});

describe('afterLaunch', () => {
  it('runs once Home has focus and the remote has been still a moment', async () => {
    const { afterLaunch, noteHomeFocused, SETTLE_QUIET_MS } = await load();
    const run = vi.fn();
    afterLaunch(run);
    vi.advanceTimersByTime(1500);
    noteHomeFocused();
    vi.advanceTimersByTime(SETTLE_QUIET_MS - 1);
    expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(run).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60_000);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('waits while the remote is in use', async () => {
    const { afterLaunch, noteHomeFocused, SETTLE_QUIET_MS } = await load();
    const run = vi.fn();
    noteHomeFocused();
    afterLaunch(run);
    for (let press = 0; press < 5; press++) {
      vi.advanceTimersByTime(SETTLE_QUIET_MS / 2);
      remote.lastKeyAt = Date.now();
    }
    vi.advanceTimersByTime(SETTLE_QUIET_MS - 1);
    expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('runs at the latest a while after the start, focus or not, presses or not', async () => {
    const { afterLaunch, SETTLE_LATEST_MS } = await load();
    const unfocused = vi.fn();
    afterLaunch(unfocused);
    vi.advanceTimersByTime(SETTLE_LATEST_MS - 1);
    expect(unfocused).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(unfocused).toHaveBeenCalledTimes(1);

    const again = await load();
    const busy = vi.fn();
    again.noteHomeFocused();
    again.afterLaunch(busy);
    const interval = setInterval(() => (remote.lastKeyAt = Date.now()), 200);
    vi.advanceTimersByTime(SETTLE_LATEST_MS);
    clearInterval(interval);
    expect(busy).toHaveBeenCalledTimes(1);
  });

  it('runs at once once the launch has settled, and one failing stops no other', async () => {
    const { afterLaunch, noteHomeFocused, SETTLE_QUIET_MS } = await load();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const after = vi.fn();
    afterLaunch(() => {
      throw new Error('no');
    });
    afterLaunch(after);
    noteHomeFocused();
    vi.advanceTimersByTime(SETTLE_QUIET_MS);
    expect(after).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    const late = vi.fn();
    afterLaunch(late);
    expect(late).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('starts no timer until something waits', async () => {
    const { noteHomeFocused } = await load();
    noteHomeFocused();
    expect(vi.getTimerCount()).toBe(0);
  });
});
