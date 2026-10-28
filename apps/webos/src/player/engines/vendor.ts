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
  const promise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `./${VENDOR_SCRIPTS[name].file}`;
    script.onload = () => resolve();
    script.onerror = () => {
      script.remove();
      delete loading[name];
      reject(new Error(`Could not load the ${name} player`));
    };
    document.head.appendChild(script);
  });
  loading[name] = promise;
  return promise;
}
