export {
  type CatalogView,
  catalogView,
  isSportsCatalog,
  looksLikeSports,
  needsEvidence,
  type SportsCatalog,
  sportsCatalogFilter,
  sportsCatalogs,
  type SportsSetting,
} from './detect';
export { createMatcher, type Matcher } from './dictionary';
export { buildEvents, replayedKeys, sportWord } from './events';
export {
  createSportsFeed,
  type SportsFeed,
  type SportsFeedState,
  SPORTS_LIVE_POLICY,
  SPORTS_POLICY,
  type WantOptions,
} from './feed';
export { createKickoffMemory, type KickoffMemory } from './kickoffs';
export { type CatalogContext, type Listing, readListing, rollClockWraps } from './listing';
export { sportOf } from './sport';
export { addDays, localClock, localDate, localDayStart } from './time';
export type {
  Competition,
  EventSource,
  EventState,
  KickOff,
  Sport,
  SportEvent,
  SportsData,
  SportsDay,
  SportsGroup,
} from './types';
export {
  buildDay,
  dayCounts,
  dayStrip,
  eventDay,
  eventState,
  searchEvents,
  SOON_MS,
  type ViewOptions,
} from './view';
