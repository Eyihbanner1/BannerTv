import { metahubAtSize, type MetahubSize } from '@bannertv/core';

/**
 * Where an image is drawn, and how many device pixels that takes on a 4K TV,
 * which draws the 1920x1080 page at a device pixel ratio of 2.
 */
export type ArtworkSurface =
  | 'posterTile' // 220x330 -> 440x660
  | 'landscapeTile' // 384x216 -> 768x432
  | 'tileLogo' // up to 238x82 -> 476x164
  | 'backdrop' // Hero 1376x774 -> 2752x1548; Details 1736x1080 -> 3472x2160
  | 'titleLogo'; // Hero 560x140 -> 1120x280; Details 640x180 -> 1280x360

/**
 * Metahub sizes for a 4K TV. Cinemeta points at small posters (300 wide),
 * which a 4K TV stretches to 440 and blurs. Medium posters (about 500) are
 * enough; large ones would cost over twice the decoding for nothing a tile
 * can show. The hero and Details share a size, so Details reuses the hero's
 * image instead of fetching another.
 */
const SHARP_SIZE: Record<ArtworkSurface, MetahubSize> = {
  posterTile: 'medium',
  landscapeTile: 'medium',
  tileLogo: 'medium',
  backdrop: 'large',
  titleLogo: 'large',
};

/** A TV drawing the page at twice its size. Low-power TVs (webOS 5) keep the addon's sizes. */
export function isSharpDisplay(
  ratio = window.devicePixelRatio || 1,
  lowPower = document.documentElement.classList.contains('low-power'),
): boolean {
  return ratio >= 1.5 && !lowPower;
}

/** The addon's artwork address, sized for where it is drawn. Unchanged on a 1x display. */
export function artworkUrl(
  url: string | undefined,
  surface: ArtworkSurface,
  sharp = isSharpDisplay(),
): string | undefined {
  return url && sharp ? metahubAtSize(url, SHARP_SIZE[surface]) : url;
}
