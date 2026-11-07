import { createAccountClock } from '@bannertv/core';

// Read before the first paint, so the stores know which clock to use (ADR 0006, "On the screen").
const ON_KEY = 'bannertv.syncOn';
const CLOCK_KEY = 'bannertv.syncClock';

function readOn(): boolean {
  try {
    return localStorage.getItem(ON_KEY) === '1';
  } catch {
    return false;
  }
}

let on = readOn();

/**
 * The account's clock: this screen's, plus the server's time as last seen
 * (ADR 0006, decision 5). Leaving the account puts the skew back to 0.
 */
export const accountClock = createAccountClock({
  load: () => localStorage.getItem(CLOCK_KEY),
  save: (skew) => localStorage.setItem(CLOCK_KEY, String(skew)),
});

/** This screen has an account, or one being set up. */
export function syncOn(): boolean {
  return on;
}

/** Remembers whether this screen has an account, for the next launch's first paint. */
export function setSyncOn(next: boolean): void {
  if (next === on) return;
  on = next;
  try {
    if (next) localStorage.setItem(ON_KEY, '1');
    else localStorage.removeItem(ON_KEY);
  } catch {
    // The engine's own state says the same; only the stores' clock waits for it.
  }
}

/**
 * The time My List, progress and Continue Watching stamp their items with:
 * the account's clock while this screen has an account, so screens whose
 * clocks disagree still order changes the same way, and its own otherwise.
 */
export function storeNow(): number {
  return on ? accountClock.now() : Date.now();
}
