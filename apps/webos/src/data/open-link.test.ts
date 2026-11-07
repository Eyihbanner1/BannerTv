import { createStore, type ProfilesState, type Store } from '@bannertv/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const app = vi.hoisted(() => ({
  profiles: null as unknown as Store<ProfilesState>,
  activeId: null as unknown as Store<string | null>,
  /** The screens, as the router would stack them. */
  stack: [] as string[],
  asked: 0,
}));

vi.mock('./profiles', () => ({
  get profiles() {
    return app.profiles;
  },
  get activeProfileId() {
    return app.activeId;
  },
  activeProfile: () => app.profiles.get().profiles.find((p) => p.id === app.activeId.get()),
  askAgainOnRelaunch: () => {
    app.asked += 1;
  },
}));

vi.mock('../app/router', () => ({
  openSection: (section: string) => {
    app.stack = [section];
  },
  push: (route: { name: string; type: string; id: string; video?: string }) => {
    app.stack.push(
      `${route.name}:${route.type}:${route.id}${route.video ? `@${route.video}` : ''}`,
    );
  },
}));

type OpenLinks = typeof import('./open-link');
let links: OpenLinks;

const PIN = { salt: 's', hash: 'h' };

function withProfiles(state: Partial<ProfilesState>, active: string | null) {
  app.profiles = createStore<ProfilesState>({
    profiles: [{ id: 'main', name: 'Main', colour: 0 }],
    lastId: 'main',
    askAtLaunch: false,
    ...state,
  });
  app.activeId = createStore<string | null>(active);
}

/** A shell that holds one link until it is taken, as Android's does. */
function shell(link: unknown) {
  let waiting: unknown = link;
  const shell = {
    takes: 0,
    take: () => {
      shell.takes += 1;
      const taken = waiting;
      waiting = null;
      return taken;
    },
    send(next: unknown) {
      waiting = next;
    },
  };
  return shell;
}

beforeEach(async () => {
  app.stack = ['sports', 'event:x'];
  app.asked = 0;
  withProfiles({}, 'main');
  vi.resetModules();
  links = await import('./open-link');
});

describe('readOpenLink', () => {
  it('takes a type and ids, and nothing else', () => {
    expect(
      links.readOpenLink({ type: 'series', meta: 'tt1', video: 'tt1:1:2', url: 'https://x' }),
    ).toEqual({ type: 'series', meta: 'tt1', video: 'tt1:1:2' });
    expect(links.readOpenLink({ type: 'movie', meta: 'kitsu:42' })).toEqual({
      type: 'movie',
      meta: 'kitsu:42',
    });
  });

  it('refuses what another app could make up', () => {
    for (const value of [
      null,
      'tt1',
      { type: 'movie' },
      { type: 'Movie', meta: 'tt1' },
      { type: '../addons', meta: 'tt1' },
      { type: 'movie', meta: '' },
      { type: 'movie', meta: 'tt1\n' },
      { type: 'movie', meta: 'x'.repeat(301) },
      { type: 'movie', meta: 7 },
    ]) {
      expect(links.readOpenLink(value)).toBeNull();
    }
    // A video id that is not one is left off, and Details still opens.
    expect(links.readOpenLink({ type: 'movie', meta: 'tt1', video: '' })).toEqual({
      type: 'movie',
      meta: 'tt1',
    });
  });
});

describe('asksFirst', () => {
  it('asks as a relaunch does: more than one profile, and a PIN or the picker at launch', () => {
    const two = [
      { id: 'main', name: 'Main', colour: 0 },
      { id: 'p2', name: 'Guest', colour: 1 },
    ];
    const state = (askAtLaunch: boolean, profiles = two) => ({
      profiles,
      lastId: 'main',
      askAtLaunch,
    });
    expect(links.asksFirst(state(false), two[0])).toBe(false);
    expect(links.asksFirst(state(true), two[0])).toBe(true);
    expect(links.asksFirst(state(false), { ...two[0]!, pin: PIN })).toBe(true);
    // One profile never asks: there is nobody else it could be.
    const alone = [{ id: 'main', name: 'Main', colour: 0, pin: PIN }];
    expect(links.asksFirst(state(true, alone), alone[0])).toBe(false);
  });
});

describe('startOpenLinks', () => {
  it('opens the title the app was started with on Details over Home', () => {
    const android = shell({ type: 'movie', meta: 'tt1', video: 'tt1' });
    links.startOpenLinks(android.take);
    expect(app.stack).toEqual(['home', 'details:movie:tt1@tt1']);
  });

  it('waits for "Who\'s watching?" before taking the link', () => {
    withProfiles(
      {
        profiles: [
          { id: 'main', name: 'Main', colour: 0 },
          { id: 'p2', name: 'Guest', colour: 1 },
        ],
        askAtLaunch: true,
      },
      null,
    );
    const android = shell({ type: 'series', meta: 'tt2', video: 'tt2:1:1' });
    const opened = links.startOpenLinks(android.take);
    // A card pressed again while the picker is up opens once someone is chosen.
    opened();
    expect(android.takes).toBe(0);
    expect(app.stack).toEqual(['sports', 'event:x']);
    app.activeId.set('p2');
    // Details opens the series' episodes on the one the card was for.
    expect(app.stack).toEqual(['home', 'details:series:tt2@tt2:1:1']);
    expect(app.asked).toBe(0);
  });

  it('opens a link that comes in while the app runs, or asks who is watching first', () => {
    const android = shell(null);
    const opened = links.startOpenLinks(android.take);
    android.send({ type: 'movie', meta: 'tt3' });
    opened();
    expect(app.stack).toEqual(['home', 'details:movie:tt3']);

    // With a PIN on the profile in use the app starts again with the question, and the link
    // waits in the shell for whoever is chosen.
    withProfiles(
      {
        profiles: [
          { id: 'main', name: 'Main', colour: 0, pin: PIN },
          { id: 'p2', name: 'Guest', colour: 1 },
        ],
      },
      'main',
    );
    android.send({ type: 'movie', meta: 'tt4' });
    const takes = android.takes;
    opened();
    expect(app.asked).toBe(1);
    expect(android.takes).toBe(takes);
  });

  it('opens nothing for a link it cannot read', () => {
    const android = shell({ type: 'movie' });
    links.startOpenLinks(android.take);
    expect(android.takes).toBe(1);
    expect(app.stack).toEqual(['sports', 'event:x']);
  });
});
