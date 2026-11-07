import { describe, expect, it } from 'vitest';
import { nextChoice } from './choices';

describe('nextChoice', () => {
  it('walks the choices and wraps round', () => {
    const sizes = ['small', 'medium', 'large', 'huge'] as const;
    expect(nextChoice(sizes, 'medium')).toBe('large');
    expect(nextChoice(sizes, 'huge')).toBe('small');
  });

  it('starts from the first when the value is not one of them', () => {
    expect(nextChoice(['quality', 'fast'], 'addon')).toBe('quality');
  });
});
