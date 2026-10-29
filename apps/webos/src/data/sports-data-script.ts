/**
 * The team and league data (packages/core/src/sports/data) ships as its own
 * classic script next to index.html, so the start-up bundle never parses it
 * and the TV loads it only once a sports addon is installed (docs/PLAN.md,
 * Matcher data). The script sets one global, read once and deleted.
 * vite.config.ts reads this table to emit the file.
 */
export const SPORTS_DATA_SCRIPT = {
  file: 'data/sports-data.js',
  global: '__BANNERTV_SPORTS_DATA__',
} as const;
