/**
 * Placeholder titles for the Phase 0 navigation skeleton, taken from the
 * Blender Studio open movies (Creative Commons). Phase 1 replaces this with
 * catalogs from addons.
 */
export interface SampleItem {
  id: string;
  title: string;
  year: number;
  /** Index into the tile art palette. */
  art: number;
}

const TITLES: ReadonlyArray<readonly [title: string, year: number]> = [
  ['Elephants Dream', 2006],
  ['Big Buck Bunny', 2008],
  ['Sintel', 2010],
  ['Tears of Steel', 2012],
  ['Caminandes', 2013],
  ['Cosmos Laundromat', 2015],
  ['Glass Half', 2015],
  ['Agent 327', 2017],
  ['Hero', 2018],
  ['Spring', 2019],
  ['Coffee Run', 2020],
  ['Sprite Fright', 2021],
  ['Charge', 2022],
  ['Wing It!', 2023],
];

export const SAMPLE_ITEMS: readonly SampleItem[] = TITLES.map(([title, year], index) => ({
  id: title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-$/, ''),
  title,
  year,
  art: index,
}));

export interface SampleRow {
  id: string;
  titleKey: 'home.rowPosters' | 'home.rowLandscape';
  shape: 'poster' | 'landscape';
  items: readonly SampleItem[];
}

export const SAMPLE_ROWS: readonly SampleRow[] = [
  { id: 'posters', titleKey: 'home.rowPosters', shape: 'poster', items: SAMPLE_ITEMS },
  {
    id: 'landscape',
    titleKey: 'home.rowLandscape',
    shape: 'landscape',
    items: [...SAMPLE_ITEMS].reverse(),
  },
];

export function findSampleItem(id: string): SampleItem | undefined {
  return SAMPLE_ITEMS.find((item) => item.id === id);
}

// Gradients from the brand violets plus a few neighbours, so placeholder tiles
// are easy to tell apart.
const ART = [
  ['#4B23C8', '#C9B5FF'],
  ['#261C42', '#7B4DFF'],
  ['#3D1AA8', '#A98BFF'],
  ['#1B1430', '#6A3BF0'],
  ['#5B2FE0', '#F1EDFF'],
  ['#120E20', '#9C7BFF'],
] as const;

export function artGradient(item: SampleItem, angle = 160): string {
  const [from, to] = ART[item.art % ART.length]!;
  return `linear-gradient(${angle}deg, ${from}, ${to})`;
}
