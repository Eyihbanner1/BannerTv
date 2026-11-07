/**
 * The design is drawn on a 1920x1080 TV screen (brand/tokens/design.json). Android TVs report
 * their screen in density-independent pixels, 960x540 on most 1080p and 4K sets, so every size
 * goes through px() to land at the same place on any of them.
 */
export const DESIGN_WIDTH = 1920;

export function scaleFor(windowWidth: number): number {
  return windowWidth > 0 ? windowWidth / DESIGN_WIDTH : 0.5;
}

/** A design size at the given scale, to the nearest half pixel. */
export function scaled(value: number, scale: number): number {
  return Math.round(value * scale * 2) / 2;
}
