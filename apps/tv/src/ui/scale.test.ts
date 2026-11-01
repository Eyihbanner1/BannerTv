import { describe, expect, it } from 'vitest';
import { scaled, scaleFor } from './scale';

describe('scale', () => {
  it('maps the 1920 design onto the 960 dp a 1080p or 4K Android TV reports', () => {
    const scale = scaleFor(960);
    expect(scaled(96, scale)).toBe(48);
    expect(scaled(5, scale)).toBe(2.5);
    expect(scaled(1920, scale)).toBe(960);
  });

  it('keeps the design size on a TV that reports 1920', () => {
    expect(scaled(84, scaleFor(1920))).toBe(84);
  });

  it('falls back to half size when the window is not measured yet', () => {
    expect(scaleFor(0)).toBe(0.5);
  });
});
