import type { Limiter } from './limiter';

/** A queued request the lane gave up on before it started, because its screen closed. */
export class DroppedError extends Error {
  constructor() {
    super('Request dropped');
    this.name = 'DroppedError';
  }
}

export interface Lane extends Limiter {
  /** Rejects every task still waiting with a DroppedError. Running ones finish. */
  drop(): void;
}

/**
 * A narrower limit for one feature's requests, waited on before the shared
 * limiter that every request goes through: with a lane of 2, sports paging
 * holds at most 2 of the shared slots, so Home's rows always get the rest.
 */
export function createLane(max: number): Lane {
  let active = 0;
  const waiting: Array<{ start: () => void; reject: (error: Error) => void }> = [];

  function next() {
    if (active >= max) return;
    const task = waiting.shift();
    if (task) task.start();
  }

  return {
    run<T>(task: () => Promise<T>): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        waiting.push({
          start: () => {
            active++;
            let result: Promise<T>;
            try {
              result = task();
            } catch (error) {
              result = Promise.reject(error);
            }
            result.then(resolve, reject).then(() => {
              active--;
              next();
            });
          },
          reject,
        });
        next();
      });
    },
    drop() {
      const dropped = waiting.splice(0, waiting.length);
      for (const task of dropped) task.reject(new DroppedError());
    },
  };
}
