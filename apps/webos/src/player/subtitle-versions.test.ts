import type { StreamEntry } from '@bannertv/core';
import { describe, expect, it } from 'vitest';
import type { SubtitleChoice, SubtitleStatus } from '../screens/player/use-subtitles';
import type { EngineTrack } from './engines/types';
import type { SubtitleOption } from './subtitles';
import {
  createOrderMemory,
  languageFirstPick,
  playingRelease,
  sameChoice,
  subtitlesValue,
  subtitleVersions,
  versionGroups,
  versionId,
  versionNote,
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

  it('says loading first, then whether it failed or was skipped, then whether it matches', () => {
    const video = { filename: 'Film.2024.1080p.WEB-DL.x264-GROUP.mkv' };
    const matching = {
      choice: { kind: 'file', key: 'os#1' } as const,
      lang: 'eng',
      source: 'OpenSubtitles v3',
      release: 'Film.2024.1080p.WEB-DL.x264-GROUP',
    };
    const other = { ...matching, release: 'Film.2024.720p.BluRay' };
    expect(versionNote(matching, true, 'loading', video)).toBe('loading');
    expect(versionNote(matching, true, 'failed', video)).toBe('failed');
    expect(versionNote(matching, false, 'failed', video)).toBe('skipped');
    expect(versionNote(matching, false, undefined, video)).toBe('matches');
    expect(versionNote(other, false, undefined, video)).toBeUndefined();
    expect(versionNote(matching, false, undefined, {})).toBeUndefined();
  });

  it('picks a language’s first version that has not failed, or its first when all have', () => {
    const versions = subtitleVersions(
      { tracks: [], options: [option('os#1', 'eng'), option('os#2', 'eng')] },
      IN_THE_STREAM,
    );
    const [group] = versionGroups(versions, null, createOrderMemory());
    const failing =
      (keys: string[]) =>
      (choice: NonNullable<SubtitleChoice>): SubtitleStatus | undefined =>
        choice.kind === 'file' && keys.indexOf(choice.key) !== -1 ? 'failed' : undefined;
    expect(languageFirstPick(group!, failing([])).choice).toEqual({ kind: 'file', key: 'os#1' });
    expect(languageFirstPick(group!, failing(['os#1'])).choice).toEqual({
      kind: 'file',
      key: 'os#2',
    });
    expect(languageFirstPick(group!, failing(['os#1', 'os#2'])).choice).toEqual({
      kind: 'file',
      key: 'os#1',
    });
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
