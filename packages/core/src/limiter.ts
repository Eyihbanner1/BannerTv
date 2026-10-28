export interface Limiter {
  /** Runs `task` once fewer than the maximum are running, in the order asked. */
  run<T>(task: () => Promise<T>): Promise<T>;
}

/**
 * Caps how many requests run at once. TV network stacks and CPUs are slow,
 * and image decoding competes with JSON parsing, so addon requests queue
 * behind a small limit.
 */
export function createLimiter(max: number): Limiter {
  let active = 0;
  const waiting: Array<() => void> = [];

  function next() {
    if (active >= max) return;
    const start = waiting.shift();
    if (start) start();
  }

  return {
    run<T>(task: () => Promise<T>): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        waiting.push(() => {
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
        });
        next();
      });
    },
  };
}
