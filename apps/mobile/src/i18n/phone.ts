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
  streamReady: 'Best stream ready',
  noStreamYet: 'No stream found yet. All streams has the full list.',
  opening: 'Opening {{title}}',
  seasonPicker: 'Choose a season',
  more: 'More',
  less: 'Less',
  audioAndSubtitles: 'Audio and subtitles',
  audio: 'Audio',
  subtitles: 'Subtitles',
  subtitlesOff: 'Off',
  styleFor: 'Size, colour, background and position of subtitles',
  subtitleStyle: 'Subtitle style',
  sources: 'Streams',
  nextEpisode: 'Next episode',
  nextIn: 'Next episode in {{seconds}}',
  playNow: 'Play now',
  keepWatching: 'Keep watching',
  watchCredits: 'Watch credits',
  stillWatching: 'Still watching?',
  stillWatchingLead: 'The next episode is ready when you are.',
  stop: 'Stop',
  back10: 'Back 10 seconds',
  forward10: 'Forward 10 seconds',
  seekingTo: 'Going to {{time}}',
  sceneIntro: 'Intro',
  sceneRecap: 'Recap',
  backTo: 'Back to {{time}}',
  backToLabel: 'Go back to {{time}}, where you were',
  playLabel: 'Play',
  pauseLabel: 'Pause',
  leavePlayer: 'Leave the player',
  live: 'LIVE',
  embeddedSubtitles: 'In the video',
  history: 'History',
  emptyList: 'Nothing saved yet. Tap My List on a title to keep it here.',
  searchHint: 'Type the name of a film or series.',
  profile: 'Profile',
  switchProfile: 'Switch profile',
  switch: 'Switch',
  libraryAndAccounts: 'Library and accounts',
  addonsCount: '{{count}} installed',
  moreOptions: 'More options',
  trakt: 'Trakt',
  traktSteps: 'Open the Trakt page, sign in there, and enter this code:',
  traktOpen: 'Copy code and open {{url}}',
  traktCopied:
    'The code is copied, so you can paste it. Come back here when Trakt says you’re done.',
  pictureInPicture: 'Picture-in-picture',
  whoIsWatching: "Who's watching?",
  pinFor: 'Enter the PIN for {{name}}',
  addons: 'Addons',
  addonsLead:
    'Addons give BannerTV its catalogs, titles, streams and subtitles, for every profile on this phone. Higher addons answer first, and their rows come first on Home.',
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
  accountMakeOrJoin: 'Make one, or join with a code',
  accountJoinLead:
    'Type the account code from the TV, or from where you made the account. Capitals, spaces and dashes don’t matter.',
  copyCode: 'Copy the code',
  codeCopied:
    'Copied. Keep it somewhere private as well as written down: anyone with the code can see everything in the account.',
  codeNotCopied: 'The code wasn’t copied. Write it down instead.',
  playback: 'Playback',
  stillWatchingSetting: 'Ask “Still watching?”',
  nextAtCreditsSetting: 'Start next episode at the credits',
  about: 'BannerTV for phones {{version}} (test build)',
  appName: 'BannerTV',
  continueRow: 'Continue watching',
  nothingToPlay: 'Nothing to play',
  welcomeLead: 'Films and series from the addons you choose, in one place.',
  welcomeJoinLead: 'Already use BannerTV on your TV? Join its account to bring your profiles here.',
  episodes: 'Episodes',
  upNext: 'Up next',
  moreFrom: 'More {{genre}} from {{addon}}',
  close: 'Close',
  // Settings, Languages and picture (the TV's words where they fit a phone).
  picture: {
    any: 'As high as the phone shows',
    '2160p': '4K',
    '1080p': '1080p',
    '720p': '720p',
  },
  avoidHdr: 'Avoid HDR',
  learnLanguages: 'Use player choices for every title',
  yourTv: 'Your TV',
  streamHelperDetail: 'Your LG plays some add-on streams through this phone',
  streamHelperSwitch: 'Use the stream helper',
  streamHelperNotificationsOff:
    'Notifications are off for this app, so the helper’s notification and its Stop button won’t show. Turn the helper off here when you finish watching.',
  // Search: what only the phone's list needs.
  search: {
    /** The line that opens each addon's own results, under Top results. */
    eachAddon: 'Results from each addon',
  },
  profilesCount_one: '{{count}} profile',
  profilesCount_other: '{{count}} profiles',
  askAtLaunch: 'Ask who’s watching when BannerTV opens',
  addonLink: {
    confirm: 'Add {{name}}?',
    lead: 'This link came from another app. Addons are shared by every profile on this phone.',
  },
  reminders: {
    title: '{{name}} is starting',
    body: 'Starts at {{time}}. Tap to open the match.',
    channel: 'Match reminders',
    note: 'Your phone reminds you at {{time}}.',
    denied:
      'Notifications are off for BannerTV. Turn them on in your phone’s settings to get reminders.',
  },
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
  trakt: {
    failed: { network: 'BannerTV couldn’t reach Trakt. Check the phone is online and try again.' },
    signOutMessage:
      'BannerTV stops syncing with Trakt on this profile. My List and where you stopped stay on this phone.',
  },
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
      noStreamAddon: 'You have no addon that finds streams yet. Add one in Settings, Addons.',
      streamAddonsOff:
        'Your stream addons are all switched off. Switch one on in Settings, Addons, then try again.',
      someStreamAddonsOff:
        "Some of your stream addons are switched off, so they weren't asked. You can switch them on in Settings, Addons.",
      failedRecently_one:
        "The stream found didn't play a moment ago. Try again to give it another go, or open Streams.",
      failedRecently_other:
        "The {{count}} streams found didn't play a moment ago. Try again to give them another go, or open Streams.",
      uncached:
        "Only uncached links: your debrid service hasn't downloaded this title yet. Try again later, or pick a cached stream in Streams.",
    },
  },
} as const;

/** Adds the phone's words to the TV's, after the TV's `initI18n()`. */
export function addPhoneStrings(): void {
  i18next.addResourceBundle('en', 'translation', { phone: PHONE }, true, true);
  i18next.addResourceBundle('en', 'translation', OVERRIDES, true, true);
}
