import { describe, expect, it } from 'vitest';
import { type RestartRule, whenSafe, type Whereabouts } from './safe-restart';

/** The app where a test puts it, telling the restart of each move. */
function place(screen: string, start: { hidden?: boolean; busy?: boolean } = {}) {
  const listeners = new Set<() => void>();
  const where = { screen, hidden: false, busy: false, ...start };
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

function counted(rule: RestartRule, screen: string, start?: { hidden?: boolean; busy?: boolean }) {
  const at = place(screen, start);
  let restarts = 0;
  const cancel = whenSafe(at.whereabouts, () => (restarts += 1), rule);
  return { ...at, cancel, restarts: () => restarts };
}

describe('starting the app again after a join that carried on by itself', () => {
  it('waits in the player until Home shows, and goes once', () => {
    const { move, restarts, listening } = counted('join', 'player');
    move({ screen: 'details' });
    expect(restarts()).toBe(0);
    move({ screen: 'home' });
    expect(restarts()).toBe(1);
    expect(listening()).toBe(0);
    move({ screen: 'settings' });
    expect(restarts()).toBe(1);
  });

  it('goes the next time the app is off screen, from the player too', () => {
    const { move, restarts } = counted('join', 'player');
    move({ hidden: true });
    expect(restarts()).toBe(1);
  });
});

describe('starting a downloaded app update', () => {
  it('goes at once on Home, Settings or the account screen', () => {
    for (const screen of ['home', 'settings', 'account']) {
      expect(counted('update', screen).restarts()).toBe(1);
    }
  });

  it('never leaves the player, even off screen, and goes once the person is back on Home', () => {
    const { move, restarts } = counted('update', 'player');
    move({ hidden: true });
    expect(restarts()).toBe(0);
    move({ hidden: false, screen: 'details' });
    expect(restarts()).toBe(0);
    move({ screen: 'home' });
    expect(restarts()).toBe(1);
  });

  it('goes off screen from Home, Settings or the account screen, as on screen', () => {
    for (const screen of ['home', 'settings', 'account']) {
      expect(counted('update', screen, { hidden: true }).restarts()).toBe(1);
    }
  });

  it('waits off screen everywhere else, since a prompt or the browser can cover the app', () => {
    // Trakt waits for the person to come back from trakt.tv, the stream helper for Android's
    // notifications prompt, and Addons for an addon's settings page in the browser.
    for (const screen of ['trakt', 'stream-helper', 'addons', 'details']) {
      const { move, restarts } = counted('update', screen);
      move({ hidden: true });
      expect(restarts()).toBe(0);
      move({ hidden: false });
      expect(restarts()).toBe(0);
    }
  });

  it('goes once the person is back on a safe screen from the flow that covered the app', () => {
    const { move, restarts } = counted('update', 'trakt', { hidden: true });
    move({ hidden: false });
    expect(restarts()).toBe(0);
    move({ screen: 'settings' });
    expect(restarts()).toBe(1);
  });

  it('waits off screen while something is typed, even on a safe screen', () => {
    const { move, restarts } = counted('update', 'account', { busy: true });
    move({ hidden: true });
    expect(restarts()).toBe(0);
    move({ hidden: false, busy: false });
    expect(restarts()).toBe(1);
  });

  it('waits while something is typed or "Who\'s watching?" is up, even on a safe screen', () => {
    const { move, restarts } = counted('update', 'search');
    move({ screen: 'account', busy: true });
    expect(restarts()).toBe(0);
    move({ busy: false });
    expect(restarts()).toBe(1);
  });

  it('can be called off before it goes', () => {
    const { move, restarts, cancel, listening } = counted('update', 'details');
    cancel();
    expect(listening()).toBe(0);
    move({ screen: 'home' });
    expect(restarts()).toBe(0);
  });
});

describe('starting an update the person put off', () => {
  it('waits on every screen while the app shows, Settings included', () => {
    const { move, restarts } = counted('offScreen', 'settings');
    move({ screen: 'home' });
    expect(restarts()).toBe(0);
    move({ hidden: true });
    expect(restarts()).toBe(1);
  });

  it('does not go off screen from the player', () => {
    const { move, restarts } = counted('offScreen', 'player', { hidden: true });
    expect(restarts()).toBe(0);
    move({ hidden: false, screen: 'home' });
    move({ hidden: true });
    expect(restarts()).toBe(1);
  });

  it('does not go off screen from a flow that covers the app, or while something is typed', () => {
    for (const screen of ['trakt', 'stream-helper', 'addons']) {
      expect(counted('offScreen', screen, { hidden: true }).restarts()).toBe(0);
    }
    const { move, restarts } = counted('offScreen', 'settings', { busy: true, hidden: true });
    expect(restarts()).toBe(0);
    move({ busy: false });
    expect(restarts()).toBe(1);
  });
});
