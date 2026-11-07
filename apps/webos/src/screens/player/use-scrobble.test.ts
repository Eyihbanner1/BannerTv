import { createElement, useLayoutEffect, useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import {
  INITIAL_SESSION_STATE,
  type PlaybackSession,
  type SessionState,
} from '../../player/session';
import { useScrobble } from './use-scrobble';

vi.mock('../../data/trakt', () => ({
  syncTraktSoon: () => undefined,
  traktAccount: {},
  traktAvailable: () => false,
}));

/** What the place was told with each state: the state's position, carryOn and moves. */
const told: [number, number | undefined, number | undefined][] = [];
vi.mock('./scrobble-progress', async (importOriginal) => {
  const real = await importOriginal<typeof import('./scrobble-progress')>();
  return {
    ...real,
    createScrobblePlace: (videoId: string) => {
      const place = real.createScrobblePlace(videoId);
      return {
        ...place,
        see: (...args: Parameters<typeof place.see>) => {
          told.push([args[0].position, args[2], args[3]]);
          place.see(...args);
        },
      };
    },
  };
});

/** Just enough of a page for React to render a screen that draws nothing. */
function root() {
  const page = globalThis as Record<string, unknown>;
  page.window ??= page;
  page.document ??= {
    nodeType: 9,
    documentElement: {},
    activeElement: null,
    body: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  };
  page.HTMLIFrameElement ??= class {};
  return createRoot({
    nodeType: 1,
    nodeName: 'DIV',
    tagName: 'DIV',
    namespaceURI: 'http://www.w3.org/1999/xhtml',
    ownerDocument: page.document,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    textContent: '',
  } as unknown as Element);
}

describe('useScrobble', () => {
  it('tells the place where the player stood when it showed each state, not after', () => {
    let state: SessionState = { ...INITIAL_SESSION_STATE, status: 'playing', position: 3 };
    let carry = 3;
    let moves = 0;
    const listeners = new Set<() => void>();
    const session = {
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      get: () => state,
      carryOn: () => carry,
      moves: () => moves,
    } as unknown as PlaybackSession;
    function Screen() {
      const now = useSyncExternalStore(session.subscribe, session.get);
      useScrobble(
        session,
        now,
        { type: 'movie', metaId: 'tt1', videoId: 'tt1', lab: true },
        () => 7200,
        () => 7200,
      );
      // The viewer skips again after the screen showed 600 s and before its
      // effects ran, as a slow render on a TV leaves them for later.
      useLayoutEffect(() => {
        if (now.position === 600) {
          carry = 1200;
          moves = 2;
        }
      });
      return null;
    }
    const screen = root();
    flushSync(() => screen.render(createElement(Screen)));
    flushSync(() => {
      state = { ...state, position: 600 };
      carry = 600;
      moves = 1;
      for (const listener of listeners) listener();
    });
    expect(told).toEqual([
      [3, 3, 0],
      [600, 600, 1],
    ]);
    flushSync(() => screen.unmount());
  });
});
