/**
 * The account's documents are maps from an item key to an item: a value
 * with its time, or a removal with its time (ADR 0006, decision 1). Keys
 * come from addons (title and video ids), so a key such as `__proto__` must
 * be an ordinary key: every map here has no prototype, and ownership is
 * checked with hasOwnProperty.
 */

export interface LiveItem {
  /** Account-clock milliseconds. */
  t: number;
  v: unknown;
}

export interface Removal {
  t: number;
  x: 1;
}

export type Item = LiveItem | Removal;

/** Items by key, with no prototype. Make them with newItems or readItems. */
export interface Items {
  [key: string]: Item;
}

const own = Object.prototype.hasOwnProperty;

export function isRemoval(item: Item): item is Removal {
  return (item as Removal).x === 1;
}

export function newItems(): Items {
  return Object.create(null) as Items;
}

export function hasItem(items: Items, key: string): boolean {
  return own.call(items, key);
}

export function itemAt(items: Items, key: string): Item | undefined {
  return own.call(items, key) ? items[key] : undefined;
}

export function copyItems(items: Items): Items {
  const copy = newItems();
  for (const key of Object.keys(items)) copy[key] = items[key]!;
  return copy;
}

/** An item as saved or sent, or undefined when it is not one. */
export function readItem(value: unknown): Item | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const raw = value as { t?: unknown; v?: unknown; x?: unknown };
  const t = raw.t;
  if (typeof t !== 'number' || !Number.isFinite(t) || t < 0) return undefined;
  if (raw.x === 1) return { t, x: 1 };
  if (!own.call(raw, 'v') || raw.v === undefined) return undefined;
  return { t, v: raw.v };
}

/** The readable items of a saved or opened map, as a map with no prototype. */
export function readItems(value: unknown): Items {
  const items = newItems();
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return items;
  for (const key of Object.keys(value)) {
    const item = readItem((value as { [key: string]: unknown })[key]);
    if (item) items[key] = item;
  }
  return items;
}

/**
 * JSON with every object's keys sorted, so the same value is the same text
 * on every screen: it breaks ties between items and is what gets sealed.
 */
export function canon(value: unknown): string {
  if (typeof value !== 'object' || value === null) {
    const text = JSON.stringify(value);
    return text === undefined ? 'null' : text;
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canon(entry)).join(',')}]`;
  }
  const record = value as { [key: string]: unknown };
  const parts: string[] = [];
  for (const key of Object.keys(record).sort()) {
    const entry = record[key];
    if (entry === undefined || typeof entry === 'function') continue;
    parts.push(`${JSON.stringify(key)}:${canon(entry)}`);
  }
  return `{${parts.join(',')}}`;
}
