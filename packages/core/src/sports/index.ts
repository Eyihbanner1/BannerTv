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
export { buildEvents, isSport, replayedKeys, sportWord } from './events';
export {
  createFollows,
  type Follow,
  followableCompetition,
  followableTeams,
  followDocumentKey,
  type FollowKind,
  type Follows,
  type FollowSet,
  followsPart,
  type FollowTarget,
  isFollowed,
  MAX_FOLLOWS,
  NO_FOLLOWS,
} from './follows';
export {
  createSportsFeed,
  type SportsFeed,
  type SportsFeedState,
  SPORTS_LIVE_POLICY,
  SPORTS_POLICY,
  type WantOptions,
} from './feed';
export { createKickoffMemory, dayEvidence, type KickoffMemory } from './kickoffs';
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
