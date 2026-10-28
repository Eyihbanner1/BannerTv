import { beforeEach, describe, expect, it } from 'vitest';
import {
  back,
  canGoBack,
  currentSection,
  openSection,
  push,
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
});
