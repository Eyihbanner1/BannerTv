export { buildBoard, type BoardRow, GENRE_PICKS, type RowStyle, slug } from './addons/board';
export {
  arrangeBoard,
  createHomeLayout,
  EMPTY_LAYOUT,
  type HomeLayout,
  type HomeLayoutStore,
  moveRow,
  orderedRows,
  rowIdentity,
  setRowHidden,
} from './addons/layout';
export {
  type AddonAnswer,
  type AddonClient,
  BROWSE_TIMEOUT_MS,
  CATALOG_POLICY,
  type CatalogOptions,
  createAddonClient,
  META_POLICY,
  metahubAtSize,
  type MetahubSize,
  NotFoundError,
  PLAY_TIMEOUT_MS,
  STREAM_POLICY,
  type SubtitleHints,
  SUBTITLES_POLICY,
  withArtwork,
} from './addons/client';
export {
  type AddonCollection,
  type CollectionState,
  createAddonCollection,
  InstallError,
  type InstallErrorKind,
  type InstalledAddon,
  type StoredAddon,
} from './addons/collection';
export { CINEMETA_URL, DEFAULT_ADDONS, OPENSUBTITLES_V3_URL } from './addons/defaults';
export {
  type CatalogPager,
  createCatalogPager,
  type PagerState,
  type PagerStatus,
} from './addons/pager';
export {
  type CatalogSource,
  discoverSources,
  type DiscoverSource,
  orderedTypes,
  searchSources,
} from './addons/sources';
export { type FetchJson, type FetchJsonOptions, HttpError, type HttpErrorKind } from './http';
export {
  createLibrary,
  type Library,
  type LibraryChange,
  type LibraryItem,
  MAX_LIBRARY_ITEMS,
  type RemoteLibraryItem,
} from './library/library';
export {
  HISTORY_LIMIT,
  historyView,
  type LibraryKind,
  libraryPreview,
  type LibrarySort,
  libraryView,
} from './library/views';
export { createLimiter, type Limiter } from './limiter';
export { createPersisted, type Persisted, type PersistedOptions } from './persisted';
export {
  type CachePolicy,
  createQueryCache,
  policyFromHints,
  type Query,
  type QueryCache,
  type QueryResult,
  type QueryState,
  type QueryStatus,
} from './query';
export { type BandwidthMemory, createBandwidthMemory } from './playback/bandwidth';
export {
  CONTINUE_LIMIT,
  type ContinueItem,
  continueItem,
  continueWatching,
  createPlayedVideos,
  playedCard,
  type PlayedVideo,
  type PlayedVideos,
} from './playback/continue';
export { findBingeStream, nextVideo } from './playback/next';
export {
  createProgressStore,
  MIN_RESUME_SECONDS,
  type ProgressEntry,
  type ProgressStore,
  type ProgressUpdate,
  WATCHED_FRACTION,
} from './playback/progress';
export { createSourceMemory, type SourceMemory } from './playback/sources';
export { createProgressTracker, type ProgressTracker } from './playback/tracker';
export {
  createTrackMemory,
  MAX_TRACK_TITLES,
  type TrackChoice,
  type TrackMemory,
} from './playback/tracks';
export { createWatchedSet, MAX_WATCHED, type WatchedSet } from './playback/watched';
export {
  buildKidsBoard,
  kidsDiscoverSources,
  kidsSearchSources,
  KIDS_GENRE,
  KIDS_TYPES,
  kidsAddons,
  kidsTitleAllowed,
  ratingAllowed,
  ukRating,
} from './profiles/kids';
export {
  checkPin,
  cleanName,
  createPinGuard,
  defaultProfiles,
  isPinFormat,
  KIDS_RATINGS,
  type KidsRating,
  MAIN_PROFILE_ID,
  makePin,
  MAX_NAME_LENGTH,
  MAX_PROFILES,
  newProfileId,
  PIN_LENGTH,
  PIN_LOCK_MS,
  PIN_TRIES,
  type PinGuard,
  type Profile,
  PROFILE_COLOURS,
  profileKeyPrefix,
  type ProfilesState,
  readProfiles,
  type StoredPin,
} from './profiles/profiles';
export { profileKeyValueStore } from './profiles/scoped';
export { sha256 } from './profiles/sha256';
export { createRecentList, type RecentList } from './recent';
export {
  type CacheRecord,
  type CacheStore,
  type KeyValueStore,
  memoryCacheStore,
  memoryKeyValueStore,
} from './storage';
export { createStore } from './store';
export { assessStream, SEVERE_WARNINGS } from './streams/assess';
export { DEFAULT_MAX_BITRATE, estimateBitrate, isLighter, parseRuntime } from './streams/bitrate';
export { describeStream } from './streams/facts';
export { orderStreams, playableCandidates, qualityChoices } from './streams/order';
export type {
  AudioFormat,
  Channels,
  Container,
  HdrFormat,
  OrderOptions,
  QualityChoice,
  ReleaseSource,
  Resolution,
  StreamAction,
  StreamAssessment,
  StreamEntry,
  StreamFacts,
  StreamOrder,
  StreamWarning,
  TvCapabilities,
  VideoCodec,
} from './streams/types';
export { createCueIndex, type CueIndex } from './subtitles/cues';
export { detectEncoding } from './subtitles/encoding';
export {
  groupByLanguage,
  type LanguageGroup,
  languageKey,
  languageName,
} from './subtitles/languages';
export { detectSubtitleFormat, parseCueMarkup, parseSubtitleText } from './subtitles/parse';
export type { Cue, CueLine, CueSpan, SubtitleFormat } from './subtitles/types';
export type { Listener, Store, Updater } from './store';
