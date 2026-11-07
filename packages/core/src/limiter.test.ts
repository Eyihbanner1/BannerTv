import { describe, expect, it } from 'vitest';
import { createLimiter } from './limiter';

describe('createLimiter', () => {
  it('runs at most the maximum at once, in the order asked', async () => {
    const limiter = createLimiter(2);
    const started: number[] = [];
    const finish: Array<() => void> = [];
    const results = [1, 2, 3, 4].map((n) =>
      limiter.run(
        () =>
          new Promise<number>((resolve) => {
            started.push(n);
            finish.push(() => resolve(n));
          }),
      ),
    );
    expect(started).toEqual([1, 2]);
    finish[0]!();
    await results[0];
    await Promise.resolve();
    expect(started).toEqual([1, 2, 3]);
    finish[1]!();
    finish[2]!();
    await Promise.all(results.slice(1, 3));
    await Promise.resolve();
    finish[3]!();
    expect(await Promise.all(results)).toEqual([1, 2, 3, 4]);
  });

  it('frees the slot when a task fails or throws', async () => {
    const limiter = createLimiter(1);
    await expect(limiter.run(() => Promise.reject(new Error('no')))).rejects.toThrow('no');
    await expect(
      limiter.run(() => {
        throw new Error('sync');
      }),
    ).rejects.toThrow('sync');
    expect(await limiter.run(() => Promise.resolve('next'))).toBe('next');
  });

  /** A task that records when it starts and waits to be finished. */
  function held(limiter: ReturnType<typeof createLimiter>, started: string[], name: string) {
    let finish = () => undefined as void;
    const done = (priority?: () => number) =>
      limiter.run(
        () =>
          new Promise<void>((resolve) => {
            started.push(name);
            finish = resolve;
          }),
        priority,
      );
    return { done, finish: () => finish() };
  }

  it('starts a waiting task of higher priority first, in the order asked among equals', async () => {
    const limiter = createLimiter(1);
    const started: string[] = [];
    const tasks = new Map(
      ['running', 'browse 1', 'play 1', 'browse 2', 'play 2'].map((name) => [
        name,
        held(limiter, started, name),
      ]),
    );
    const results = Array.from(tasks, ([name, task]) =>
      task.done(name.startsWith('play') ? () => 1 : undefined),
    );
    const order = ['running', 'play 1', 'play 2', 'browse 1', 'browse 2'];
    for (let i = 0; i < order.length; i++) {
      expect(started).toEqual(order.slice(0, i + 1));
      tasks.get(order[i]!)!.finish();
      await Promise.resolve();
      await Promise.resolve();
    }
    await Promise.all(results);
  });

  it('reads the priority as a slot frees, so a waiting task can be raised', async () => {
    const limiter = createLimiter(1);
    const started: string[] = [];
    const running = held(limiter, started, 'running');
    const results = [running.done()];
    let urgent = 0;
    const early = held(limiter, started, 'early');
    const late = held(limiter, started, 'late');
    results.push(
      early.done(),
      late.done(() => urgent),
    );
    urgent = 1;
    running.finish();
    await Promise.all([results[0]]);
    await Promise.resolve();
    expect(started).toEqual(['running', 'late']);
    late.finish();
    await results[2];
    await Promise.resolve();
    expect(started).toEqual(['running', 'late', 'early']);
    early.finish();
    await Promise.all(results);
  });

  it('keeps the order asked when every priority is 0', async () => {
    const limiter = createLimiter(1);
    const started: string[] = [];
    const tasks = ['a', 'b', 'c'].map((name) => held(limiter, started, name));
    const results = tasks.map((task, i) => task.done(i === 1 ? () => 0 : undefined));
    for (let i = 0; i < tasks.length; i++) {
      expect(started).toEqual(['a', 'b', 'c'].slice(0, i + 1));
      tasks[i]!.finish();
      await results[i];
      await Promise.resolve();
    }
    await Promise.all(results);
  });
});
