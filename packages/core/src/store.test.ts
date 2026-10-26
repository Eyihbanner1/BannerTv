import { describe, expect, it, vi } from 'vitest';
import { createStore } from './store';

describe('createStore', () => {
  it('returns the initial value', () => {
    expect(createStore({ count: 1 }).get()).toEqual({ count: 1 });
  });

  it('sets a value or applies an updater', () => {
    const store = createStore(1);
    store.set(2);
    expect(store.get()).toBe(2);
    store.set((prev) => prev + 3);
    expect(store.get()).toBe(5);
  });

  it('notifies subscribers only when the value changes', () => {
    const store = createStore('a');
    const listener = vi.fn();
    store.subscribe(listener);
    store.set('a');
    expect(listener).not.toHaveBeenCalled();
    store.set('b');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('stops notifying after unsubscribe', () => {
    const store = createStore(0);
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    store.set(1);
    unsubscribe();
    store.set(2);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
