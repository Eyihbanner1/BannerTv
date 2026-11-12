import { loadAppScript } from '../../platform/shell';

/**
 * hls.js and Shaka ship as their own classic scripts next to index.html, so
 * the start-up bundle stays small and the TV only parses them when a stream
 * needs one (docs/PLAN.md, performance budgets). The build copies them from
 * node_modules; vite.config.ts reads this table.
 */
export const VENDOR_SCRIPTS = {
  hls: { file: 'vendor/hls.min.js', from: 'hls.js/dist/hls.min.js' },
  // The DASH-only build: BannerTV's HLS goes to the TV or hls.js.
  shaka: { file: 'vendor/shaka-player.dash.js', from: 'shaka-player/dist/shaka-player.dash.js' },
} as const;

export type VendorScript = keyof typeof VENDOR_SCRIPTS;

const loading: Partial<Record<VendorScript, Promise<void>>> = {};

/** Loads one vendor script once. A failed load can be tried again. */
export function loadVendorScript(name: VendorScript): Promise<void> {
  const existing = loading[name];
  if (existing) return existing;
  // Through the loader, so an update that carries a newer player runs its own.
  const promise = loadAppScript(VENDOR_SCRIPTS[name].file).catch(() => {
    delete loading[name];
    throw new Error(`Could not load the ${name} player`);
  });
  loading[name] = promise;
  return promise;
}
