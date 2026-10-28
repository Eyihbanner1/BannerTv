/**
 * Small readers for untrusted addon JSON. Addon responses vary wildly in
 * quality, so each reader returns undefined (or an empty list) for a value of
 * the wrong shape instead of throwing, and the caller decides whether the
 * whole item is still usable.
 */

export type JsonRecord = Record<string, unknown>;

export function asRecord(value: unknown): JsonRecord | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined;
}

/** A non-empty trimmed string. Numbers are accepted and turned into strings. */
export function readString(value: unknown): string | undefined {
  if (typeof value === 'number' && isFinite(value)) return String(value);
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

/** A finite number. Numeric strings such as "3" are accepted. */
export function readNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return isFinite(value) ? value : undefined;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

export function readBoolean(value: unknown): boolean {
  return value === true;
}

/** The strings in an array, skipping anything else. A single string counts as a list of one. */
export function readStringList(value: unknown): string[] {
  if (typeof value === 'string') {
    const one = readString(value);
    return one === undefined ? [] : [one];
  }
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    const text = readString(item);
    if (text !== undefined && out.indexOf(text) === -1) out.push(text);
  }
  return out;
}

export function readList(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/**
 * An absolute http or https URL, or undefined. Addons return data only, so
 * anything else (javascript:, data:, relative paths) is refused.
 */
export function readHttpUrl(value: unknown): string | undefined {
  const text = readString(value);
  if (text === undefined || !/^https?:\/\/[^\s/?#]+/i.test(text) || /\s/.test(text)) {
    return undefined;
  }
  return text;
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

/**
 * Plain text from a description that may contain HTML. Tags are removed
 * (block tags become line breaks), common entities decoded and runs of spaces
 * collapsed. The result is only ever shown as text, never parsed as HTML.
 */
export function readPlainText(value: unknown): string | undefined {
  const text = readString(value);
  if (text === undefined) return undefined;
  const plain = text
    .replace(/<\s*(br|\/p|\/div|\/li)\b[^>]*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match: string, code: string) => {
      const lower = code.toLowerCase();
      if (lower.charAt(0) === '#') {
        const point =
          lower.charAt(1) === 'x' ? parseInt(lower.slice(2), 16) : parseInt(lower.slice(1), 10);
        return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : match;
      }
      return ENTITIES[lower] ?? match;
    })
    .replace(/[ \t\f\v\u00a0]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return plain === '' ? undefined : plain;
}

/** An ISO date that Date can read, normalised to the full ISO form. */
export function readIsoDate(value: unknown): string | undefined {
  const text = readString(value);
  if (text === undefined) return undefined;
  const time = Date.parse(text);
  return isNaN(time) ? undefined : new Date(time).toISOString();
}
