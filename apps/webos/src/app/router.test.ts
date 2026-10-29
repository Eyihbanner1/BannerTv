import type { SportEvent } from '@bannertv/core';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  back,
  canGoBack,
  currentSection,
  eventPlay,
  openSection,
  push,
  remembersPlace,
  replace,
  router,
  takePendingFocus,
  topRoute,
} from './router';

describe('router', () => {
  beforeEach(() => {
    openSection('home');
    takePendingFocus();
  });

  it('starts on Home', () => {
    expect(topRoute()).toEqual({ name: 'home' });
    expect(canGoBack()).toBe(false);
  });

  it('pushes screens on top of the section and restores focus on Back', () => {
    openSection('settings');
    push({ name: 'diagnostics' }, 'settings-diagnostics');
    expect(topRoute()).toEqual({ name: 'diagnostics' });
    expect(currentSection()).toBe('settings');

    expect(back()).toBe(true);
    expect(topRoute()).toEqual({ name: 'settings' });
    expect(takePendingFocus()).toBe('settings-diagnostics');
    expect(takePendingFocus()).toBeUndefined();
  });

  it('has nothing to close on a section root', () => {
    expect(back()).toBe(false);
    expect(router.get().stack).toHaveLength(1);
  });

  it('opening a section resets the stack', () => {
    push({ name: 'details', type: 'movie', id: 'tt1727587' }, 'home-row-0-tile-2');
    openSection('search');
    expect(router.get().stack).toEqual([{ route: { name: 'search' } }]);
    expect(takePendingFocus()).toBeUndefined();
  });

  it('replaces the top screen and keeps Back leading below it', () => {
    push({ name: 'details', type: 'series', id: 'tt1' }, 'home-row-0-tile-1');
    push(
      { name: 'player', type: 'series', metaId: 'tt1', videoId: 'tt1:1:1' },
      'details-episodes-0',
    );
    replace({ name: 'player', type: 'series', metaId: 'tt1', videoId: 'tt1:1:2' });
    expect(topRoute()).toMatchObject({ name: 'player', videoId: 'tt1:1:2' });
    expect(router.get().stack).toHaveLength(3);

    expect(back()).toBe(true);
    expect(topRoute()).toMatchObject({ name: 'details', id: 'tt1' });
    expect(takePendingFocus()).toBe('details-episodes-0');
  });

  it('asks a return-focus function only as the screen below is shown again', () => {
    let target = 'home-continue-tile-2';
    let asked = 0;
    push({ name: 'player', type: 'movie', metaId: 'tt3', videoId: 'tt3' }, () => {
      asked += 1;
      return target;
    });
    target = 'home-continue-tile-0';
    expect(asked).toBe(0);

    expect(back()).toBe(true);
    expect(takePendingFocus()).toBe('home-continue-tile-0');
    expect(asked).toBe(1);
    expect(takePendingFocus()).toBeUndefined();
  });

  it('opens on top when asked to replace a section root', () => {
    replace({ name: 'streams', type: 'movie', metaId: 'tt2', videoId: 'tt2' });
    expect(router.get().stack).toHaveLength(2);
    expect(currentSection()).toBe('home');
  });
});

describe('playing a sports event', () => {
  const event = (kind: SportEvent['kind']): Pick<SportEvent, 'key' | 'sources' | 'kind'> => ({
    key: '0-tsport-arsenal-brighton',
    kind,
    sources: [
      {
        addonIndex: 0,
        addonId: 'org.test.sports',
        transportUrl: 'https://sports.example.com/manifest.json',
        type: 'sport',
        id: 'tsport:arsenal-brighton',
        name: 'Arsenal v Brighton',
        catalogId: 'replays',
      },
    ],
  });

  it('keeps the place of a replay, like any other video', () => {
    const play = eventPlay(event('replay'));
    expect(play).toMatchObject({ key: '0-tsport-arsenal-brighton', replay: true });
    expect(remembersPlace({ event: play })).toBe(true);
  });

  it('saves nothing for a match, live or still to come', () => {
    const play = eventPlay(event('event'));
    expect(play.replay).toBe(false);
    expect(remembersPlace({ event: play })).toBe(false);
  });

  it('saves nothing for the Lab, and keeps the place of other videos', () => {
    expect(remembersPlace({ lab: true })).toBe(false);
    expect(remembersPlace({ lab: true, event: eventPlay(event('replay')) })).toBe(false);
    expect(remembersPlace({})).toBe(true);
  });
});
