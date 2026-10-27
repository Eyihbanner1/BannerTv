import { describe, expect, it } from 'vitest';
import { artworkUrl, isSharpDisplay } from './artwork-size';

const metahub = (kind: string, size: string) =>
  `https://images.metahub.space/${kind}/${size}/tt1160419/img`;

describe('artworkUrl', () => {
  it('asks for bigger Metahub images on a 4K TV', () => {
    expect(artworkUrl(metahub('poster', 'small'), 'posterTile', true)).toBe(
      metahub('poster', 'medium'),
    );
    expect(artworkUrl(metahub('poster', 'large'), 'posterTile', true)).toBe(
      metahub('poster', 'medium'),
    );
    expect(artworkUrl(metahub('background', 'medium'), 'backdrop', true)).toBe(
      metahub('background', 'large'),
    );
    expect(artworkUrl(metahub('logo', 'medium'), 'titleLogo', true)).toBe(metahub('logo', 'large'));
    expect(artworkUrl(metahub('background', 'medium'), 'landscapeTile', true)).toBe(
      metahub('background', 'medium'),
    );
    expect(artworkUrl(metahub('logo', 'medium'), 'tileLogo', true)).toBe(metahub('logo', 'medium'));
  });

  it("keeps the addon's address on a 1x display and for other services", () => {
    expect(artworkUrl(metahub('poster', 'small'), 'posterTile', false)).toBe(
      metahub('poster', 'small'),
    );
    const tmdb = 'https://image.tmdb.org/t/p/w500/x.jpg';
    expect(artworkUrl(tmdb, 'posterTile', true)).toBe(tmdb);
    expect(artworkUrl(undefined, 'backdrop', true)).toBeUndefined();
  });
});

describe('isSharpDisplay', () => {
  it('is true for a page drawn at twice its size, unless the TV is in low-power mode', () => {
    expect(isSharpDisplay(2, false)).toBe(true);
    expect(isSharpDisplay(1.5, false)).toBe(true);
    expect(isSharpDisplay(1, false)).toBe(false);
    expect(isSharpDisplay(2, true)).toBe(false);
  });
});
