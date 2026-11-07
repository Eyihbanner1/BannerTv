import { describe, expect, it } from 'vitest';
import { createPlayerFirst } from './player-first';

describe('createPlayerFirst', () => {
  it('raises the requests of the videos a player has, until it lets them go', () => {
    const first = createPlayerFirst();
    expect(first.priority('movie', 'tt1')).toBe(0);
    const release = first.put([{ type: 'movie', id: 'tt1' }]);
    expect(first.priority('movie', 'tt1')).toBe(1);
    // Another video, or the same id as another type, is not the player's.
    expect(first.priority('movie', 'tt2')).toBe(0);
    expect(first.priority('series', 'tt1')).toBe(0);
    release();
    expect(first.priority('movie', 'tt1')).toBe(0);
  });

  it('keeps a video first while another player still has it, and counts each release once', () => {
    const first = createPlayerFirst();
    const one = first.put([{ type: 'movie', id: 'tt1' }]);
    const two = first.put([
      { type: 'movie', id: 'tt1' },
      { type: 'movie', id: 'tt1' },
    ]);
    one();
    one();
    expect(first.priority('movie', 'tt1')).toBe(1);
    two();
    expect(first.priority('movie', 'tt1')).toBe(0);
  });

  it("takes a sports event's sources together", () => {
    const first = createPlayerFirst();
    const release = first.put([
      { type: 'tv', id: 'event' },
      { type: 'tv', id: 'source-a' },
      { type: 'channel', id: 'source-b' },
    ]);
    expect(first.priority('tv', 'source-a')).toBe(1);
    expect(first.priority('channel', 'source-b')).toBe(1);
    release();
    expect(first.priority('channel', 'source-b')).toBe(0);
  });
});
