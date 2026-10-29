import type { Section } from '../app/router';

// Simple line icons on a 24 px grid, drawn for BannerTV.
const PATHS: Record<Section, string> = {
  home: 'M3 11.5 12 4l9 7.5M5.5 9.5V20h5v-6h3v6h5V9.5',
  search: 'M10.5 4a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13ZM15.5 15.5 21 21',
  discover: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18ZM15.5 8.5l-2 5-5 2 2-5 5-2Z',
  // A ball: the outline, a centre patch and its seams.
  sports:
    'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18ZM12 8.5l3.3 2.4-1.3 3.9h-4l-1.3-3.9L12 8.5ZM12 8.5V3.5M15.3 10.9l4.6-1.5M14 14.8l2.8 3.9M10 14.8l-2.8 3.9M8.7 10.9 4.1 9.4',
  library: 'M5 4h4v16H5zM10.5 4h4v16h-4zM16 5l3.5-.8 3 15.6-3.6.8z',
  addons:
    'M9 4h3v2.5a1.5 1.5 0 0 0 3 0V4h3v5h-2.5a1.5 1.5 0 0 0 0 3H18v8h-5v-2.5a1.5 1.5 0 0 0-3 0V20H5v-5h2.5a1.5 1.5 0 0 0 0-3H5V4h4',
  settings:
    'M12 8.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7ZM12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1',
};

export function RailIcon({ section }: { section: Section }) {
  return (
    <svg width="48" height="48" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d={PATHS[section]}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
