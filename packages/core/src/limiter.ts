export interface Limiter {
  /**
   * Runs `task` once fewer than the maximum are running, in the order asked.
   * `priority` is read each time a slot frees: the waiting task with the
   * highest goes first, so a task can be raised while it waits. Left out,
   * it is 0; tasks of equal priority keep the order asked.
   */
  run<T>(task: () => Promise<T>, priority?: () => number): Promise<T>;
}

interface Waiting {
  start: () => void;
  priority?: () => number;
}

/**
 * Caps how many requests run at once. TV network stacks and CPUs are slow,
 * and image decoding competes with JSON parsing, so addon requests queue
 * behind a small limit.
 */
export function createLimiter(max: number): Limiter {
  let active = 0;
  const waiting: Waiting[] = [];
  // How many waiting tasks have a priority: with none, the first in line goes.
  let ranked = 0;

  function take(): Waiting | undefined {
    if (ranked === 0) return waiting.shift();
    let pick = 0;
    let best = -Infinity;
    waiting.forEach((task, i) => {
      const priority = task.priority ? task.priority() : 0;
      if (priority > best) {
        best = priority;
        pick = i;
      }
    });
    return waiting.splice(pick, 1)[0];
  }

  function next() {
    if (active >= max) return;
    const task = take();
    if (!task) return;
    if (task.priority) ranked--;
    task.start();
  }

  return {
    run<T>(task: () => Promise<T>, priority?: () => number): Promise<T> {
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
          priority,
        });
        if (priority) ranked++;
        next();
      });
    },
  };
}
