import { describe, expect, it, vi } from 'vitest';
import { createBackStack } from './back';

describe('createBackStack', () => {
  it('asks overlays before screens and screens before the router', () => {
    const stack = createBackStack();
    const calls: string[] = [];
    stack.push('overlay', () => (calls.push('overlay'), false));
    stack.push('router', () => (calls.push('router'), true));
    stack.push('screen', () => (calls.push('screen'), false));
    expect(stack.handle()).toBe(true);
    expect(calls).toEqual(['overlay', 'screen', 'router']);
  });

  it('asks the newest handler in a layer first and stops at the first that handles it', () => {
    const stack = createBackStack();
    const older = vi.fn(() => true);
    const newer = vi.fn(() => true);
    stack.push('screen', older);
    stack.push('screen', newer);
    stack.handle();
    expect(newer).toHaveBeenCalledTimes(1);
    expect(older).not.toHaveBeenCalled();
  });

  it('forgets removed handlers', () => {
    const stack = createBackStack();
    const handler = vi.fn(() => true);
    const remove = stack.push('overlay', handler);
    remove();
    expect(stack.handle()).toBe(false);
    expect(handler).not.toHaveBeenCalled();
  });
});
