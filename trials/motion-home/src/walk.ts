import type { Direction, HomeRow } from './model';

export interface Step {
  direction: Direction;
  /** Wait after the press, in ms. */
  wait: number;
}

/** Brisk browsing: a press about every 200 ms, as a viewer scanning a row does. */
const BRISK = 200;
/** A pause long enough for the hero to change, as when a title catches the eye. */
const LINGER = 700;

function repeat(direction: Direction, times: number, wait = BRISK): Step[] {
  return Array.from({ length: times }, () => ({ direction, wait }));
}

export interface Walk {
  /** Down every row once, from the top: each row's art is seen for the first time. */
  firstWalkDown: Step[];
  /** Along rows, back up, and down again over rows already seen. */
  browse: Step[];
}

/** The same scripted walk for every mode, sized to the rows there are. */
export function walkFor(rows: readonly HomeRow[]): Walk {
  const down = Math.max(0, rows.length - 1);
  const longest = Math.min(15, Math.max(0, (rows[down]?.items.length ?? 1) - 1));
  return {
    firstWalkDown: repeat('down', down, LINGER),
    browse: [
      ...repeat('right', longest),
      { direction: 'right', wait: LINGER },
      ...repeat('left', 6),
      ...repeat('up', Math.min(3, down), LINGER),
      ...repeat('right', 10),
      ...repeat('up', Math.max(0, down - 3)),
      ...repeat('right', 12),
      { direction: 'right', wait: LINGER },
      ...repeat('down', down),
      ...repeat('left', 8),
    ],
  };
}

export function walkMs(steps: readonly Step[]): number {
  return steps.reduce((total, step) => total + step.wait, 0);
}

export async function play(
  steps: readonly Step[],
  press: (direction: Direction) => void,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((done) => setTimeout(done, ms)),
): Promise<void> {
  for (const step of steps) {
    press(step.direction);
    await sleep(step.wait);
  }
}
