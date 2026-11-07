import type { Cue, SubtitleFit } from '@bannertv/core';
import { profileSubtitles } from '@bannertv/core';
import { describe, expect, it } from 'vitest';
import { driftInUse } from './drift';
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
const LONG: SubtitleFit = { ...FITS, length: 'long' };
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

  it('takes signs only in the language before a file in another script', () => {
    const offered = [file('other'), file('signs'), file('gone')];
    const fits = { other: OTHER_SCRIPT, signs: SIGNS };
    expect(lastResort(offered, 'en', context(fits, ['gone']))?.key).toBe('signs');
    // Another script is still better than a file that could not be read.
    expect(lastResort(offered, 'en', context(fits, ['signs', 'gone']))?.key).toBe('other');
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

  it('reads the first two files and holds the lines back, on the first meanwhile', () => {
    expect(plan(offered, {})).toEqual({
      pick: 'signs',
      read: ['signs', 'past'],
      hold: true,
      switched: false,
    });
    // At most as many as are left to read in the language.
    expect(plan(offered, {}, { readsLeft: 1 }).read).toEqual(['signs']);
  });

  it('reads no more once a file read fits as it is, and two at a time while none does', () => {
    // The first fits as it is, whole and plain: nothing can beat it, so the rest are not read.
    expect(plan(offered, { signs: FITS, past: SDH }, { current: 'signs', readsLeft: 2 })).toEqual({
      pick: 'signs',
      read: [],
      hold: false,
      switched: false,
    });
    // Neither of the first two does: the next two in the list are read, the lines held back.
    expect(plan(offered, { signs: SIGNS, past: SDH }, { current: 'past', readsLeft: 2 })).toEqual({
      pick: 'past',
      read: ['full', 'more'],
      hold: true,
      switched: false,
    });
    // One still being read leaves room for one more.
    const reading = (url: string) => url.endsWith('/full.srt');
    expect(
      plan(offered, { signs: SIGNS, past: SDH }, { current: 'past', readsLeft: 1, reading }).read,
    ).toEqual(['more']);
  });

  it('reads the files listed first for another stream of the video, though others were read', () => {
    // The stream's own file, listed first, is new; the others were read for the stream before.
    const listed = [file('own'), file('a'), file('b'), file('c'), file('d')];
    const before = { a: FITS, b: FITS, c: FITS, d: SDH };
    expect(plan(listed, before)).toEqual({ pick: 'a', read: ['own'], hold: true, switched: false });
    expect(plan(listed, { ...before, own: FITS }, { current: 'a', readsLeft: 3 })).toEqual({
      pick: 'own',
      read: [],
      hold: false,
      switched: false,
    });
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

  it('reads a plain copy made for the release below the one showing for the hard of hearing', () => {
    const label = 'Some.Film.2021.1080p.BluRay-GROUP';
    const two = [file('sdh', 'eng', label), file('plain', 'eng', label)];
    const showing = { holding: false, current: 'sdh' };
    const settled = { hold: false, switched: false };
    expect(plan(two, { sdh: SDH }, showing)).toEqual({ pick: 'sdh', read: ['plain'], ...settled });
    // Plain, it takes over, counted as a switch; not when none is left.
    expect(plan(two, { sdh: SDH, plain: FITS }, showing)).toEqual({
      pick: 'plain',
      read: [],
      hold: false,
      switched: true,
    });
    expect(plan(two, { sdh: SDH }, { ...showing, switchesLeft: 0 })).toEqual({
      pick: 'sdh',
      read: [],
      ...settled,
    });
    // Once on the plain copy, the other never takes back over.
    expect(plan(two, { sdh: SDH, plain: FITS }, { ...showing, current: 'plain' })).toEqual({
      pick: 'plain',
      read: [],
      ...settled,
    });
    // Unread, the one showing waits for its own reading before the other is read.
    expect(plan(two, {}, showing)).toEqual({ pick: 'sdh', read: [], ...settled });
    // Lines for the hard of hearing wanted: the other way round.
    expect(plan(two, { sdh: SDH }, { ...showing, hearing: true })).toEqual({
      pick: 'sdh',
      read: [],
      ...settled,
    });
  });

  it('judges a file made for the release like any other once it reads as another cut', () => {
    const offered = [
      file('cut', 'eng', 'Some.Film.2021.EXTENDED.1080p.BluRay-GROUP'),
      file('a'),
      file('b'),
    ];
    const showing = { holding: false, current: 'cut' };
    expect(plan(offered, { cut: LONG }, showing)).toEqual({
      pick: 'cut',
      read: ['a', 'b'],
      hold: false,
      switched: false,
    });
    // It fits as it is: no more is read.
    expect(plan(offered, { cut: LONG, a: FITS }, showing)).toEqual({
      pick: 'a',
      read: [],
      hold: false,
      switched: true,
    });
    // Once switched, it does not come back.
    expect(plan(offered, { cut: LONG, a: FITS }, { ...showing, current: 'a' })).toMatchObject({
      pick: 'a',
      switched: false,
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

  it('reads the first two beside the version picked by hand whose lines run on past the end', () => {
    const showing = { remembered: 'more', current: 'more', holding: false, switchesLeft: 0 };
    const runsOn: SubtitleFit = { ...FITS, coverage: 1.02, runsOn: true };
    // For their checks only: a drift files agreeing on an end can show. It stays.
    expect(plan(offered, { more: runsOn }, showing)).toEqual({
      pick: 'more',
      read: ['signs', 'past'],
      hold: false,
      switched: false,
    });
    expect(plan(offered, { more: runsOn, signs: FITS, past: FITS, full: FITS }, showing)).toEqual({
      pick: 'more',
      read: [],
      hold: false,
      switched: false,
    });
    // Not while it ends in time, while its own length shows a drift, or while the player is
    // still learning how long the video is.
    expect(plan(offered, { more: { ...FITS, coverage: 0.99 } }, showing).read).toEqual([]);
    expect(
      plan(offered, { more: { ...BEHIND, coverage: 1.04, runsOn: true } }, showing).read,
    ).toEqual([]);
    // Nor while it ends past the video by only what releases differ by, or with one or two late
    // lines: other files could not show a drift.
    expect(plan(offered, { more: { ...FITS, coverage: 1.0002 } }, showing).read).toEqual([]);
    expect(plan(offered, { more: { ...FITS, coverage: 1.03 } }, showing).read).toEqual([]);
    expect(plan(offered, { more: runsOn }, { ...showing, lengthPending: true }).read).toEqual([]);
    // Nor before it has been read.
    expect(plan(offered, {}, showing).read).toEqual([]);
  });

  it('does not wait for a slow download, and reads the next file meanwhile', () => {
    // The first two are still on their way after the hold's time.
    const slow = (url: string) => url.endsWith('/signs.srt') || url.endsWith('/past.srt');
    const reading = slow;
    expect(plan(offered, {}, { reading, slow, readsLeft: 2 })).toEqual({
      pick: 'signs',
      read: ['full', 'more'],
      hold: true,
      switched: false,
    });
    // The next file read fits as it is: its lines show, the slow two not waited for.
    expect(
      plan(offered, { full: FITS }, { reading, slow, current: 'signs', readsLeft: 0 }),
    ).toEqual({ pick: 'full', read: [], hold: false, switched: false });
    // While they are not slow yet, the hold waits for them and nothing more is read.
    expect(plan(offered, {}, { reading, readsLeft: 2 })).toMatchObject({ read: [], hold: true });
    expect(
      plan(offered, { full: FITS }, { reading, current: 'signs', readsLeft: 0 }),
    ).toMatchObject({ hold: true });
  });

  it('gives way at once from a slow file whose lines never showed, without counting a switch', () => {
    // The hold ended with nothing read, on the first file; both are still on their way.
    const two = [file('a'), file('b')];
    const reading = (url: string) => url.endsWith('/a.srt');
    const waiting = { holding: false, current: 'a', reading, slow: reading };
    const settled = { read: [], hold: false, switched: false };
    // The second is read and fits: it shows now, not once the first has come.
    expect(plan(two, { b: FITS }, waiting)).toEqual({ pick: 'b', ...settled });
    // Whatever it fits like, and with no switch left: nothing showed to switch from.
    expect(plan(two, { b: SDH }, { ...waiting, switchesLeft: 0 })).toEqual({
      pick: 'b',
      ...settled,
    });
    // The same among files made for the release.
    const label = 'Some.Film.2021.1080p.BluRay-GROUP';
    const copies = [file('a', 'eng', label), file('b', 'eng', label)];
    expect(plan(copies, { b: SDH }, waiting)).toEqual({ pick: 'b', ...settled });
    // Once its lines show, only a file that fits clearly better takes over, as a switch.
    expect(plan(two, { a: SDH, b: SDH }, waiting).pick).toBe('a');
    expect(plan(two, { a: SDH, b: FITS }, waiting)).toEqual({
      pick: 'b',
      read: [],
      hold: false,
      switched: true,
    });
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

  it('fixes the drift of the version picked by hand by its own length when it plays again', () => {
    // Timed for film speed on a PAL video: it runs on about 4% past the video's end.
    const behind = file('behind');
    const offered = [behind, file('other')];
    const profiles: Record<string, ReturnType<typeof profileSubtitles>> = {
      behind: profileSubtitles(lines(1300, 7450)),
    };
    const fits = fitsIn(offered, 'en', (url) => profiles[/\/([^/]+)\.srt$/.exec(url)![1]!], {
      seconds: 7200,
      exact: true,
    });
    const result = planSubtitlePick<File>({
      ...context(),
      fit: (url) => fits.get(url),
      remembered: 'behind',
      offered,
      language: 'en',
      reading: () => false,
      current: 'behind',
      holding: false,
      timeUp: false,
      readsLeft: 4,
      switchesLeft: 0,
    });
    expect(result.pick?.key).toBe('behind');
    expect(result.read).toEqual([]);
    const evidence = fits.get(behind.url)?.drift ?? null;
    expect(driftInUse({ canFix: true, evidence, kept: null, offset: 0 })).toEqual({
      drift: 'behind',
      auto: true,
    });
  });

  it('reads no other file beside the version picked by hand that ends a second past the video', () => {
    const offered = [file('a'), file('b'), file('x')];
    const profiles: Record<string, ReturnType<typeof profileSubtitles>> = {
      x: profileSubtitles(lines(1300, 7201)),
    };
    const fits = fitsIn(offered, 'en', (url) => profiles[/\/([^/]+)\.srt$/.exec(url)![1]!], {
      seconds: 7200,
      exact: true,
    });
    expect(fits.get(file('x').url)).toMatchObject({ length: 'fits', unfit: false });
    const result = planSubtitlePick<File>({
      ...context(),
      fit: (url) => fits.get(url),
      remembered: 'x',
      offered,
      language: 'en',
      reading: () => false,
      current: 'x',
      holding: false,
      timeUp: false,
      readsLeft: 4,
      switchesLeft: 0,
    });
    expect(result.pick?.key).toBe('x');
    expect(result.read).toEqual([]);
  });

  it('fixes the drift of the version picked by hand again when only other files show it', () => {
    // A 22-minute episode as a PAL release. Two files end with it; the one picked by hand is
    // timed for film speed, and ends 26 s past it: too little to tell on its own.
    const video = { seconds: 1320, exact: true };
    const offered = [file('a'), file('b'), file('x')];
    const profiles: Record<string, ReturnType<typeof profileSubtitles>> = {
      x: profileSubtitles(lines(370, 1346)),
    };
    const profileOf = (url: string) => profiles[/\/([^/]+)\.srt$/.exec(url)![1]!];
    const planned = () => {
      const fits = fitsIn(offered, 'en', profileOf, video);
      const result = planSubtitlePick<File>({
        ...context(),
        fit: (url) => fits.get(url),
        remembered: 'x',
        offered,
        language: 'en',
        reading: () => false,
        current: 'x',
        holding: false,
        timeUp: false,
        readsLeft: 4,
        switchesLeft: 0,
      });
      return { fits, result };
    };
    // Played again, the version picked by hand alone has been read: the first two are read too.
    const before = planned();
    expect(before.fits.get(file('x').url)?.drift).toBeUndefined();
    expect(before.result.pick?.key).toBe('x');
    expect(keys(before.result.read)).toEqual(['a', 'b']);
    profiles.a = profileSubtitles(lines(350, 1291));
    profiles.b = profileSubtitles(lines(360, 1293));
    // They agree on an end, 4% before its: it falls behind, and the player fixes it again.
    const after = planned();
    expect(after.result).toMatchObject({ read: [], switched: false });
    expect(after.result.pick?.key).toBe('x');
    const evidence = after.fits.get(file('x').url)?.drift ?? null;
    expect(evidence).toBe('behind');
    expect(driftInUse({ canFix: true, evidence, kept: null, offset: 0 })).toEqual({
      drift: 'behind',
      auto: true,
    });
    // With the viewer's timing kept beside the player's own fix, too.
    expect(driftInUse({ canFix: true, evidence, kept: 'auto', offset: 0.3 })).toEqual({
      drift: 'behind',
      auto: true,
    });
  });
});
