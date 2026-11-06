import { afterEach, describe, expect, it, vi } from 'vitest';

const switches = vi.hoisted(() => ({ marks: true }));
vi.mock('./tuning', () => ({ tuning: switches }));

/** A fresh copy of the module, so marks made by another test are forgotten. */
async function load() {
  vi.resetModules();
  return import('./marks');
}

afterEach(() => {
  switches.marks = true;
  vi.restoreAllMocks();
});

describe('bootMark', () => {
  it('marks each step of the launch once, the first time it is reached', async () => {
    const made = vi.spyOn(performance, 'mark').mockImplementation(() => undefined as never);
    const { bootMark } = await load();
    bootMark('boot:first-focus');
    bootMark('boot:first-focus');
    bootMark('boot:idb-open');
    expect(made.mock.calls).toEqual([['boot:first-focus'], ['boot:idb-open']]);
  });

  it('puts a mark at an earlier moment when told when it was', async () => {
    const made = vi.spyOn(performance, 'mark').mockImplementation(() => undefined as never);
    const { bootMark } = await load();
    bootMark('boot:script', 12.5);
    expect(made).toHaveBeenCalledWith('boot:script', { startTime: 12.5 });
  });

  it('marks nothing with the marks switch off, as it ships', async () => {
    switches.marks = false;
    const made = vi.spyOn(performance, 'mark').mockImplementation(() => undefined as never);
    const { bootMark, mark } = await load();
    bootMark('boot:first-focus');
    mark('key:ArrowDown');
    expect(made).not.toHaveBeenCalled();
  });
});
