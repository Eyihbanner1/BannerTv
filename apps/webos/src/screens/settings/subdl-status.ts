import type { SubdlKeyRecord, SubdlRestWhy } from '@bannertv/core';

/** What the SubDL screen last did, shown until the viewer does something else. */
export type SubdlNotice =
  'badFormat' | 'checking' | 'works' | 'refused' | 'unreachable' | 'removed';

/** The status line's string under `subdl.`, or null for none. */
export type SubdlStatus = SubdlNotice | 'resting' | 'usedUp';

/**
 * The SubDL screen's status line: what the screen just did, else a key SubDL
 * refused, else a rest SubDL asked for. A rest is shown only with a key saved.
 */
export function subdlStatus(
  notice: SubdlNotice | null,
  state: SubdlKeyRecord['state'] | null,
  rest: SubdlRestWhy | null,
): SubdlStatus | null {
  if (notice) return notice;
  if (state === null) return null;
  if (state === 'refused') return 'refused';
  if (rest === 'busy' || rest === 'failing') return 'resting';
  if (rest === 'limit') return 'usedUp';
  return null;
}

/** The SubDL row's value in Settings. */
export function subdlSettingsValue(record: SubdlKeyRecord | null): 'on' | 'off' | 'refused' {
  if (!record) return 'off';
  return record.state === 'refused' ? 'refused' : 'on';
}
