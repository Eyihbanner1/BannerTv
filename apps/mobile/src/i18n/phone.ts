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
  // The player's More: what the sleep timer has left, and what speed the next stream plays at.
  sleepLeft_one: '{{count}} min left',
  sleepLeft_other: '{{count}} min left',
  speedNote: 'Another stream, or the next episode, starts at Normal.',
  zoomToFill: 'Zoom to fill',
  zoomedToFill: 'Zoomed to fill',
  fitToScreen: 'Fit to screen',
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
  about: 'BannerTV for phones {{version}} (test build)',
  // Over-the-air updates (runtime/app-updates.ts), in Settings for grown-ups.
  thisApp: 'This app',
  appVersion: 'App version',
  appVersionBuiltIn: 'Built in',
  appVersionUpdate: 'Update {{id}}',
  appVersionBuiltInDetail: 'Version {{version}}, as it was installed',
  appVersionUpdateDetail: 'Version {{version}}, updated {{published}}',
  appVersionUpdateUndated: 'Version {{version}}, updated since it was installed',
  appVersionNoUpdates: 'Version {{version}}. This build doesn’t take updates.',
  checkForUpdates: 'Check for updates',
  updateChecking: 'Checking…',
  updateDownloading: 'Downloading…',
  updateNone: 'Up to date',
  updateFailed: 'Couldn’t check',
  updateReady: 'Ready',
  updateReadyTitle: 'Update ready',
  updateReadyMessage:
    'BannerTV starts again to use it. If you wait, it starts the next time you leave the app from Home or Settings.',
  updateLater: 'Later',
  restartNow: 'Restart now',
  appName: 'BannerTV',
  continueRow: 'Continue watching',
  // Beside Continue watching on Home: when the account last brought other screens' changes.
  synced: {
    justNow: 'Synced just now',
    minutes_one: 'Synced 1 min ago',
    minutes_other: 'Synced {{count}} min ago',
    hours_one: 'Synced 1 hour ago',
    hours_other: 'Synced {{count}} hours ago',
    days_one: 'Synced 1 day ago',
    days_other: 'Synced {{count}} days ago',
  },
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
  // Stream helper: send this phone's helper to the LG (data/helper-pairing.ts).
  helperPair: {
    title: 'Pair with your TV',
    lead: 'On your LG, open Settings > Stream helper. Type the code it shows under Pair from your phone.',
    tvCode: 'Code on the TV',
    placeholder: 'For example K7M 2QX',
    send: 'Pair',
    sent: 'Sent. Your TV pairs in a few seconds.',
    badCode: 'That isn’t the TV’s code. It has six letters and numbers.',
    gone: 'That code has run out. On the TV, choose New code and type the new one here.',
    used: 'That code was already used. On the TV, choose New code.',
    offline:
      'Couldn’t reach BannerTV’s pairing service. Check this phone’s internet and try again.',
    orType: 'Or type this on the TV',
  },
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
  // New-episode alerts (data/episode-alerts.ts) and their switch in Settings.
  episodeAlerts: {
    section: 'Notifications',
    setting: 'New episode alerts',
    lead: 'A notification at 18:00 on the day a new episode comes out, for series you watch and series on My List.',
    denied:
      'Notifications are off for BannerTV. Turn them on in your phone’s settings to get alerts.',
    channel: 'New episodes',
    one: 'New episode: {{show}} S{{season}}:E{{episode}} is out',
    oneUnnumbered: 'New episode: {{show}} is out',
    run: 'New episodes: {{show}} S{{season}}:E{{first}}–{{last}} are out',
    some: '{{count}} new episodes of {{show}} are out',
    body: 'Tap to open the series.',
    bodyNamed: '“{{title}}”. Tap to open the series.',
  },
  reminders: {
    title: '{{name}} is starting',
    body: 'Starts at {{time}}. Tap to open the match.',
    channel: 'Match reminders',
    note: 'Your phone reminds you at {{time}}.',
    denied:
      'Notifications are off for BannerTV. Turn them on in your phone’s settings to get reminders.',
  },
  // When a screen fails to draw (screens/CrashScreen.tsx), and Settings' Send a report.
  crash: {
    title: 'Something went wrong',
    lead: 'BannerTV ran into a problem it couldn’t get past. Starting again usually sorts it, and keeps the same profile.',
    startAgain: 'Start again',
  },
  sendReport: 'Send a report',
  sendReportDetail:
    'Shares a short note of recent problems. Addon links, keys and codes are left out.',
  reportTitle: 'BannerTV phone report',
  reportNotShared: 'The report couldn’t be shared.',
  reportNotSharedShort: 'Couldn’t share',
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
    sleep: { offNote: 'Off: the phone plays on.' },
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
