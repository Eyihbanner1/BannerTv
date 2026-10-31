import type { Stream } from '@bannertv/protocol';
import { releaseGroup } from './release';
import type {
  AudioFormat,
  Channels,
  Container,
  HdrFormat,
  ReleaseSource,
  Resolution,
  StreamFacts,
  VideoCodec,
} from './types';

// This runs for every stream of every addon on a slow TV CPU, so every
// pattern is compiled once here and most tokens are read in a single pass
// over the lower-cased text.

/** Best first: the order StreamFacts lists them in. */
const HDR_ORDER: readonly HdrFormat[] = ['DV', 'HDR10+', 'HDR10', 'HDR', 'HLG'];
const AUDIO_ORDER: readonly AudioFormat[] = [
  'Atmos',
  'TrueHD',
  'DTS:X',
  'DTS-HD MA',
  'DTS-HD',
  'DTS',
  'DD+',
  'DD',
  'AAC',
  'FLAC',
  'Opus',
  'MP3',
  'PCM',
];
const DTS_FORMATS: readonly AudioFormat[] = ['DTS:X', 'DTS-HD MA', 'DTS-HD', 'DTS'];
const GENERIC_HDR = 1 << HDR_ORDER.indexOf('HDR');
const NAMED_HDR10 = (1 << HDR_ORDER.indexOf('HDR10')) | (1 << HDR_ORDER.indexOf('HDR10+'));

/** What has been read so far, before it is put in order. */
interface Draft {
  hdr: number;
  audio: number;
  mainAudio?: AudioFormat;
  videoCodec?: VideoCodec;
  bitDepth?: 8 | 10 | 12;
  /** From "stereo", "6ch" and the like, used when no "5.1" style number is given. */
  channelWord?: Channels;
  /** The first release source named. */
  source?: ReleaseSource;
  remux: boolean;
  /** The worst cinema recording named: it decides, whatever else the text says. */
  cinema?: ReleaseSource;
  multi: boolean;
  /** Named a sample, trailer, teaser or featurette. */
  sample: boolean;
  languages: string[];
  /** Where the description starts in the text: the file name and link before it have lost their extensions. */
  descriptionFrom: number;
}

type Apply = (draft: Draft, text: string, start: number, end: number) => void;

interface Rule {
  /** A regex source without capturing groups. */
  pattern: string;
  apply: Apply;
  /** Audio names are often glued to their channels, as in "DDP5.1" or "AAC2.0". */
  digitsMayFollow?: boolean;
  /** Also an everyday word, so it does not count in a title: "Cam (2018)", "The Italian Job". */
  titleWord?: boolean;
  /**
   * Counts only after the title, in brackets, or as the whole line: a title
   * may be nothing but the word's line ("Trailer Park Boys").
   */
  afterTitle?: boolean;
  /**
   * A clip's word: not in an episode's own title ("Show.S03E05.The.Trailer.1080p").
   * 'tagged' only where a tag ends that title: a file named "Show.S03E05.Sample.mkv"
   * is a sample.
   */
  clip?: 'title' | 'tagged';
}

function hdr(format: HdrFormat): Apply {
  const bit = 1 << HDR_ORDER.indexOf(format);
  return (draft) => {
    draft.hdr |= bit;
  };
}

function audio(format: AudioFormat): Apply {
  const bit = 1 << AUDIO_ORDER.indexOf(format);
  return (draft) => {
    draft.audio |= bit;
    // Atmos rides on TrueHD or DD+, so it says nothing about which codec the track is.
    if (draft.mainAudio === undefined && format !== 'Atmos') draft.mainAudio = format;
  };
}

function codec(name: VideoCodec): Apply {
  return (draft) => {
    if (draft.videoCodec === undefined) draft.videoCodec = name;
  };
}

function bitDepth(depth: 8 | 10 | 12): Apply {
  return (draft) => {
    if (draft.bitDepth === undefined) draft.bitDepth = depth;
  };
}

function channelWord(channels: Channels): Apply {
  return (draft) => {
    if (draft.channelWord === undefined) draft.channelWord = channels;
  };
}

const CINEMA_ORDER: readonly ReleaseSource[] = ['CAM', 'TS', 'TC', 'SCR'];

function source(name: ReleaseSource): Apply {
  const cinemaRank = CINEMA_ORDER.indexOf(name);
  return (draft) => {
    if (name === 'REMUX') draft.remux = true;
    if (cinemaRank >= 0) {
      if (draft.cinema === undefined || CINEMA_ORDER.indexOf(draft.cinema) > cinemaRank) {
        draft.cinema = name;
      }
    } else if (draft.source === undefined) {
      draft.source = name;
    }
  };
}

function language(code: string): Apply {
  return (draft) => {
    if (draft.languages.indexOf(code) < 0) draft.languages.push(code);
  };
}

const ignore: Apply = () => undefined;

/** A "ts" after a dot and before a space or the end is a file extension (MPEG-TS), not a telesync. */
const AFTER_EXTENSION = /^(?:$|[\s?#&)\]"'])/;

const telesync = source('TS');
const ddPlus = audio('DD+');
const atmos = audio('Atmos');

const RULES: readonly Rule[] = [
  // HDR. "HDRip" and "HDRezka" are not HDR: the trailing boundary rules them out.
  { pattern: 'dolby[ ._-]?vision|dovi|dv', apply: hdr('DV') },
  { pattern: 'hdr10(?:\\+|[ ._-]?plus)', apply: hdr('HDR10+') },
  { pattern: 'hdr10', apply: hdr('HDR10') },
  { pattern: 'hdr', apply: hdr('HDR') },
  { pattern: 'hlg', apply: hdr('HLG') },

  // Video.
  { pattern: '[xh][ .]?265|hevc', apply: codec('HEVC') },
  { pattern: '[xh][ .]?264|avc', apply: codec('H.264') },
  { pattern: 'av1', apply: codec('AV1') },
  { pattern: 'vp9', apply: codec('VP9') },
  { pattern: 'xvid|divx', apply: codec('XviD') },
  { pattern: 'vc[ -]?1', apply: codec('VC-1') },
  { pattern: 'mpeg[ -]?2', apply: codec('MPEG-2') },
  // Container names, read here only so their "ts" is not taken for a telesync.
  { pattern: 'mpeg[ -]?ts|m2ts', apply: ignore },
  { pattern: '8[ ._-]?bits?', apply: bitDepth(8) },
  { pattern: '10[ ._-]?bits?|hi10p?|main[ ._-]?10', apply: bitDepth(10) },
  { pattern: '12[ ._-]?bits?', apply: bitDepth(12) },

  // Audio, longest names first so "DTS-HD MA" is not read as "DTS".
  { pattern: 'dts[ ._-]?hd[ ._-]?ma|dts[ ._-]?ma|dts[ ._-]?lossless', apply: audio('DTS-HD MA') },
  { pattern: 'dts[ ._-]?hd(?:[ ._-]?hra?)?', apply: audio('DTS-HD') },
  // Strict boundary, so "DTS x264" stays DTS.
  { pattern: 'dts[ ._:-]?x', apply: audio('DTS:X') },
  { pattern: 'dts[ ._-]?(?:es|lossy|hr)', apply: audio('DTS') },
  { pattern: 'dolby[ ._-]?true[ ._-]?hd|true[ ._-]hd', apply: audio('TrueHD') },
  { pattern: 'dolby[ ._-]?atmos', apply: atmos },
  {
    pattern: 'dolby[ ._-]?digital[ ._-]?plus|dd[ ._-]?plus|e[ ._-]?ac[ ._-]?3',
    apply: ddPlus,
  },
  { pattern: 'dolby[ ._-]?digital|ac[ ._-]?3', apply: audio('DD') },
  { pattern: 'he[ ._-]?aac|aac[ ._-]?lc', apply: audio('AAC') },
  { pattern: 'mp3', apply: audio('MP3') },
  { pattern: 'stereo|2ch', apply: channelWord('2.0'), titleWord: true },
  { pattern: 'mono|1ch', apply: channelWord('1.0'), titleWord: true },
  { pattern: '6ch', apply: channelWord('5.1') },
  { pattern: '8ch', apply: channelWord('7.1') },
  {
    // DD+ with Atmos, as in "DDPA5.1".
    pattern: 'ddpa',
    apply: (draft, text, start, end) => {
      ddPlus(draft, text, start, end);
      atmos(draft, text, start, end);
    },
    digitsMayFollow: true,
  },
  { pattern: 'ddp|dd\\+', apply: ddPlus, digitsMayFollow: true },
  { pattern: 'dd', apply: audio('DD'), digitsMayFollow: true },
  { pattern: 'aac', apply: audio('AAC'), digitsMayFollow: true },
  { pattern: 'truehd', apply: audio('TrueHD'), digitsMayFollow: true },
  { pattern: 'atmos', apply: atmos, digitsMayFollow: true },
  { pattern: 'dts', apply: audio('DTS'), digitsMayFollow: true },
  { pattern: 'flac', apply: audio('FLAC'), digitsMayFollow: true },
  { pattern: 'opus', apply: audio('Opus'), digitsMayFollow: true, titleWord: true },
  { pattern: 'l?pcm', apply: audio('PCM'), digitsMayFollow: true },

  // Release source. Screeners first, so "WEBSCR" is not read as WEB.
  { pattern: '(?:dvd|b[dr]|web)[ ._-]?scr|screener|scr', apply: source('SCR') },
  { pattern: 'b[dr][ ._-]?remux|remux', apply: source('REMUX') },
  {
    pattern: 'blu[ ._-]?ray|b[dr][ ._-]?rip|bdmv|bd(?:25|50|66|100)',
    apply: source('BluRay'),
  },
  { pattern: 'web[ ._-]?dl', apply: source('WEB-DL') },
  { pattern: 'web[ ._-]?rip', apply: source('WEBRip') },
  { pattern: 'web', apply: source('WEB-DL'), titleWord: true },
  { pattern: '[hps]dtv(?:rip)?', apply: source('HDTV') },
  { pattern: 'dvd(?:[ ._-]?rip|[59]|r)?', apply: source('DVD') },
  { pattern: 'hd[ ._-]?tc|telecine|tc', apply: source('TC') },
  { pattern: '(?:hd[ ._-]?)?ts[ ._-]?rip|hd[ ._-]?ts|tele[ ._-]?sync', apply: telesync },
  {
    pattern: 'ts',
    apply: (draft, text, start, end) => {
      if (
        start >= draft.descriptionFrom &&
        text.charAt(start - 1) === '.' &&
        AFTER_EXTENSION.test(text.charAt(end))
      ) {
        return;
      }
      telesync(draft, text, start, end);
    },
  },
  { pattern: '(?:hd|hq)[ ._-]?cam(?:[ ._-]?rip)?|cam[ ._-]?rip', apply: source('CAM') },
  { pattern: 'cam', apply: source('CAM'), titleWord: true },

  // "Multi Subs" is about subtitles; "Multi", "MULTi", "Dual Audio" are about sound.
  { pattern: '(?:multi|dual)[ ._-]?subs?', apply: ignore },
  {
    pattern: 'multi(?:[ ._-]?(?:audio|lang(?:uage)?)s?)?|dual(?:[ ._-]?audio)?',
    apply: (draft) => {
      draft.multi = true;
    },
    titleWord: true,
  },
  // A short clip, not the video. "Trailer.Park.Boys.S01E01" is a title.
  {
    pattern: 'sample',
    apply: (draft) => {
      draft.sample = true;
    },
    titleWord: true,
    clip: 'tagged',
  },
  {
    pattern: 'trailer|teaser|featurette',
    apply: (draft) => {
      draft.sample = true;
    },
    afterTitle: true,
    clip: 'title',
  },
  // Language names and the three-letter tags release names use. Tags that are
  // also common words ("por", "fin", "dan", "vie") are left out.
  ...(
    [
      ['en', 'english|eng|ingl[eé]s|anglais'],
      ['fr', 'french|fran[cç]ais|fre|fra|vff?|vfq|truefrench'],
      ['es', 'spanish|espa[nñ]ol|castellano|latino|spa|esp'],
      ['de', 'german|deutsch|ger|deu'],
      ['it', 'italian|italiano|ita'],
      ['pt', 'portuguese|portugu[eê]s|dublado|pt[ ._-]?br'],
      ['ru', 'russian|rus'],
      ['hi', 'hindi|hin'],
      ['ja', 'japanese|jpn|jap'],
      ['ko', 'korean|kor'],
      ['zh', 'chinese|mandarin|cantonese'],
      ['ar', 'arabic|ara'],
      ['tr', 'turkish|tur'],
      ['pl', 'polish|polski|pol'],
      ['nl', 'dutch|flemish|nld|dut'],
      ['sv', 'swedish|swe'],
      ['no', 'norwegian'],
      ['da', 'danish'],
      ['fi', 'finnish'],
      ['cs', 'czech|cze'],
      ['sk', 'slovak'],
      ['hu', 'hungarian|magyar|hun'],
      ['el', 'greek|gre'],
      ['he', 'hebrew|heb'],
      ['th', 'thai'],
      ['vi', 'vietnamese'],
      ['id', 'indonesian'],
      ['ms', 'malay'],
      ['uk', 'ukrainian|ukr'],
      ['ro', 'romanian'],
      ['bg', 'bulgarian'],
      ['hr', 'croatian|hrv'],
      ['sr', 'serbian|srp'],
      ['ta', 'tamil'],
      ['te', 'telugu'],
      ['ml', 'malayalam'],
      ['kn', 'kannada'],
      ['bn', 'bengali'],
      ['fa', 'persian|farsi'],
      ['ur', 'urdu'],
    ] as const
  ).map(([code, words]): Rule => ({ pattern: words, apply: language(code), titleWord: true })),
];

/**
 * Every rule in one pattern. Each rule is one capturing group, so the group
 * that matched says which rule to apply. The leading boundary treats "_" as a
 * separator, unlike \b.
 */
const WORDS = new RegExp(
  '(?:^|[^a-z0-9])(?:' +
    RULES.map(
      (rule) => `(${rule.pattern})${rule.digitsMayFollow ? '(?![a-z])' : '(?![a-z0-9])'}`,
    ).join('|') +
    ')',
  'g',
);

/** A year or season number ends the title in a release name. */
const TITLE_END = /(?:^|[^a-z0-9])(?:(?:19|20)\d\d|s\d\d?(?:e\d{1,3})?)(?![a-z0-9])/;
/**
 * A season and episode, or several ("S01E01E02", "S01E01-E02"): the words
 * after it, up to the first tag, can be the episode's own title.
 */
const EPISODE = /(?:^|[^a-z0-9])s\d\d?e\d{1,3}(?:-?e\d{1,3})*(?![a-z0-9])/;
/** Where an episode's title ends: its resolution, or a source or codec the rules above read. */
const TECH_TAG =
  /(?:^|[^a-z0-9])(?:\d{3,4}[pi]|4k|uhd|remux|blu[ ._-]?ray|b[dr][ ._-]?rip|web(?:[ ._-]?(?:dl|rip))?|[hps]dtv(?:rip)?|hd[ ._-]?rip|dsr(?:ip)?|dvd(?:[ ._-]?rip|[59]|r)?|[xh][ ._]?26[45]|hevc|avc|av1|xvid|divx)(?![a-z0-9])/;

/** The line last looked at, so a long line from a careless addon is searched once, not once per word. */
interface TitleLine {
  start: number;
  end: number;
  /** Where its title ends; -1 when it names no year or season, so nothing on it is a title. */
  titleEnd: number;
  /**
   * Where an episode's own title starts and ends, after its season and
   * episode and before the first tag; both -1 when there is none.
   */
  episodeStart: number;
  episodeEnd: number;
  /** Whether a tag ends the episode's title, rather than the end of a file's name. */
  episodeTagged: boolean;
  /** Where the file name and the link's file name end, and the description starts. */
  filesEnd: number;
}

function titleLine(filesEnd = 0): TitleLine {
  return {
    start: 0,
    end: -1,
    titleEnd: -1,
    episodeStart: -1,
    episodeEnd: -1,
    episodeTagged: false,
    filesEnd,
  };
}

/** Finds the line around `start` to `end`, and where its titles are, unless it is the line already read. */
function readLine(text: string, start: number, end: number, line: TitleLine): void {
  if (start >= line.start && end <= line.end) return;
  line.start = text.lastIndexOf('\n', start) + 1;
  const lineEnd = text.indexOf('\n', end);
  line.end = lineEnd < 0 ? text.length : lineEnd;
  const words = text.slice(line.start, line.end);
  const anchor = TITLE_END.exec(words);
  line.titleEnd = anchor ? line.start + anchor.index : -1;
  line.episodeStart = line.episodeEnd = -1;
  line.episodeTagged = false;
  const episode = EPISODE.exec(words);
  if (!episode) return;
  const from = episode.index + episode[0].length;
  const tag = TECH_TAG.exec(words.slice(from));
  // With no tag after it, only a file's own name says its title runs to the
  // end: "Show - S03E05 - The Trailer.mkv". A release name may end in a tag
  // nothing here reads.
  const fileName = line.start < line.filesEnd || VIDEO_EXTENSION.test(words.trim());
  if (!tag && !fileName) return;
  line.episodeStart = line.start + from;
  line.episodeEnd = tag ? line.start + from + tag.index : line.end;
  line.episodeTagged = tag !== null;
}

/**
 * True for a word on a release-name line before its year or season, where
 * "Cam (2018)", "Charlotte's Web" and "The Italian Job" are the film's title.
 * A word in brackets is a tag, as in "[CAM] Film 2025", so it still counts.
 */
function inTitle(text: string, start: number, end: number, line: TitleLine): boolean {
  const before = text.charAt(start - 1);
  if (before === '[' || before === '(') return false;
  readLine(text, start, end, line);
  return line.titleEnd >= end;
}

/**
 * True for a word in an episode's own title, as "Trailer" in
 * "Show.S03E05.The.Trailer.1080p". Not in brackets. With `tagged`, in a title
 * no tag ends only alongside other words: "S01E04 - Free Sample.mkv" is an
 * episode, "S03E05.Sample.mkv" its sample.
 */
function inEpisodeTitle(
  text: string,
  start: number,
  end: number,
  line: TitleLine,
  tagged: boolean,
): boolean {
  const before = text.charAt(start - 1);
  if (before === '[' || before === '(') return false;
  readLine(text, start, end, line);
  if (start < line.episodeStart || end > line.episodeEnd) return false;
  if (!tagged || line.episodeTagged) return true;
  const after = text.slice(end, line.episodeEnd).trim().replace(VIDEO_EXTENSION, '');
  return /[a-z0-9]/.test(text.slice(line.episodeStart, start) + after);
}

/** The line a clip's name alone makes: "Trailer", "Official Teaser". */
const CLIP_LINE = /^(?:official[ ._-]+)?(?:trailer|teaser|featurette)s?$/i;

/** After the line's title, in brackets, or the whole line. */
function afterTitle(text: string, start: number, end: number, line: TitleLine): boolean {
  const before = text.charAt(start - 1);
  if (before === '[' || before === '(') return true;
  // Finds the line and where its title ends.
  if (inTitle(text, start, end, line)) return false;
  if (line.titleEnd >= 0) return true;
  return CLIP_LINE.test(text.slice(line.start, line.end).trim());
}

/**
 * "1080p", "2160p60", "1920x1080", "4K", "UHD", "FHD", "Full HD", and the
 * "2K" AIOStreams templates write for 1440p; "HD" only counts when nothing
 * better is said.
 */
const RESOLUTION =
  /(?:^|[^a-z0-9])(?:(\d{3,4})[pi]|\d{3,4}x(\d{3,4})|(4k|2k|uhd|qhd|f(?:ull[ ._-]?)?hd|hd))(?![a-z])/g;
const RESOLUTION_BY_LINES: Readonly<Record<string, Resolution>> = {
  '2160': '2160p',
  '1440': '1440p',
  '1080': '1080p',
  '720': '720p',
  '576': '576p',
  '480': '480p',
  '360': '360p',
};
const RESOLUTION_BY_NAME: Readonly<Record<string, Resolution>> = {
  '4k': '2160p',
  uhd: '2160p',
  '2k': '1440p',
  qhd: '1440p',
  fhd: '1080p',
};
const AUDIO_HD = /(?:dts|true)[ ._-]?hd/;

/**
 * "5.1", "7.1", "2.0", "1.0", glued to an audio name ("DDP5.1") or with a
 * space where a release name lost its dots ("Atmos 7 1"). Sizes ("2.0 GB"),
 * speeds and parts of longer numbers ("x265.10bit", "15.1") are not channels.
 * Group 1 is the audio name the number is glued to.
 */
const CHANNELS =
  /(?:^|[^a-z0-9]|(ddp?|aac|ac3|dts|ma|hd|flac|opus|pcm|atmos))([1257])[. ]([01])(?![0-9])(?!\s?(?:[kmgt]i?b|%))/g;
const CHANNELS_BY_DIGITS: Readonly<Record<string, Channels>> = {
  '10': '1.0',
  '20': '2.0',
  '51': '5.1',
  '71': '7.1',
};

const SIZE_NUMBER = '(\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|\\d+(?:[.,]\\d+)?)\\s?';
const SIZE_UNIT = '([kmgt]i?b)(?![a-z])(?!\\/s)';
/** "💾 4.2 GB", "Size: 1,46 GB", "33.82 GiB"; never "3.1 MB/s". */
const SIZE = new RegExp('(?:^|[^a-z0-9.,])' + SIZE_NUMBER + SIZE_UNIT);
/**
 * A size after the addon's own mark is the file's, even when the release
 * name above it ends in the pack's "[120 GB]". Tamtaro writes the file and
 * pack with one unit: "◈ 3.1 / 22.4 GB".
 */
const MARKED_SIZE = new RegExp(
  '(?:💾|📦|◈|❖|size\\s?:)\\s*' + SIZE_NUMBER + '(?:\\/\\s?\\d+(?:[.,]\\d+)?\\s?)?' + SIZE_UNIT,
);
const IEC_UNIT = /\d\s?[kmgt]ib(?![a-z])/;
const UNIT_POWER: Readonly<Record<string, number>> = { k: 1, m: 2, g: 3, t: 4 };

/** "👤 12", "👤0", "👥310", "🌱 230", "⇄ 5", "Seeders: 77", "S: 12". */
const SEEDERS =
  /(?:👤|👥|🌱|⇄|(?:^|[^a-z0-9])(?:seeders?|seeds|s)\s?:)\s*(\d{1,3}(?:,\d{3})+|\d+)(?![\d.])/;

/** A flag emoji is two regional indicator letters, each a surrogate pair. */
const FLAG = /\ud83c([\udde6-\uddff])\ud83c([\udde6-\uddff])/g;
const FLAG_LANGUAGE: Readonly<Record<string, string>> = {
  gb: 'en',
  us: 'en',
  au: 'en',
  fr: 'fr',
  es: 'es',
  mx: 'es',
  ar: 'es',
  de: 'de',
  at: 'de',
  it: 'it',
  pt: 'pt',
  br: 'pt',
  ru: 'ru',
  // Torrentio shows Hindi, Tamil and Telugu all as India; Hindi is the likeliest.
  in: 'hi',
  jp: 'ja',
  kr: 'ko',
  cn: 'zh',
  tw: 'zh',
  hk: 'zh',
  sa: 'ar',
  ae: 'ar',
  eg: 'ar',
  tr: 'tr',
  pl: 'pl',
  nl: 'nl',
  se: 'sv',
  no: 'no',
  dk: 'da',
  fi: 'fi',
  cz: 'cs',
  sk: 'sk',
  hu: 'hu',
  gr: 'el',
  il: 'he',
  th: 'th',
  vn: 'vi',
  id: 'id',
  my: 'ms',
  ua: 'uk',
  ro: 'ro',
  bg: 'bg',
  hr: 'hr',
  rs: 'sr',
  si: 'sl',
  lt: 'lt',
  lv: 'lv',
  ee: 'et',
  ir: 'fa',
  pk: 'ur',
  bd: 'bn',
};

/**
 * Two-letter codes are too ambiguous to read anywhere ("IT", "DE"), so they
 * count only on a line an addon marks as languages: Orion's "👂EN FR",
 * "🗣 SK/CZ", "Languages: …". Subtitle lists ("📝 …") are removed first.
 */
const LANGUAGE_LINE = /(?:🗣|👂|🌐|🌎|🌍|languages?\s?:)([^\n]*)/g;
const LANGUAGE_CODE = /(?:^|[^a-z])([a-z]{2})(?![a-z])/g;
/**
 * Subtitle lists: "📝 …", TorBox's "| Subtitles: …" and AIOStreams'
 * "🇬🇧 Subs / 🇫🇷 …". Torrentio's "Multi Subs / 🇬🇧 …" is followed by the
 * audio languages, so group 1 keeps it.
 */
const SUBTITLE_LIST = /📝[^\n]*|subtitles?\s?:[^\n]*|(multi[ ._-]?)?subs\s?\/[^\n]*/g;
const CODE_LANGUAGE: Readonly<Record<string, string>> = {
  en: 'en',
  fr: 'fr',
  es: 'es',
  de: 'de',
  it: 'it',
  pt: 'pt',
  ru: 'ru',
  hi: 'hi',
  ja: 'ja',
  jp: 'ja',
  ko: 'ko',
  kr: 'ko',
  zh: 'zh',
  cn: 'zh',
  ar: 'ar',
  tr: 'tr',
  pl: 'pl',
  nl: 'nl',
  sv: 'sv',
  se: 'sv',
  no: 'no',
  da: 'da',
  dk: 'da',
  fi: 'fi',
  cs: 'cs',
  cz: 'cs',
  sk: 'sk',
  hu: 'hu',
  el: 'el',
  gr: 'el',
  he: 'he',
  th: 'th',
  vi: 'vi',
  uk: 'uk',
  ua: 'uk',
  ro: 'ro',
  bg: 'bg',
  hr: 'hr',
  sr: 'sr',
  sl: 'sl',
  ta: 'ta',
  te: 'te',
  fa: 'fa',
};

/**
 * Debrid services as addons name them. Torrentio's short names, StremThru's
 * store codes, MediaFusion's TRB for TorBox, and the services written out.
 */
const SERVICES: Readonly<Record<string, string>> = {
  rd: 'RD',
  realdebrid: 'RD',
  pm: 'PM',
  premiumize: 'PM',
  ad: 'AD',
  alldebrid: 'AD',
  dl: 'DL',
  debridlink: 'DL',
  ed: 'ED',
  easydebrid: 'ED',
  oc: 'OC',
  offcloud: 'OC',
  tb: 'TB',
  trb: 'TB',
  torbox: 'TB',
  putio: 'Putio',
  pio: 'Putio',
  hw: 'HW',
  highway: 'HW',
  pkp: 'PKP',
  pp: 'PKP',
  pikpak: 'PKP',
  // Easynews and Debrider only written out: "[EN]" and "[DR]" too often mean something else.
  easynews: 'EN',
  debrider: 'DR',
};

/** "[RD+]", "[RD download]", "[PM⚡]", "[ED ⚡]", "[TB]", "(Instant TB)", "[Offcloud]". */
const NAME_TAG = /[[(]([^[\]()\n]{1,30})[\])]/g;
/** Digits stay, so "[P2P]" is not read as PikPak's "PP". */
const TAG_SEPARATORS = /[^a-z0-9]/g;
const TAG_WORDS = /instant|download/g;
const TAG_UNCACHED = /download|⬇|⏳/;
/** MediaFusion's "🧲 RD ⚡️" and AIOStreams' "RD ⏳", without brackets. */
const NAME_SERVICE_MARK = /(?:^|[^a-z0-9])(rd|pm|ad|dl|ed|oc|tb|trb|hw)\s*(⚡|⏳|⬇)/;
const NAME_SERVICE_WORD =
  /(?:^|[^a-z0-9])(real[ -]?debrid|premiumize|all[ -]?debrid|debrid[ -]?link|easy[ -]?debrid|offcloud|torbox|put\.?io|pikpak|easynews)(?![a-z0-9])/;
const NAME_INSTANT = /(?:^|[^a-z0-9])instant(?![a-z])/;
/** Orion marks a cached link with a rocket before its name; elsewhere 🚀 is decoration. */
const ORION_CACHED = /🚀\s*orion/;
const NOT_READY = /not ready(?:\s*\(([a-z.]{2,12})\))?/;
/** AIOStreams' prism names the service after "⚡Ready" too, as in "⚡Ready (RD)". */
const READY_SERVICE = /(?:^|[^a-z])ready\s*\(([a-z.]{2,12})\)/;
const UNCACHED_WORD = /(?:^|[^a-z0-9])uncached(?![a-z])/;
/** ⏳ marks an uncached link, except in older MediaFusion's "P2P ⏳". */
const HOURGLASS = /(p2p\s*)?⏳/g;

const EXTENSION = /\.([a-z0-9]{2,4})$/;
const CONTAINERS: Readonly<Record<string, Container>> = {
  mkv: 'mkv',
  mp4: 'mp4',
  m4v: 'mp4',
  webm: 'webm',
  ts: 'ts',
  m2ts: 'ts',
  mts: 'ts',
  m3u8: 'm3u8',
  mpd: 'mpd',
  avi: 'avi',
  mov: 'mov',
};
const VIDEO_EXTENSION = /\.(?:mkv|mp4|m4v|webm|ts|m2ts|mts|m3u8|mpd|avi|mov|wmv|flv|mpg|mpeg)$/;

/** The last path segment of a link, decoded. Read for its tokens only; the link is never kept. */
function lastPathSegment(url: string): string {
  // The host ends at a "?" or "#" too, so "https://host?file=/Film.2160p.mkv" gives no tokens.
  const path = url.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i, '').replace(/[?#][\s\S]*$/, '');
  const segment = path.slice(path.lastIndexOf('/') + 1);
  if (segment.indexOf('%') < 0) return segment;
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function readResolution(text: string, allowHd: boolean): Resolution | undefined {
  let named: Resolution | undefined;
  let hd = false;
  RESOLUTION.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = RESOLUTION.exec(text)) !== null) {
    const lines = match[1] ?? match[2];
    if (lines !== undefined) {
      const resolution = RESOLUTION_BY_LINES[lines];
      // A stated number of lines beats "4K" or "UHD" in the same text.
      if (resolution) return resolution;
    } else if (match[3] === 'hd') {
      hd = true;
    } else if (named === undefined) {
      // "fhd", "full hd", "fullhd".
      named = RESOLUTION_BY_NAME[match[3]!.charAt(0) === 'f' ? 'fhd' : match[3]!];
    }
  }
  if (named) return named;
  return hd && allowHd && !AUDIO_HD.test(text) ? '720p' : undefined;
}

function readChannels(text: string): Channels | undefined {
  const line = titleLine();
  CHANNELS.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CHANNELS.exec(text)) !== null) {
    const end = match.index + match[0].length;
    const channels = CHANNELS_BY_DIGITS[match[2]! + match[3]!];
    if (channels) {
      // A number in a title, as in "Ghost.in.the.Shell.2.0.2008", is not a channel count.
      if (match[1] !== undefined || !inTitle(text, end - 3, end, line)) return channels;
    } else {
      // "2.1" and the like: try again from the second digit.
      CHANNELS.lastIndex = end - 1;
    }
  }
  return undefined;
}

function readSize(text: string): number | undefined {
  const match = MARKED_SIZE.exec(text) ?? SIZE.exec(text);
  if (!match) return undefined;
  const number = match[1]!;
  const value = Number(
    /^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(number)
      ? number.replace(/,/g, '')
      : number.replace(',', '.'),
  );
  const unit = match[2]!;
  // Most addons divide by 1024 and still write "GB". Only when the same text
  // also writes "GiB" does a plain "GB" mean a thousand million.
  const base = unit.length === 2 && IEC_UNIT.test(text) ? 1000 : 1024;
  const bytes = Math.round(value * Math.pow(base, UNIT_POWER[unit.charAt(0)]!));
  return bytes > 0 && isFinite(bytes) ? bytes : undefined;
}

function readSeeders(text: string): number | undefined {
  const match = SEEDERS.exec(text);
  return match ? Number(match[1]!.replace(/,/g, '')) : undefined;
}

function readLanguages(text: string, into: string[]): void {
  if (text.indexOf('\ud83c') >= 0) {
    FLAG.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = FLAG.exec(text)) !== null) {
      const country =
        String.fromCharCode(0x61 + match[1]!.charCodeAt(0) - 0xdde6) +
        String.fromCharCode(0x61 + match[2]!.charCodeAt(0) - 0xdde6);
      const code = FLAG_LANGUAGE[country];
      if (code && into.indexOf(code) < 0) into.push(code);
    }
  }
  LANGUAGE_LINE.lastIndex = 0;
  let line: RegExpExecArray | null;
  while ((line = LANGUAGE_LINE.exec(text)) !== null) {
    LANGUAGE_CODE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = LANGUAGE_CODE.exec(line[1]!)) !== null) {
      const code = CODE_LANGUAGE[match[1]!];
      if (code && into.indexOf(code) < 0) into.push(code);
    }
  }
}

interface CacheState {
  cached?: boolean;
  service?: string;
}

/** Debrid cache state and service, from the markers addons put in the name (and a few in the description). */
function readCache(name: string, description: string): CacheState {
  let service: string | undefined;
  let cachedMark = false;
  let uncachedMark = false;
  let bareTag = false;

  NAME_TAG.lastIndex = 0;
  let tag: RegExpExecArray | null;
  while ((tag = NAME_TAG.exec(name)) !== null) {
    const inner = tag[1]!;
    const instant = NAME_INSTANT.test(inner);
    const code = SERVICES[inner.replace(TAG_WORDS, '').replace(TAG_SEPARATORS, '')];
    if (code === undefined) continue;
    if (service === undefined) service = code;
    if (instant || inner.indexOf('+') >= 0 || inner.indexOf('⚡') >= 0) cachedMark = true;
    else if (TAG_UNCACHED.test(inner)) uncachedMark = true;
    // Jackettio and StremThru mark an uncached link only by leaving the marker out.
    else bareTag = true;
  }
  if (service === undefined) {
    const mark = NAME_SERVICE_MARK.exec(name);
    if (mark) service = SERVICES[mark[1]!];
  }
  if (service === undefined) {
    const word = NAME_SERVICE_WORD.exec(name);
    if (word) service = SERVICES[word[1]!.replace(TAG_SEPARATORS, '')];
  }

  const text = name + '\n' + description;
  const notReady = NOT_READY.exec(text);
  if (notReady) {
    uncachedMark = true;
    if (service === undefined && notReady[1] !== undefined) {
      service = SERVICES[notReady[1].replace(TAG_SEPARATORS, '')];
    }
  }
  if (service === undefined) {
    const ready = READY_SERVICE.exec(text);
    if (ready) service = SERVICES[ready[1]!.replace(TAG_SEPARATORS, '')];
  }
  if (text.indexOf('⬇') >= 0 || text.indexOf('🎟') >= 0 || UNCACHED_WORD.test(text)) {
    uncachedMark = true;
  }
  if (text.indexOf('⏳') >= 0) {
    HOURGLASS.lastIndex = 0;
    let hourglass: RegExpExecArray | null;
    while ((hourglass = HOURGLASS.exec(text)) !== null) {
      if (hourglass[1] === undefined) uncachedMark = true;
    }
  }
  if (
    text.indexOf('⚡') >= 0 ||
    text.indexOf('🎫') >= 0 ||
    NAME_INSTANT.test(name) ||
    ORION_CACHED.test(name)
  ) {
    cachedMark = true;
  }

  const state: CacheState = {};
  if (service !== undefined) state.service = service;
  if (uncachedMark) state.cached = false;
  else if (cachedMark) state.cached = true;
  else if (bareTag) state.cached = false;
  return state;
}

/** A line that names a release: a year, a season or episode, or a resolution. */
const RELEASE_LINE = /(?:^|[^a-z0-9])(?:(?:19|20)\d\d|s\d\d?(?:e\d{1,3})?|\d{3,4}[pi])(?![a-z0-9])/;

function groupOnLine(line: string): string | undefined {
  return RELEASE_LINE.test(line) ? releaseGroup(line) : undefined;
}

/**
 * The release group, from the file name, else from the first line of the
 * description that names a release. Never from the link, which can carry
 * account keys.
 */
function readReleaseGroup(fileWords: string, description: string): string | undefined {
  const fromFile = groupOnLine(fileWords);
  if (fromFile !== undefined) return fromFile;
  for (const line of description.split('\n')) {
    const group = groupOnLine(line);
    if (group !== undefined) return group;
  }
  return undefined;
}

function containerOf(fileName: string): Container | undefined {
  const match = EXTENSION.exec(fileName);
  return match ? CONTAINERS[match[1]!] : undefined;
}

/**
 * Reads resolution, HDR, codecs, audio, size, seeders, cache state,
 * languages, container, release group and the sample mark out of a stream's
 * name, description, filename and URL. Addons write these as free text in
 * many styles (Torrentio, Comet, MediaFusion, AIOStreams …), so this is a set
 * of tolerant patterns, never a strict grammar; anything it cannot read is
 * left out.
 *
 * Where the parts disagree, the file name wins, then the link's file name,
 * then the description, then the name: an addon's name tag is its own guess
 * (Brazuca says "4k" for a 1080p release), the file name is the release.
 */
export function describeStream(stream: Stream): StreamFacts {
  const name = (stream.name ?? '').toLowerCase();
  let description = (stream.description ?? '').toLowerCase();
  const fileName = (stream.behaviorHints.filename ?? '').toLowerCase();
  const urlName =
    stream.source.kind === 'url' ? lastPathSegment(stream.source.url).toLowerCase() : '';

  // Subtitle languages are not the stream's languages.
  if (description.indexOf('📝') >= 0 || description.indexOf('sub') >= 0) {
    description = description.replace(SUBTITLE_LIST, (list: string, multi?: string) =>
      multi === undefined ? '' : list,
    );
  }
  // Without the extension, a ".ts" file is not read as a telesync.
  const fileWords = fileName.replace(VIDEO_EXTENSION, '');
  const urlWords = urlName.replace(VIDEO_EXTENSION, '');
  const text = fileWords + '\n' + urlWords + '\n' + description + '\n' + name;

  const draft: Draft = {
    hdr: 0,
    audio: 0,
    remux: false,
    multi: false,
    sample: false,
    languages: [],
    descriptionFrom: fileWords.length + urlWords.length + 2,
  };
  const line = titleLine(draft.descriptionFrom);
  WORDS.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = WORDS.exec(text)) !== null) {
    const end = match.index + match[0].length;
    for (let group = 1; group < match.length; group++) {
      const token = match[group];
      if (token !== undefined) {
        const rule = RULES[group - 1]!;
        const start = end - token.length;
        const counts =
          !(rule.clip && inEpisodeTitle(text, start, end, line, rule.clip === 'tagged')) &&
          (rule.afterTitle
            ? afterTitle(text, start, end, line)
            : !rule.titleWord || !inTitle(text, start, end, line));
        if (counts) rule.apply(draft, text, start, end);
        break;
      }
    }
  }
  readLanguages(text, draft.languages);

  const facts: StreamFacts = { hdr: [], audio: [], languages: [] };

  const resolution =
    readResolution(fileWords, false) ??
    readResolution(urlWords, false) ??
    readResolution(description, false) ??
    readResolution(name, true);
  if (resolution) facts.resolution = resolution;

  // A plain "HDR" next to a named HDR10 or HDR10+ is the same layer.
  const hdrBits = draft.hdr & NAMED_HDR10 ? draft.hdr & ~GENERIC_HDR : draft.hdr;
  HDR_ORDER.forEach((format, index) => {
    if (hdrBits & (1 << index)) facts.hdr.push(format);
  });

  if (draft.videoCodec) facts.videoCodec = draft.videoCodec;
  const depth = draft.bitDepth ?? (facts.hdr.length > 0 ? 10 : undefined);
  if (depth) facts.bitDepth = depth;

  // Only the best of the DTS family is kept: "DTS-HD MA" already says DTS.
  let bestDts: AudioFormat | undefined;
  AUDIO_ORDER.forEach((format, index) => {
    if (!(draft.audio & (1 << index))) return;
    if (DTS_FORMATS.indexOf(format) >= 0) {
      if (bestDts) return;
      bestDts = format;
    }
    facts.audio.push(format);
  });
  if (draft.mainAudio) {
    facts.mainAudio = DTS_FORMATS.indexOf(draft.mainAudio) >= 0 ? bestDts : draft.mainAudio;
  }

  const channels = readChannels(text) ?? draft.channelWord;
  if (channels) facts.channels = channels;

  const releaseSource = draft.cinema ?? (draft.remux ? 'REMUX' : draft.source);
  if (releaseSource) facts.releaseSource = releaseSource;

  // Sizes and seeders are the addon's own figures, never part of a file name.
  const stats = description + '\n' + name;
  const sizeBytes = stream.behaviorHints.videoSize ?? readSize(stats);
  if (sizeBytes !== undefined) facts.sizeBytes = sizeBytes;
  const seeders = readSeeders(stats);
  if (seeders !== undefined) facts.seeders = seeders;

  // A torrent, YouTube video or web page has no debrid cache.
  if (stream.source.kind === 'url') {
    const cache = readCache(name, description);
    if (cache.cached !== undefined) facts.cached = cache.cached;
    if (cache.service !== undefined) facts.service = cache.service;
  }

  if (draft.multi) facts.languages.push('multi');
  for (const code of draft.languages) facts.languages.push(code);

  const container = containerOf(fileName) ?? containerOf(urlName);
  if (container) facts.container = container;

  const group = readReleaseGroup(fileWords, description);
  if (group !== undefined) facts.releaseGroup = group;
  if (draft.sample) facts.sample = true;
  return facts;
}
