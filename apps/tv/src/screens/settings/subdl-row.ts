import type { SubdlKeyRecord } from '@bannertv/core';

/** The SubDL line's value in Subtitles: the key is added or changed on the phone or the LG. */
export function subdlRowValue(record: SubdlKeyRecord | null): 'on' | 'off' | 'refused' {
  if (!record) return 'off';
  return record.state === 'refused' ? 'refused' : 'on';
}
