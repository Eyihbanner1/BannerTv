import { CONTINUE_LINE, LIVE_SPORT_LINE, MY_LIST_LINE, type OwnLine } from '@bannertv/core';

/**
 * Home's own lines on the phone and where each sits until it is moved in Home rows: Continue
 * Watching first (it can be hidden, not moved), then My List, then Live sport while a sports
 * addon is installed, all above the catalog rows. The TV puts Live sport third.
 */
export function phoneOwnLines(sportShown: boolean): OwnLine[] {
  const lines: OwnLine[] = [
    { id: CONTINUE_LINE, place: 0, fixed: true },
    { id: MY_LIST_LINE, place: 0 },
  ];
  if (sportShown) lines.push({ id: LIVE_SPORT_LINE, place: 0 });
  return lines;
}
