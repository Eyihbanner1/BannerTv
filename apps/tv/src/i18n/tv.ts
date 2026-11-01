import i18next from 'i18next';

/**
 * The native TV app's own words. Most strings are the LG app's (apps/webos/src/i18n/en.json);
 * these add what only this app shows.
 */
const TV = {
  nav: {
    home: 'Home',
    search: 'Search',
    discover: 'Discover',
    sports: 'Sports',
    myList: 'My List',
    settings: 'Settings',
    profile: 'Switch profile, now {{name}}',
  },
  play: 'Play',
  episodes: 'Episodes',
  resume: 'Resume',
  myList: 'My List',
  onMyList: 'On My List',
  continueEyebrow: 'Continue watching',
  findingStream: 'Finding the best stream',
  more: 'More',
  sources: 'Streams',
  quality: 'Quality',
  leave: 'Leave the player',
  upNext: 'Up next',
  nextEpisode: 'Next episode',
  myListEmpty: 'Nothing on My List yet',
  myListEmptyLead: 'Press My List on any title to keep it here.',
  soonTitle: '{{section}} is coming to this app',
  soonLead:
    'This native test build has Home, Details, the player and Settings. {{section}} works in the BannerTV app beside it for now.',
  settings: {
    title: 'Settings',
    profiles: 'Profiles',
    account: 'Account and sync',
    addons: 'Addons',
    playback: 'Playback',
    subtitles: 'Subtitles',
    trakt: 'Trakt',
    homeRows: 'Home rows',
    parental: 'Parental controls',
    about: 'About and help',
    switchProfile: 'Switch profile',
    elsewhere:
      'Change this in the BannerTV app or on your phone for now: this test build reads it, and the change reaches it through sync.',
    addonCount_one: '{{count}} addon is installed.',
    addonCount_other: '{{count}} addons are installed.',
    syncOn: 'Sync is on for this TV.',
    syncOff: 'Sync is off for this TV.',
    traktOn: 'Signed in to Trakt.',
    traktOff: 'Not signed in to Trakt.',
    build: 'Build',
    device: 'Device',
    testBuild:
      'A test build of the native TV app. It installs beside BannerTV and never replaces it.',
  },
  stillWatching: 'Still watching?',
  stillWatchingLead: 'The next episode is ready.',
  stop: 'Stop',
  subtitleStyle: 'Subtitle style',
} as const;

/** Adds the TV app's words to the LG app's, after `initI18n()`. */
export function addTvStrings(): void {
  i18next.addResourceBundle('en', 'translation', { tv: TV }, true, true);
}
