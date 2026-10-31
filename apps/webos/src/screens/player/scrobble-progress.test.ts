import { describe, expect, it } from 'vitest';
import { isClip, isSpecial, percent } from './scrobble-progress';

const EPISODE_S = 47 * 60;
const EPISODE = 'tt0944947:1:3';

describe('isClip', () => {
  it('takes a 30 second file of a 47 minute episode for a clip', () => {
    expect(isClip({ position: 30, duration: 30 }, EPISODE_S, EPISODE)).toBe(true);
  });

  it('takes a short episode for the episode', () => {
    expect(isClip({ position: 0, duration: 21 * 60 }, EPISODE_S, EPISODE)).toBe(false);
  });

  it('takes a short file of a short title for the title', () => {
    expect(isClip({ position: 0, duration: 4 * 60 }, 15 * 60, EPISODE)).toBe(false);
    expect(isClip({ position: 0, duration: 4 * 60 }, 4 * 60, 'tt0000001')).toBe(false);
  });

  it('never guesses: without a running time from the title, nothing is a clip', () => {
    expect(isClip({ position: 30, duration: 30 }, undefined, EPISODE)).toBe(false);
  });

  it('never takes a special for a clip, however long the series runs', () => {
    expect(isSpecial('tt0944947:0:12')).toBe(true);
    expect(isSpecial('tmdb:1399:0:1')).toBe(true);
    expect(isSpecial('tt0944947:10:1')).toBe(false);
    expect(isSpecial('tt0944947')).toBe(false);
    expect(isClip({ position: 0, duration: 3 * 60 }, EPISODE_S, 'tt0944947:0:12')).toBe(false);
  });

  it('needs a length from the file', () => {
    expect(isClip({ position: 30, duration: 0 }, EPISODE_S, EPISODE)).toBe(false);
  });
});

describe('percent', () => {
  it('measures a file against its own length', () => {
    expect(percent({ position: 30 * 60, duration: 60 * 60 }, EPISODE_S, false)).toBe(50);
  });

  it('measures a file that gives no length against the running time, or the guess at it', () => {
    expect(percent({ position: EPISODE_S / 4, duration: 0 }, EPISODE_S, false)).toBe(25);
  });

  it('measures a clip against the episode, so its end is not a watched episode', () => {
    expect(percent({ position: 30, duration: 30 }, EPISODE_S, true)).toBeLessThan(2);
  });

  it('takes the end of a whole short episode for 100%', () => {
    expect(percent({ position: 21 * 60, duration: 21 * 60 }, 3600, false)).toBe(100);
  });

  it('is 0 with no length at all', () => {
    expect(percent({ position: 10, duration: 0 }, 0, false)).toBe(0);
  });
});
