import { describe, expect, it } from 'vitest';
import { pop, push, replace, reset, top } from './stack';

describe('screen stack', () => {
  it('walks back the way it came, and stops at the first screen', () => {
    let stack = reset('home');
    stack = push(stack, 'details');
    stack = push(stack, 'player');
    expect(top(stack)).toBe('player');
    stack = pop(stack)!;
    expect(top(stack)).toBe('details');
    stack = pop(stack)!;
    expect(top(stack)).toBe('home');
    expect(pop(stack)).toBeNull();
  });

  it('replaces the top screen without growing the stack', () => {
    const stack = replace(push(reset('home'), 'player 1'), 'player 2');
    expect(stack.screens).toEqual(['home', 'player 2']);
  });
});
