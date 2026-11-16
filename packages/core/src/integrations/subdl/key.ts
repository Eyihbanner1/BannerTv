/**
 * The viewer's own SubDL key, as a profile keeps it: never shown again once
 * saved, never logged, and sent to SubDL's API only (ADR 0003, step D).
 */
export interface SubdlKeyRecord {
  key: string;
  /** Not tried since it was saved, accepted by SubDL, or refused by it. */
  state: 'unchecked' | 'works' | 'refused';
}

export const SUBDL_KEY_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

/** The key typed or pasted, trimmed; null when it cannot be a SubDL key. */
export function cleanSubdlKey(text: string): string | null {
  const key = text.trim();
  return SUBDL_KEY_PATTERN.test(key) ? key : null;
}

const STATES: ReadonlyArray<SubdlKeyRecord['state']> = ['unchecked', 'works', 'refused'];

/** The saved record, checked; anything else is no key. */
export function readSubdlKey(saved: unknown): SubdlKeyRecord | null {
  if (typeof saved !== 'object' || saved === null) return null;
  const { key, state } = saved as { key?: unknown; state?: unknown };
  if (typeof key !== 'string' || !SUBDL_KEY_PATTERN.test(key)) return null;
  const known = STATES.indexOf(state as SubdlKeyRecord['state']) !== -1;
  return { key, state: known ? (state as SubdlKeyRecord['state']) : 'unchecked' };
}
