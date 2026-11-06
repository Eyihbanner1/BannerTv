import i18next from 'i18next';

/**
 * The phone's own words. Most strings are the TV's (apps/webos/src/i18n/en.json, read as it is);
 * these add what only a phone has, and reword the TV lines that speak of a remote or a TV.
 */
const PHONE = {
  tabs: {
    home: 'Home',
    search: 'Search',
    sports: 'Sports',
    library: 'My List',
    settings: 'Settings',
  },
  play: 'Play',
  findingStream: 'Finding the best stream',
  opening: 'Opening {{title}}',
  seasonPicker: 'Choose a season',
  more: 'More',
  less: 'Less',
  audioAndSubtitles: 'Audio and subtitles',
  audio: 'Audio',
  subtitles: 'Subtitles',
  subtitlesOff: 'Off',
  sources: 'Streams',
  nextEpisode: 'Next episode',
  nextIn: 'Next episode in {{seconds}}',
  playNow: 'Play now',
  keepWatching: 'Keep watching',
  stillWatching: 'Still watching?',
  stillWatchingLead: 'The next episode is ready when you are.',
  stop: 'Stop',
  back10: 'Back 10 seconds',
  forward10: 'Forward 10 seconds',
  playLabel: 'Play',
  pauseLabel: 'Pause',
  leavePlayer: 'Leave the player',
  live: 'LIVE',
  embeddedSubtitles: 'In the video',
  fromAddon: 'From {{addon}}',
  history: 'History',
  emptyList: 'Nothing saved yet. Tap My List on a title to keep it here.',
  searchHint: 'Type the name of a film or series.',
  profile: 'Profile',
  switchProfile: 'Switch profile',
  switch: 'Switch',
  libraryAndAccounts: 'Library and accounts',
  addonsCount: '{{count}} installed',
  moreOptions: 'More options',
  whoIsWatching: "Who's watching?",
  pinFor: 'Enter the PIN for {{name}}',
  addons: 'Addons',
  addonsLead: 'Addons are shared by every profile on this phone.',
  addAddon: 'Add an addon',
  addonUrl: 'Addon link',
  addonUrlHint: 'Paste the link to an addon’s manifest.json',
  install: 'Install',
  paste: 'Paste',
  openSettingsAgain: 'Open the settings page again',
  installed: '{{name}} is added.',
  updated: '{{name}} is updated.',
  removeAddon: 'Remove',
  moveUp: 'Move up',
  moveDown: 'Move down',
  configure: 'Settings',
  configureLead:
    'The addon’s settings page opens in your browser. When it gives you a new link, paste it here.',
  account: 'BannerTV account',
  accountLead:
    'Your profiles, addons, My List and Continue Watching, the same on your phone and your TV.',
  accountJoinLead:
    'Type the account code from the TV, or from where you made the account. Capitals, spaces and dashes don’t matter.',
  accountCreateOnTv:
    'This first phone build can join an account but not make one. Make it on the TV, then join here with its code.',
  playback: 'Playback',
  stillWatchingSetting: 'Ask “Still watching?”',
  about: 'BannerTV for phones {{version}} (test build)',
  appName: 'BannerTV',
  continueRow: 'Continue watching',
  nothingToPlay: 'Nothing to play',
  welcomeLead: 'Films and series from the addons you choose, in one place.',
  welcomeJoinLead: 'Already use BannerTV on your TV? Join its account to bring your profiles here.',
  episodes: 'Episodes',
  upNext: 'Up next',
  close: 'Close',
  profilesCount_one: '{{count}} profile',
  profilesCount_other: '{{count}} profiles',
  askAtLaunch: 'Ask who’s watching when BannerTV opens',
} as const;

const OVERRIDES = {
  addonError: { network: '{{addon}} could not be reached. Check the phone is online.' },
  addons: {
    installError: {
      unreachable: 'BannerTV couldn’t reach that address. Check it, and that the phone is online.',
    },
  },
  search: { hint: PHONE.searchHint },
  profiles: {
    full: 'This phone already has six profiles.',
    deleteMessage:
      'Their Continue Watching, My List, history and settings are deleted from this phone. Anything synced to Trakt stays on Trakt.',
  },
  forgotPin: {
    resetTitle: 'Reset BannerTV on this phone?',
    resetMessage:
      'Without a BannerTV account, {{name}}’s PIN can only come off by starting again. Every profile, addon, My List, Continue Watching and setting on this phone is deleted, and BannerTV starts as new. What Trakt has stays on Trakt.',
    reset: 'Reset this phone',
  },
  // The phone has no subtitle style row yet (it comes with the phone's subtitle style work), so
  // a kids profile's Settings only says who can change them.
  settings: {
    kidsLead: 'Grown-ups can change the settings from their own profile.',
  },
  library: { emptyList: PHONE.emptyList },
  details: { trailerFailed: 'The trailer didn’t open.' },
  welcome: {
    lead: PHONE.welcomeLead,
    ready:
      'Cinemeta and BannerTV Demo are already added, so Home is ready to browse, with a few free films to play. You can add more addons at any time in Settings, Addons.',
  },
  player: {
    problem: {
      nothing:
        'None of your addons offered a stream this phone can play. Try Streams, or add a stream addon in Settings, Addons.',
      format: "This phone can't play this stream's format.",
      decode: "This phone couldn't decode this stream.",
    },
  },
} as const;

/** Adds the phone's words to the TV's, after the TV's `initI18n()`. */
export function addPhoneStrings(): void {
  i18next.addResourceBundle('en', 'translation', { phone: PHONE }, true, true);
  i18next.addResourceBundle('en', 'translation', OVERRIDES, true, true);
}
