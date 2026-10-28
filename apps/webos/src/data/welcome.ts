import { createStore } from '@bannertv/core';

// A one-bit flag read before the first paint, so it lives in localStorage
// rather than IndexedDB: Home never flashes up behind the welcome.
const KEY = 'bannertv.welcomed';

function readWelcomed(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

/** False until the user leaves the first-run screen, on this TV, once. */
export const welcomed = createStore<boolean>(readWelcomed());

export function finishWelcome(): void {
  try {
    localStorage.setItem(KEY, '1');
  } catch {
    // Without storage the welcome comes back next launch, which is harmless.
  }
  welcomed.set(true);
}
