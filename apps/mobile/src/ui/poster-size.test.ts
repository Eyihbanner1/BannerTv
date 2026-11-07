import { metahubAtSize } from '@bannertv/core';
import { phone } from '../../../../brand/tokens/design';
import { describe, expect, it } from 'vitest';
import { posterArtSize, SMALL_POSTER_PX } from './poster-size';

/** A Grid tile's width, as Grid.tsx works it out: three columns between the gutters. */
const gridTile = (windowDp: number) => Math.floor((windowDp - phone.gutter * 2 - 12 * 2) / 3);

describe('the poster size a tile asks for', () => {
  it('is small where 300 pixels cover the tile', () => {
    // Galaxy S25 Ultra at its default FHD+ setting: 1080 pixels, 384 dp wide at 2.8125.
    expect(posterArtSize(phone.tilePosterW, 2.8125)).toBe('small');
    expect(posterArtSize(gridTile(384), 2.8125)).toBe('small');
    // A 1080p phone at 2.625.
    expect(posterArtSize(phone.tilePosterW, 2.625)).toBe('small');
    // The web build at one pixel a dp.
    expect(posterArtSize(phone.tilePosterW, 1)).toBe('small');
  });

  it('is medium wherever a small poster would be stretched', () => {
    // The same phone at its QHD+ setting, 3.75.
    expect(posterArtSize(phone.tilePosterW, 3.75)).toBe('medium');
    expect(posterArtSize(phone.tilePosterW, 3)).toBe('medium');
    // A grid held sideways has wide tiles.
    expect(posterArtSize(gridTile(832), 2.8125)).toBe('medium');
  });

  it('draws the line at 300 device pixels, rounded as React Native rounds them', () => {
    expect(posterArtSize(SMALL_POSTER_PX, 1)).toBe('small');
    expect(posterArtSize(SMALL_POSTER_PX + 1, 1)).toBe('medium');
    expect(posterArtSize(100, 3.004)).toBe('small'); // 300.4 rounds to 300
    expect(posterArtSize(100, 3.005)).toBe('medium'); // 300.5 rounds to 301
  });

  it("leaves Cinemeta's own small poster address as it is", () => {
    const poster = 'https://images.metahub.space/poster/small/tt0111161/img';
    expect(metahubAtSize(poster, posterArtSize(phone.tilePosterW, 2.8125))).toBe(poster);
  });
});
