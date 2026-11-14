import type { StreamEntry } from '@bannertv/core';
import { describe, expect, it } from 'vitest';
import type {
  SubtitleCheck,
  SubtitleChoice,
  SubtitleStatus,
} from '../screens/player/use-subtitles';
import type { EngineTrack } from './engines/types';
import type { SubtitleOption } from './subtitles';
import {
  createOrderMemory,
  isUnfit,
  languageFirstPick,
  playingRelease,
  sameChoice,
  subtitlesValue,
  subtitleVersions,
  versionGroups,
  versionDetail,
  versionId,
  versionNotes,
} from './subtitle-versions';

const IN_THE_STREAM = 'In the stream';

function option(key: string, lang: string, label?: string, source = 'OpenSubtitles v3') {
  const made: SubtitleOption = { key, lang, source, url: `https://subs.example.com/${key}.srt` };
  return label ? { ...made, label } : made;
}

function track(id: string, lang: string, label = ''): EngineTrack {
  return { id, lang, label, active: false };
}

/** Each group's language and its versions' ids, as a sheet lists them. */
function shape(groups: ReturnType<typeof versionGroups>) {
  return groups.map((group) => [group.key, group.items.map((item) => versionId(item.choice))]);
}

describe('subtitle versions', () => {
  it('lists the stream’s own tracks first, each with its own name only when it says more', () => {
    const versions = subtitleVersions(
      {
        tracks: [track('t1', 'eng', 'English'), track('t2', 'eng', 'English SDH')],
        options: [option('os#1', 'eng', 'Film.2024.1080p.WEB-DL')],
      },
      IN_THE_STREAM,
    );
    expect(versions).toEqual([
      {
        choice: { kind: 'track', id: 't1' },
        lang: 'eng',
        source: IN_THE_STREAM,
        release: undefined,
      },
      {
        choice: { kind: 'track', id: 't2' },
        lang: 'eng',
        source: IN_THE_STREAM,
        release: 'English SDH',
      },
      {
        choice: { kind: 'file', key: 'os#1' },
        lang: 'eng',
        source: 'OpenSubtitles v3',
        release: 'Film.2024.1080p.WEB-DL',
      },
    ]);
  });

  it('groups by language, the language last chosen first, tracks before files in each', () => {
    const order = createOrderMemory();
    const versions = subtitleVersions(
      {
        tracks: [track('t-fr', 'fre')],
        options: [option('os#en1', 'eng'), option('os#fr1', 'fre'), option('os#en2', 'en')],
      },
      IN_THE_STREAM,
    );
    expect(shape(versionGroups(versions, 'fre', order))).toEqual([
      ['fr', ['track:t-fr', 'file:os#fr1']],
      ['en', ['file:os#en1', 'file:os#en2']],
    ]);
    // With no language chosen before, by English name.
    expect(shape(versionGroups(versions, null, createOrderMemory()))).toEqual([
      ['en', ['file:os#en1', 'file:os#en2']],
      ['fr', ['track:t-fr', 'file:os#fr1']],
    ]);
  });

  it('keeps every row in its place as more versions arrive, a late track still first', () => {
    const order = createOrderMemory();
    const first = subtitleVersions(
      { tracks: [], options: [option('os#de1', 'ger'), option('os#en1', 'eng')] },
      IN_THE_STREAM,
    );
    expect(shape(versionGroups(first, null, order))).toEqual([
      ['en', ['file:os#en1']],
      ['de', ['file:os#de1']],
    ]);
    // Another addon answers with a file listed before the others, and the stream lists a track.
    const later = subtitleVersions(
      {
        tracks: [track('t-en', 'eng')],
        options: [
          option('sub#en9', 'eng', undefined, 'SubDL'),
          option('os#de1', 'ger'),
          option('os#en1', 'eng'),
          option('sub#ar1', 'ara', undefined, 'SubDL'),
        ],
      },
      IN_THE_STREAM,
    );
    expect(shape(versionGroups(later, null, order))).toEqual([
      ['en', ['track:t-en', 'file:os#en1', 'file:sub#en9']],
      ['de', ['file:os#de1']],
      ['ar', ['file:sub#ar1']],
    ]);
    // Drawn again with the same versions, the same order.
    expect(shape(versionGroups(later, null, order))).toEqual(
      shape(versionGroups(later, null, order)),
    );
  });

  it('says loading first, then whether it failed or was skipped, then whether it is the same release', () => {
    const video = { filename: 'Film.2024.1080p.WEB-DL.x264-GROUP.mkv' };
    const matching = {
      choice: { kind: 'file', key: 'os#1' } as const,
      lang: 'eng',
      source: 'OpenSubtitles v3',
      release: 'Film.2024.1080p.WEB-DL.x264-GROUP',
    };
    const other = { ...matching, release: 'Film.2024.720p.BluRay' };
    expect(versionNotes(matching, true, 'loading', video)).toEqual(['loading']);
    expect(versionNotes(matching, true, 'failed', video)).toEqual(['failed']);
    expect(versionNotes(matching, false, 'failed', video)).toEqual(['skipped']);
    expect(versionNotes(matching, false, undefined, video)).toEqual(['sameRelease']);
    expect(versionNotes(other, false, undefined, video)).toEqual([]);
    expect(versionNotes(matching, false, undefined, {})).toEqual([]);
    // A loose match, with no group on one side to confirm it, is as often another group's
    // release: it says nothing.
    expect(
      versionNotes({ ...matching, release: 'Film.2024.1080p.WEB-DL' }, false, undefined, video),
    ).toEqual([]);
    // The second name the addon sent counts too, and a subtitle file's own tags do not get in
    // the way: OpenSubtitles names its files ("…-GROUP-HI.srt").
    expect(
      versionNotes(
        { ...other, release: 'Film.2024.1080p.WEB-DL.x264-GROUP-HI.srt' },
        false,
        undefined,
        video,
      ),
    ).toEqual(['sameRelease']);
    expect(
      versionNotes(
        { ...other, release: 'Film.2024.srt', releaseName: 'Film.2024.1080p.WEB-DL.x264-GROUP' },
        false,
        undefined,
        video,
      ),
    ).toEqual(['sameRelease']);
    // But never against what the file's own name says: 720p from Blu-ray.
    expect(
      versionNotes(
        { ...other, releaseName: 'Film.2024.1080p.WEB-DL.x264-GROUP' },
        false,
        undefined,
        video,
      ),
    ).toEqual([]);
  });

  it('carries the second release name from the addon’s file to the row', () => {
    const video = { filename: 'Film.2024.1080p.WEB-DL.x264-GROUP.mkv' };
    const [version] = subtitleVersions(
      {
        tracks: [],
        options: [
          {
            ...option('os#1', 'eng', 'Film.2024.srt'),
            releaseName: 'Film.2024.1080p.WEB-DL.x264-GROUP',
          },
        ],
      },
      IN_THE_STREAM,
    );
    expect(version).toMatchObject({ releaseName: 'Film.2024.1080p.WEB-DL.x264-GROUP' });
    expect(versionNotes(version!, false, undefined, video)).toEqual(['sameRelease']);
  });

  it('says a file its addon found by the video’s hash is linked to it, unless its names say another release', () => {
    const video = { filename: 'Film.2024.1080p.WEB-DL.x264-GROUP.mkv' };
    const linked = {
      choice: { kind: 'file', key: 'os#1' } as const,
      lang: 'eng',
      source: 'OpenSubtitles v3',
      release: 'Film_2024.srt',
      hashMatch: true,
    };
    expect(versionNotes(linked, false, undefined, video)).toEqual(['linked']);
    expect(
      versionNotes(
        { ...linked, release: 'Film.2024.1080p.WEB-DL.x264-GROUP' },
        false,
        undefined,
        video,
      ),
    ).toEqual(['linked']);
    expect(versionNotes(linked, false, undefined, {}, { hearing: true })).toEqual([
      'linked',
      'hearing',
    ]);
    // OpenSubtitles marks other releases' files linked to the hash too: 720p from Blu-ray.
    expect(
      versionNotes({ ...linked, release: 'Film.2024.720p.BluRay.srt' }, false, undefined, video),
    ).toEqual([]);
  });

  it('says a file for another episode is, dimmed', () => {
    const version = {
      choice: { kind: 'file', key: 'os#1' } as const,
      lang: 'eng',
      source: 'OpenSubtitles v3',
      release: 'Show.S01E02.1080p.WEB.H264-CAKES.srt',
    };
    const episode: SubtitleCheck = { hearing: false, problem: 'episode' };
    expect(versionNotes(version, false, undefined, {}, episode)).toEqual(['otherEpisode']);
    expect(isUnfit(episode)).toBe(true);
  });

  it('reads the season and episode playing from the video’s id', () => {
    const entry = {
      addonId: 'org.test',
      stream: { url: 'https://example.com/v.mkv', behaviorHints: { filename: 'Show.S01E01.mkv' } },
    } as unknown as StreamEntry;
    expect(playingRelease(entry, 'tt3581920:1:1')).toMatchObject({
      filename: 'Show.S01E01.mkv',
      season: 1,
      episode: 1,
    });
    expect(playingRelease(entry, 'tmdb:1399:2:3')).toMatchObject({ season: 2, episode: 3 });
    expect(playingRelease(entry, 'tt0111161')).not.toHaveProperty('season');
    expect(playingRelease(null, 'tt3581920:1:1')).toEqual({});
    // A Kitsu or MyAnimeList episode is the anime's id and the episode: no season, so the
    // names say which episode a file is for.
    for (const id of ['kitsu:1376:5', 'kitsu:7442:3', 'mal:5114:1']) {
      const release = playingRelease(entry, id);
      expect(release, id).not.toHaveProperty('season');
      expect(release, id).not.toHaveProperty('episode');
    }
  });

  it('says what reading a file found, a drift fixed by itself, then the match and lines for the hard of hearing', () => {
    const video = { filename: 'Film.2024.1080p.WEB-DL.x264-GROUP.mkv' };
    const version = {
      choice: { kind: 'file', key: 'os#1' } as const,
      lang: 'eng',
      source: 'OpenSubtitles v3',
      release: 'Film.2024.1080p.WEB-DL.x264-GROUP',
    };
    const plain = { ...version, release: undefined };
    expect(versionNotes(plain, false, undefined, video, { hearing: true })).toEqual(['hearing']);
    expect(
      versionNotes(plain, false, undefined, video, { hearing: false, problem: 'script' }),
    ).toEqual(['otherScript']);
    expect(
      versionNotes(plain, false, undefined, video, { hearing: false, problem: 'signs' }),
    ).toEqual(['signs']);
    expect(
      versionNotes(plain, true, undefined, video, { hearing: false, problem: 'short' }),
    ).toEqual(['short']);
    expect(versionNotes(plain, true, undefined, video, { hearing: true, autoDrift: true })).toEqual(
      ['driftFixed', 'hearing'],
    );
    // Two at most: the most telling.
    expect(
      versionNotes(version, true, undefined, video, {
        hearing: true,
        problem: 'long',
        autoDrift: true,
      }),
    ).toEqual(['long', 'driftFixed']);
    expect(versionNotes(version, false, undefined, video, { hearing: true })).toEqual([
      'sameRelease',
      'hearing',
    ]);
    // Loading or a failure says only that.
    expect(versionNotes(version, true, 'loading', video, { hearing: true })).toEqual(['loading']);
  });

  /** What the sheet knows of the versions, for starting a language. */
  function known(
    over: {
      failed?: string[];
      checks?: Record<string, SubtitleCheck>;
      remembered?: string;
      hearing?: boolean;
    } = {},
  ) {
    const key = (choice: NonNullable<SubtitleChoice>) => versionId(choice);
    return {
      statusOf: (choice: NonNullable<SubtitleChoice>): SubtitleStatus | undefined =>
        (over.failed ?? []).indexOf(key(choice)) !== -1 ? 'failed' : undefined,
      checkOf: (choice: NonNullable<SubtitleChoice>): SubtitleCheck | undefined =>
        over.checks?.[key(choice)],
      isRemembered: (choice: NonNullable<SubtitleChoice>) => key(choice) === over.remembered,
      wantsHearing: () => !!over.hearing,
    };
  }
  const video = { filename: 'Film.2024.1080p.WEB-DL.x264-GROUP.mkv' };
  const firstOf = (
    tracks: EngineTrack[],
    options: SubtitleOption[],
    over: Parameters<typeof known>[0] = {},
  ) => {
    const [group] = versionGroups(
      subtitleVersions({ tracks, options }, IN_THE_STREAM),
      null,
      createOrderMemory(),
    );
    return versionId(languageFirstPick(group!, known(over), video).choice);
  };

  it('picks a language’s first version that has not failed, or its first when all have', () => {
    const options = [option('os#1', 'eng'), option('os#2', 'eng')];
    expect(firstOf([], options)).toBe('file:os#1');
    expect(firstOf([], options, { failed: ['file:os#1'] })).toBe('file:os#2');
    expect(firstOf([], options, { failed: ['file:os#1', 'file:os#2'] })).toBe('file:os#1');
  });

  it('starts a language on its best placed version, as the automatic choice ranks them', () => {
    const options = [option('os#1', 'eng'), option('os#2', 'eng'), option('os#3', 'eng')];
    const problem = (found: SubtitleCheck['problem']): SubtitleCheck => ({
      hearing: false,
      problem: found,
    });
    expect(
      firstOf([], options, {
        checks: { 'file:os#1': problem('signs'), 'file:os#2': problem('script') },
      }),
    ).toBe('file:os#3');
    // A file known to cover only part falls below one not read yet.
    expect(firstOf([], options, { checks: { 'file:os#1': problem('short') } })).toBe('file:os#2');
    // Plain lines before lines for the hard of hearing, unless those are wanted.
    const sdh = { 'file:os#1': { hearing: true }, 'file:os#2': { hearing: false } };
    expect(firstOf([], options, { checks: sdh })).toBe('file:os#2');
    expect(firstOf([], options, { checks: sdh, hearing: true })).toBe('file:os#1');
    // Nothing better: the first that was not passed over.
    expect(
      firstOf([], options, {
        checks: {
          'file:os#1': problem('signs'),
          'file:os#2': problem('signs'),
          'file:os#3': problem('script'),
        },
      }),
    ).toBe('file:os#1');
  });

  it('starts a language on the version picked by hand, then one made for the release', () => {
    const options = [
      option('os#1', 'eng'),
      option('os#2', 'eng', 'Film.2024.1080p.WEB-DL.x264-GROUP'),
      option('os#3', 'eng'),
    ];
    expect(firstOf([], options)).toBe('file:os#2');
    // One named for the release goes before one its addon's hash alone links to the video
    // (OpenSubtitles marks other releases' files too), which goes before the rest.
    const hashed = options.map((o) => (o.key === 'os#3' ? { ...o, hashMatch: true } : o));
    expect(firstOf([], hashed)).toBe('file:os#2');
    expect(firstOf([], [hashed[0]!, hashed[2]!])).toBe('file:os#3');
    // One for another episode, read or not, is passed over.
    expect(
      firstOf([], options, { checks: { 'file:os#2': { hearing: false, problem: 'episode' } } }),
    ).toBe('file:os#1');
    expect(firstOf([track('t1', 'eng')], options, { remembered: 'file:os#3' })).toBe('file:os#3');
    // The stream's own track comes before the files, but not before the one picked by hand.
    expect(firstOf([track('t1', 'eng')], options)).toBe('track:t1');
  });

  it('passes over the stream’s own track of forced lines only, as over an unfit file', () => {
    const options = [option('os#1', 'eng')];
    const forced = { ...track('t1', 'eng', 'English (Forced)'), forced: true };
    expect(firstOf([forced], options)).toBe('file:os#1');
    expect(firstOf([forced, track('t2', 'eng')], options)).toBe('track:t2');
    // Nothing else left: the forced track.
    expect(firstOf([forced], options, { failed: ['file:os#1'] })).toBe('track:t1');
  });

  it('puts the notes before the release name, which a row may cut short', () => {
    expect(versionDetail(['Looks like another language'], 'Film.2023.1080p.BluRay-GROUP')).toBe(
      'Looks like another language · Film.2023.1080p.BluRay-GROUP',
    );
    expect(versionDetail(['Same release', 'For the hard of hearing'])).toBe(
      'Same release · For the hard of hearing',
    );
    // A subtitle file's extension says nothing: the name is shown without it.
    expect(
      versionDetail(['Linked to your video'], 'The.Last.of.Us.S01E01.1080p.WEB.H264-CAKES-HI.srt'),
    ).toBe('Linked to your video · The.Last.of.Us.S01E01.1080p.WEB.H264-CAKES-HI');
    expect(versionDetail([], 'Film.2023.1080p.BluRay-GROUP')).toBe('Film.2023.1080p.BluRay-GROUP');
    expect(versionDetail([])).toBeUndefined();
  });

  it('tells choices apart by kind as well as id, and Off is no version', () => {
    expect(sameChoice({ kind: 'file', key: 'a' }, { kind: 'file', key: 'a' })).toBe(true);
    expect(sameChoice({ kind: 'file', key: 'a' }, { kind: 'track', id: 'a' })).toBe(false);
    expect(sameChoice(null, null)).toBe(false);
  });

  it('names the language showing, or nothing when off', () => {
    const tracks = [track('t1', 'fre'), track('t2', '', 'Director’s notes')];
    const options = [option('os#1', 'eng')];
    expect(subtitlesValue({ choice: null, tracks, options })).toBeUndefined();
    expect(subtitlesValue({ choice: { kind: 'file', key: 'os#1' }, tracks, options })).toBe(
      'English',
    );
    expect(subtitlesValue({ choice: { kind: 'track', id: 't1' }, tracks, options })).toBe('French');
    expect(subtitlesValue({ choice: { kind: 'track', id: 't2' }, tracks, options })).toBe(
      'Director’s notes',
    );
  });

  it('matches against the stream’s file name and its title', () => {
    const entry = {
      stream: {
        behaviorHints: { filename: 'Film.mkv' },
        description: 'Film 1080p WEB-DL\n1.4 GB',
      },
    } as unknown as StreamEntry;
    expect(playingRelease(entry)).toEqual({ filename: 'Film.mkv', title: 'Film 1080p WEB-DL' });
    expect(playingRelease(null)).toEqual({});
  });
});
