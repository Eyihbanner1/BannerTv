import type { HomeRow, Shape, Title } from './model';

/**
 * Home's rows for the trial: Cinemeta's public catalogs with Metahub art,
 * the same sources and sizes the app uses on a 4K TV, so the images cost the
 * same to decode. No addon of Eyitayo's is read; the trial needs none.
 */
const CINEMETA = 'https://v3-cinemeta.strem.io';
const METAHUB = 'https://images.metahub.space';
const ROW_ITEMS = 40;

interface CatalogSpec {
  key: string;
  title: string;
  shape: Shape;
  path: string;
}

const CATALOGS: CatalogSpec[] = [
  { key: 'movies', title: 'Popular movies', shape: 'poster', path: 'movie/top' },
  { key: 'series', title: 'Popular series', shape: 'poster', path: 'series/top' },
  { key: 'action', title: 'Action', shape: 'landscape', path: 'movie/top/genre=Action' },
  { key: 'comedy', title: 'Comedy', shape: 'poster', path: 'movie/top/genre=Comedy' },
  { key: 'drama', title: 'Drama series', shape: 'poster', path: 'series/top/genre=Drama' },
  { key: 'scifi', title: 'Science fiction', shape: 'landscape', path: 'movie/top/genre=Sci-Fi' },
  { key: 'animation', title: 'Animation', shape: 'poster', path: 'movie/top/genre=Animation' },
  { key: 'thriller', title: 'Thrillers', shape: 'poster', path: 'movie/top/genre=Thriller' },
];

interface CinemetaMeta {
  id?: string;
  name?: string;
  poster?: string;
  background?: string;
  logo?: string;
  description?: string;
  releaseInfo?: string;
  runtime?: string;
}

/** Metahub art at a given size, for IMDb ids; otherwise what the catalog gave. */
export function art(
  id: string,
  kind: 'poster' | 'background' | 'logo',
  fallback?: string,
): string | undefined {
  return /^tt\d+$/.test(id) ? `${METAHUB}/${kind}/medium/${id}/img` : fallback;
}

export function toTitle(meta: CinemetaMeta): Title | null {
  if (!meta.id || !meta.name) return null;
  const info = [meta.releaseInfo, meta.runtime].filter(Boolean).join('  ·  ');
  return {
    id: meta.id,
    name: meta.name,
    poster: art(meta.id, 'poster', meta.poster),
    background: art(meta.id, 'background', meta.background),
    logo: art(meta.id, 'logo', meta.logo),
    description: meta.description,
    info: info || undefined,
  };
}

async function loadCatalog(spec: CatalogSpec, signal: AbortSignal): Promise<HomeRow | null> {
  try {
    const response = await fetch(`${CINEMETA}/catalog/${spec.path}.json`, { signal });
    if (!response.ok) return null;
    const body = (await response.json()) as { metas?: CinemetaMeta[] };
    const items = (body.metas ?? [])
      .map(toTitle)
      .filter((title): title is Title => title !== null)
      .slice(0, ROW_ITEMS);
    return items.length > 0 ? { key: spec.key, title: spec.title, shape: spec.shape, items } : null;
  } catch {
    return null;
  }
}

/** Live rows, or an empty list when Cinemeta cannot be reached within the time allowed. */
export async function loadLiveRows(timeoutMs = 8000): Promise<HomeRow[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const rows = await Promise.all(CATALOGS.map((spec) => loadCatalog(spec, controller.signal)));
    return rows.filter((row): row is HomeRow => row !== null);
  } finally {
    clearTimeout(timer);
  }
}

const SWATCHES = ['#4B23C8', '#261C42', '#3D1AA8', '#5B2FE0', '#6A3BF0', '#7B4DFF', '#1B1430'];

/**
 * A flat image with a label, as a data: address. Not a blob: one: a page
 * opened from file:// cannot read its own blobs from the renderer's image workers.
 */
function swatch(width: number, height: number, color: string, label: string): string {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d')!;
  const gradient = context.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, color);
  gradient.addColorStop(1, '#C9B5FF');
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);
  context.fillStyle = 'rgba(11, 8, 21, 0.6)';
  context.font = `700 ${Math.round(width / 8)}px sans-serif`;
  context.fillText(label, width / 12, height - width / 10);
  return canvas.toDataURL('image/jpeg', 0.85);
}

/**
 * Made-up rows with art drawn on the spot, for a machine that cannot reach
 * Cinemeta (CI, the cloud) or for a TV run that should not depend on the network.
 */
export async function fixtureRows(): Promise<HomeRow[]> {
  const posters = SWATCHES.map((color, i) => swatch(440, 660, color, `P${i + 1}`));
  const backdrops = SWATCHES.map((color, i) => swatch(1280, 720, color, `B${i + 1}`));
  return CATALOGS.map((spec, r) => ({
    key: spec.key,
    title: spec.title,
    shape: spec.shape,
    items: Array.from({ length: ROW_ITEMS }, (_, i) => ({
      id: `${spec.key}-${i}`,
      name: `${spec.title} ${i + 1}`,
      poster: posters[(i + r) % posters.length],
      background: backdrops[(i + r) % backdrops.length],
      description: 'A made-up title for the motion trial, so the walk runs without the network.',
      info: `${2000 + ((i * 7 + r) % 26)}  ·  ${90 + ((i * 13) % 60)} min`,
    })),
  }));
}
