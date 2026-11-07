/** How wide Metahub's small posters are: the size Cinemeta itself points at. */
export const SMALL_POSTER_PX = 300;

/**
 * The Metahub poster size for a tile `widthDp` wide on a screen with `pixelRatio` device pixels
 * to a dp, rounded as PixelRatio.getPixelSizeForLayoutSize rounds. Small when its 300 pixels
 * cover the tile (a 104 dp tile at a Galaxy S25 Ultra's default 2.8125 takes 293), so the
 * addon's own address loads with nothing to fetch twice; medium wherever small would be
 * stretched, as on a QHD+ setting.
 */
export function posterArtSize(widthDp: number, pixelRatio: number): 'small' | 'medium' {
  return Math.round(widthDp * pixelRatio) <= SMALL_POSTER_PX ? 'small' : 'medium';
}
