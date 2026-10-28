/** Readers for Trakt's JSON, where every value is checked before use. */

export function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function list(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

/** A string with something in it. */
export function text(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/** A whole number from 0 up, such as a season or episode number. */
export function whole(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

/** A finite number above 0, such as a runtime. */
export function positive(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

/** An ISO 8601 time as milliseconds since 1970. */
export function time(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : undefined;
}
