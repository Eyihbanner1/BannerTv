import type { Cue, SubtitleFit } from '@bannertv/core';
import { profileSubtitles } from '@bannertv/core';
import { describe, expect, it } from 'vitest';
import {
  fitsIn,
  lastResort,
  type PickContext,
  pickSubtitleFile,
  type PlanInput,
  planSubtitlePick,
  rankedFiles,
} from './subtitle-pick';

const video = { filename: 'Some.Film.2021.1080p.BluRay.x264-GROUP.mkv' };

interface File {
  key: string;
  url: string;
  lang: string;
  label?: string;
}

const file = (key: string, lang = 'eng', label?: string): File => ({
  key,
  url: `https://subs.example/${key}.srt`,
  lang,
  label,
});

const FITS: SubtitleFit = {
  script: 'right',
  signs: false,
  hearing: false,
  length: 'fits',
  unfit: false,
};
const SDH: SubtitleFit = { ...FITS, hearing: true };
const BEHIND: SubtitleFit = { ...FITS, drift: 'behind' };
const SIGNS: SubtitleFit = { ...FITS, signs: true, unfit: true };
const OTHER_SCRIPT: SubtitleFit = { ...FITS, script: 'wrong', unfit: true };

/** A context where these files were read with these checks, and these could not be read. */
function context(
  fits: Record<string, SubtitleFit> = {},
  broken: readonly string[] = [],
  extra: Partial<PickContext> = {},
): PickContext {
  return {
    video,
    broken: (url) => broken.some((key) => url.endsWith(`/${key}.srt`)),
    fit: (url) => fits[/\/([^/]+)\.srt$/.exec(url)![1]!],
    hearing: false,
    ...extra,
  };
}

const keys = (files: readonly File[]) => files.map((f) => f.key);

describe('rankedFiles and pickSubtitleFile', () => {
  it('prefers a file made for the release playing over the first in the list', () => {
    const offered = [
      file('a', 'eng', 'Some.Film.2021.720p.WEB-DL.AAC-OTHER'),
      file('b', 'eng', 'Some.Film.2021.1080p.BluRay.x264-GROUP'),
      file('c', 'fre', 'Some.Film.2021.1080p.BluRay.x264-GROUP'),
    ];
    expect(pickSubtitleFile(offered, 'en', context())?.key).toBe('b');
    expect(pickSubtitleFile(offered, 'fr', context())?.key).toBe('c');
  });

  it('keeps the list order when nothing matches and nothing has been read', () => {
    const offered = [file('a', 'eng', 'Other.Release.720p.WEB'), file('b', 'eng')];
    expect(pickSubtitleFile(offered, 'en', context())?.key).toBe('a');
  });

  it('passes over files that failed, or failed their checks badly, unless picked by hand', () => {
    const offered = [file('a'), file('b'), file('c'), file('d')];
    const fits = { a: SIGNS, b: OTHER_SCRIPT };
    expect(keys(rankedFiles(offered, 'en', context(fits, ['c'])))).toEqual(['d']);
    expect(keys(rankedFiles(offered, 'en', context(fits, [], { remembered: 'a' })))).toEqual([
      'a',
      'c',
      'd',
    ]);
    expect(pickSubtitleFile(offered, 'en', context(fits, ['c', 'd']))).toBeUndefined();
    expect(pickSubtitleFile(offered, 'de', context())).toBeUndefined();
  });

  it('puts the best fit first: whole and plain, then for the hard of hearing, then a drift to fix', () => {
    const offered = [file('drifts'), file('sdh'), file('plain')];
    const fits = { drifts: BEHIND, sdh: SDH, plain: FITS };
    expect(keys(rankedFiles(offered, 'en', context(fits)))).toEqual(['plain', 'sdh', 'drifts']);
    expect(keys(rankedFiles(offered, 'en', context(fits, [], { hearing: true })))).toEqual([
      'sdh',
      'plain',
      'drifts',
    ]);
  });
});

describe('lastResort', () => {
  it('takes a file that failed its checks before one that could not be read', () => {
    const offered = [file('gone'), file('signs')];
    expect(lastResort(offered, 'en', context({ signs: SIGNS }, ['gone']))?.key).toBe('signs');
    expect(lastResort(offered, 'en', context({}, ['gone', 'signs']))?.key).toBe('gone');
    expect(lastResort(offered, 'de', context())).toBeUndefined();
  });
});

function plan(
  offered: readonly File[],
  fits: Record<string, SubtitleFit>,
  over: Partial<PlanInput<File>> = {},
) {
  const result = planSubtitlePick<File>({
    ...context(fits, [], over),
    offered,
    language: 'en',
    reading: () => false,
    holding: true,
    timeUp: false,
    readsLeft: 4,
    switchesLeft: 2,
    ...over,
  });
  return { ...result, pick: result.pick?.key, read: keys(result.read) };
}

describe('planSubtitlePick', () => {
  const offered = [file('signs'), file('past'), file('full'), file('more'), file('fifth')];

  it('reads the first few files and holds the lines back, on the first meanwhile', () => {
    expect(plan(offered, {})).toEqual({
      pick: 'signs',
      read: ['signs', 'past', 'full', 'more'],
      hold: true,
      switched: false,
    });
    // At most as many as are left to read in the language.
    expect(plan(offered, {}, { readsLeft: 1 }).read).toEqual(['signs']);
  });

  it('passes over signs only and a drift for the full file once the few are read', () => {
    const fits = { signs: SIGNS, past: BEHIND, full: FITS, more: SDH, fifth: FITS };
    expect(plan(offered, fits, { current: 'signs' })).toEqual({
      pick: 'full',
      read: [],
      hold: false,
      switched: false,
    });
  });

  it('keeps holding while one of the few is read, until the time is up', () => {
    const fits = { signs: SIGNS, past: BEHIND };
    const reading = (url: string) => url.endsWith('/full.srt') || url.endsWith('/more.srt');
    expect(plan(offered, fits, { current: 'past', reading, readsLeft: 0 })).toMatchObject({
      pick: 'past',
      hold: true,
    });
    // Time is up: the best read so far shows, the drift fixed; the rest are still read.
    expect(plan(offered, fits, { current: 'past', reading, readsLeft: 0, timeUp: true })).toEqual({
      pick: 'past',
      read: [],
      hold: false,
      switched: false,
    });
  });

  it('keeps holding until the player knows how long the video is, or the time is up', () => {
    const fits = { signs: SIGNS, past: FITS, full: FITS, more: FITS };
    const read = { current: 'past', readsLeft: 0 };
    expect(plan(offered, fits, { ...read, lengthPending: true })).toMatchObject({
      pick: 'past',
      hold: true,
    });
    expect(plan(offered, fits, { ...read, lengthPending: true, timeUp: true })).toMatchObject({
      pick: 'past',
      hold: false,
    });
    expect(plan(offered, fits, read)).toMatchObject({ pick: 'past', hold: false });
  });

  it('lets the lines through when nothing more can be read', () => {
    expect(plan(offered, { signs: SIGNS }, { current: 'signs', readsLeft: 0 })).toEqual({
      pick: 'past',
      read: [],
      hold: false,
      switched: false,
    });
  });

  it('takes the version picked by hand, or one made for the release, at once and reads no other', () => {
    expect(plan(offered, {}, { remembered: 'more' })).toEqual({
      pick: 'more',
      read: [],
      hold: false,
      switched: false,
    });
    const matching = [...offered, file('match', 'eng', 'Some.Film.2021.1080p.BluRay-GROUP')];
    // Even after lines show, as a slower addon's file made for the release arrives.
    expect(plan(matching, { past: BEHIND }, { holding: false, current: 'past' })).toEqual({
      pick: 'match',
      read: [],
      hold: false,
      switched: false,
    });
  });

  it('does not swap two files made for the release back and forth as each is read', () => {
    const label = 'Some.Film.2021.1080p.BluRay-GROUP';
    const two = [file('cd1', 'eng', label), file('cd2', 'eng', label)];
    const SHORT: SubtitleFit = { ...FITS, length: 'short' };
    const showing = { holding: false, current: 'cd1' };
    const settled = { hold: false, switched: false };
    // The first shows at once.
    expect(plan(two, {})).toEqual({ pick: 'cd1', read: [], ...settled });
    // Read, it covers only part of the film: the other is read, and the first stays meanwhile.
    expect(plan(two, { cd1: SHORT }, showing)).toEqual({ pick: 'cd1', read: ['cd2'], ...settled });
    expect(plan(two, { cd1: BEHIND }, showing)).toEqual({ pick: 'cd1', read: ['cd2'], ...settled });
    // Read and no better: the first stays.
    expect(plan(two, { cd1: SHORT, cd2: SHORT }, showing)).toEqual({
      pick: 'cd1',
      read: [],
      ...settled,
    });
    // Read and clearly better: it takes over, counted as a switch, but not when none is left.
    expect(plan(two, { cd1: SHORT, cd2: FITS }, showing)).toEqual({
      pick: 'cd2',
      read: [],
      hold: false,
      switched: true,
    });
    expect(plan(two, { cd1: SHORT }, { ...showing, switchesLeft: 0 })).toEqual({
      pick: 'cd1',
      read: [],
      ...settled,
    });
    // Once on the second, the first stays passed over.
    expect(plan(two, { cd1: SHORT, cd2: FITS }, { ...showing, current: 'cd2' })).toEqual({
      pick: 'cd2',
      read: [],
      ...settled,
    });
  });

  it('once lines show, switches to a file read later only when it fits clearly better', () => {
    const showing = { holding: false, current: 'past', readsLeft: 0 };
    expect(plan(offered, { signs: SIGNS, past: BEHIND, full: FITS }, showing)).toEqual({
      pick: 'full',
      read: [],
      hold: false,
      switched: true,
    });
    // Not when no switch is left.
    expect(
      plan(offered, { signs: SIGNS, past: BEHIND, full: FITS }, { ...showing, switchesLeft: 0 })
        .pick,
    ).toBe('past');
    // Not to one that is only as good.
    expect(plan(offered, { past: FITS, full: FITS }, showing).pick).toBe('past');
    // Not to one not read yet.
    expect(plan(offered, { signs: SIGNS, past: BEHIND }, showing).pick).toBe('past');
  });

  it('moves on from a choice that failed its checks, without counting it a switch', () => {
    expect(
      plan(offered, { signs: OTHER_SCRIPT, past: SDH }, { holding: false, current: 'signs' }),
    ).toMatchObject({ pick: 'past', switched: false });
  });

  it('falls back to what is left when every file failed or failed its checks', () => {
    const two = [file('a'), file('b')];
    expect(
      plan(two, { a: SIGNS, b: OTHER_SCRIPT }, { holding: false, current: 'a' }),
    ).toMatchObject({ pick: 'a', read: [], hold: false });
  });
});

describe('fitsIn', () => {
  const lines = (count: number, end: number): Cue[] =>
    Array.from({ length: count }, (_, i) => {
      const start = (i * (end - 2)) / (count - 1);
      return { start, end: start + 2, lines: [[{ text: 'Where have you been all night?' }]] };
    });

  it('judges each file read in the language against the video, and only those', () => {
    const offered = [file('full'), file('signs'), file('unread'), file('french', 'fre')];
    const profiles: Record<string, ReturnType<typeof profileSubtitles>> = {
      full: profileSubtitles(lines(1200, 6800)),
      signs: profileSubtitles(lines(20, 6800)),
      french: profileSubtitles(lines(1200, 6800)),
    };
    const fits = fitsIn(offered, 'en', (url) => profiles[/\/([^/]+)\.srt$/.exec(url)![1]!], {
      seconds: 7200,
      exact: true,
    });
    expect(Array.from(fits.keys()).map((url) => /\/([^/]+)\.srt$/.exec(url)![1])).toEqual([
      'full',
      'signs',
    ]);
    expect(fits.get(file('signs').url)!.unfit).toBe(true);
    expect(fits.get(file('full').url)!.unfit).toBe(false);
  });
});
