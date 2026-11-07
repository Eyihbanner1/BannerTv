import { describe, expect, it } from 'vitest';
import { whenSafe, type Whereabouts } from './sync-reload';

/** The app where a test puts it, telling the reload of each move. */
function place(screen: string) {
  const listeners = new Set<() => void>();
  const where = { screen, hidden: false, busy: false };
  const whereabouts: Whereabouts = {
    screen: () => where.screen,
    hidden: () => where.hidden,
    busy: () => where.busy,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const move = (change: Partial<typeof where>) => {
    Object.assign(where, change);
    listeners.forEach((listener) => listener());
  };
  return { whereabouts, move, listening: () => listeners.size };
}

describe('starting the app again after a join that carried on by itself', () => {
  it('waits in the player until Home shows, and goes once', () => {
    const { whereabouts, move, listening } = place('player');
    let reloads = 0;
    whenSafe(whereabouts, () => (reloads += 1));
    expect(reloads).toBe(0);
    move({ screen: 'details' });
    move({ screen: 'discover' });
    expect(reloads).toBe(0);
    move({ screen: 'home' });
    expect(reloads).toBe(1);
    expect(listening()).toBe(0);
    move({ screen: 'settings' });
    expect(reloads).toBe(1);
  });

  it('goes the next time the app is off screen, wherever it is', () => {
    const { whereabouts, move } = place('player');
    let reloads = 0;
    whenSafe(whereabouts, () => (reloads += 1));
    move({ hidden: true });
    expect(reloads).toBe(1);
  });

  it('waits while a text box is open, even in Settings', () => {
    const { whereabouts, move } = place('search');
    let reloads = 0;
    whenSafe(whereabouts, () => (reloads += 1));
    move({ screen: 'account', busy: true });
    expect(reloads).toBe(0);
    move({ busy: false });
    expect(reloads).toBe(1);
  });

  it('goes at once where the person loses nothing: Home, Settings, or the account screen', () => {
    for (const screen of ['home', 'settings', 'account']) {
      let reloads = 0;
      whenSafe(place(screen).whereabouts, () => (reloads += 1));
      expect(reloads).toBe(1);
    }
  });
});
