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
});
