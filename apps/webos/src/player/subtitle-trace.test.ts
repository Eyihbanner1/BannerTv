import { afterEach, describe, expect, it } from 'vitest';
import {
  type AgreementAbstain,
  type AgreementTrace,
  forgetSubtitleTraces,
  recentSubtitleTraces,
  startSubtitleTrace,
  subtitleTraceRows,
  traceFiles,
  traceFirstLine,
  traceHash,
  traceHashLinked,
  traceAgreement,
  traceAlignment,
  traceReason,
  traceReference,
} from './subtitle-trace';

afterEach(() => forgetSubtitleTraces());

describe('the subtitles of the last few plays', () => {
  it('says what happened to each play, newest first, with no link', () => {
    expect(subtitleTraceRows()).toEqual([['Plays', 'none yet: play a video first']]);
    startSubtitleTrace('tt1375666', 1000);
    traceHash('tt1375666', { state: 'skipped', why: 'request headers' });
    traceFiles('tt1375666', ['eng', 'en', 'fre']);
    traceReason('tt1375666', 'best fit', 'eng');
    traceFirstLine(3400);
    startSubtitleTrace('tt3581920:1:1', 5000);
    traceHash('tt3581920:1:1', { state: 'read', ms: 412 });
    traceFiles('tt3581920:1:1', ['eng', 'eng', 'pob', 'spa', 'fre', 'ger', 'eng']);
    traceReason('tt3581920:1:1', 'linked to your video', 'pob', true);
    expect(subtitleTraceRows()).toEqual([
      [
        'tt3581920:1:1',
        'hash read in 0.4 s · files pt-br 1, en 3, de 1, +2 languages (7 in all) · pt-br, linked to your video, language picked · no line yet',
      ],
      [
        'tt1375666',
        'hash not tried (request headers) · files en 2, fr 1 (3 in all) · en, best fit · first line after 2.4 s',
      ],
    ]);
  });

  it('says how the hash went, and what a late one brought, in the words Diagnostics uses', () => {
    const rowFor = (outcome: Parameters<typeof traceHash>[1], linked?: number | null) => {
      forgetSubtitleTraces();
      startSubtitleTrace('tt6151526:1:6', 0);
      traceHash('tt6151526:1:6', outcome);
      if (linked !== undefined) traceHashLinked('tt6151526:1:6', linked);
      return subtitleTraceRows()[0]![1].split(' · ')[0];
    };
    expect(rowFor({ state: 'read', ms: 1400 })).toBe('hash read in 1.4 s');
    expect(rowFor({ state: 'read', ms: 3100, fellBack: 'end' })).toBe(
      'hash read in 3.1 s, the end through the stream’s link again',
    );
    // The size read refused at the link the first landed on: the end then went the same way.
    expect(rowFor({ state: 'read', ms: 3100, fellBack: 'size' })).toBe(
      'hash read in 3.1 s, the size and end through the stream’s link again',
    );
    expect(rowFor({ state: 'reading', askedAtMs: 2000 })).toBe(
      'hash still being read; files asked for without it after 2.0 s',
    );
    const late = { askedAtMs: 2000, askedAgain: 1 };
    expect(rowFor({ state: 'read', ms: 5100, late })).toBe('hash read in 5.1 s, asked again');
    expect(rowFor({ state: 'read', ms: 5100, late }, 1)).toBe(
      'hash read in 5.1 s, asked again: 1 file linked',
    );
    expect(rowFor({ state: 'read', ms: 5100, late }, 3)).toBe(
      'hash read in 5.1 s, asked again: 3 files linked',
    );
    expect(rowFor({ state: 'read', ms: 5100, late }, 0)).toBe(
      'hash read in 5.1 s, asked again: none linked',
    );
    // Asked again, and no answer came: not the same as an answer linking none.
    expect(rowFor({ state: 'read', ms: 5100, late }, null)).toBe(
      'hash read in 5.1 s, asked again: no answer',
    );
    expect(rowFor({ state: 'read', ms: 5100, late: { askedAtMs: 2000, askedAgain: 0 } })).toBe(
      'hash read in 5.1 s, after the files were asked for',
    );
    expect(rowFor({ state: 'failed', why: 'refused', step: 'end', ms: 300 })).toBe(
      'hash failed after 0.3 s (refused, end read)',
    );
    expect(rowFor({ state: 'failed', why: 'no size', step: 'size', ms: 300 })).toBe(
      'hash failed after 0.3 s (no size, size read)',
    );
    expect(rowFor({ state: 'failed', why: 'refused', step: 'start', ms: 300 })).toBe(
      'hash failed after 0.3 s (refused, start read)',
    );
    expect(
      rowFor({ state: 'failed', why: 'timed out', step: 'end', ms: 15000, askedAtMs: 2000 }),
    ).toBe(
      'hash failed after 15.0 s (timed out, end read); files asked for without it after 2.0 s',
    );
    // Linked files are counted only for a hash read late.
    expect(rowFor({ state: 'read', ms: 1400 }, 2)).toBe('hash read in 1.4 s');
  });

  it('keeps the play under study on the console line after a detour, as five are kept', () => {
    // As on the TV round: the play, a sports stream, the play again, then two more.
    for (const id of ['tt1:1:5', 'sports', 'tt1:1:5', 'tt1:1:6', 'tt2']) {
      startSubtitleTrace(id);
      traceFiles(id, ['eng']);
    }
    expect(recentSubtitleTraces().map((trace) => trace.videoId)).toEqual([
      'tt2',
      'tt1:1:6',
      'tt1:1:5',
      'sports',
      'tt1:1:5',
    ]);
  });

  it('keeps five plays, and drops one that saw nothing', () => {
    for (let i = 0; i < 7; i++) {
      startSubtitleTrace(`tt${i}`);
      traceFiles(`tt${i}`, ['eng']);
    }
    startSubtitleTrace('tt-empty');
    startSubtitleTrace('tt-next');
    expect(recentSubtitleTraces().map((trace) => trace.videoId)).toEqual([
      'tt-next',
      'tt6',
      'tt5',
      'tt4',
      'tt3',
    ]);
    // What comes for another video than the one playing is not kept.
    traceReason('tt6', 'off', null);
    expect(recentSubtitleTraces()[1]?.reason).toBeUndefined();
  });

  it('keeps no id that is a link', () => {
    startSubtitleTrace('https://cdn.example.com/film.mkv');
    traceReason('https://cdn.example.com/film.mkv', 'off', null);
    expect(JSON.stringify(recentSubtitleTraces())).not.toContain('example');
    expect(subtitleTraceRows()[0]).toEqual([
      'a link (not shown)',
      'hash: not asked yet · no files · off · no line yet',
    ]);
  });

  it('says what the files were lined up against, and what each run found, with no link', () => {
    startSubtitleTrace('tt0816692', 1000);
    traceFiles('tt0816692', ['eng', 'eng']);
    traceReference('tt0816692', 'linked');
    traceAlignment('tt0816692', 1, {
      language: 'eng',
      reference: 'linked',
      confidence: 'none',
      offset: 0,
      rate: 1,
      ms: 7.6,
    });
    traceAlignment('tt0816692', 0, {
      language: 'eng',
      reference: 'linked',
      confidence: 'sure',
      offset: -3.04,
      rate: 23.976 / 25,
      ms: 12.2,
    });
    traceReason('tt0816692', 'synced to your video', 'eng');
    expect(recentSubtitleTraces()[0]?.aligned?.[0]).toMatchObject({ confidence: 'sure', ms: 12.2 });
    expect(subtitleTraceRows()[0]).toEqual([
      'tt0816692',
      'hash: not asked yet · files en 2 (2 in all) · en, synced to your video · lined up against a file linked by hash: en sure −3.0 s ×0.9590 (12 ms), en none (8 ms) · no line yet',
    ]);
    // Nothing to line up against: said, with no runs.
    startSubtitleTrace('tt0816693');
    traceFiles('tt0816693', ['eng']);
    traceReference('tt0816693', null);
    expect(subtitleTraceRows()[0]?.[1]).toContain('lined up against nothing ·');
  });

  it('says what files that agree found, before what the files were lined up against', () => {
    startSubtitleTrace('tt8106366:1:6', 1000);
    traceFiles('tt8106366:1:6', ['eng', 'eng']);
    traceReason('tt8106366:1:6', 'best fit', 'eng');
    traceAgreement('tt8106366:1:6', { state: 'reading', read: 7, aligned: 21 });
    expect(subtitleTraceRows()[0]?.[1]).toBe(
      'hash: not asked yet · files en 2 (2 in all) · en, best fit · files that agree: reading, 7 read, 21 lined up · no line yet',
    );
    const done = { best: 9, second: 3, read: 28, aligned: 176, ms: 9400 };
    traceAgreement('tt8106366:1:6', { state: 'moved', ...done, service: 'amzn', offset: -8.73 });
    traceReference('tt8106366:1:6', 'agreed');
    traceAlignment('tt8106366:1:6', 0, {
      language: 'eng',
      reference: 'agreed',
      confidence: 'sure',
      offset: -8.73,
      rate: 1,
      ms: 52,
    });
    expect(subtitleTraceRows()[0]?.[1]).toBe(
      'hash: not asked yet · files en 2 (2 in all) · en, best fit · files that agree: 9 vs 3 (amzn), 28 read, 176 lined up in 9.4 s; moved −8.7 s · lined up against files that agree: en sure −8.7 s (52 ms) · no line yet',
    );
    expect(recentSubtitleTraces()[0]?.agreement).toMatchObject({ state: 'moved', best: 9 });
  });

  it('words each thing files that agree can do, or why they did nothing', () => {
    const said = (outcome: AgreementTrace) => {
      forgetSubtitleTraces();
      startSubtitleTrace('tt8106366:1:5');
      traceAgreement('tt8106366:1:5', outcome);
      return subtitleTraceRows()[0]![1]
        .split(' · ')
        .find((part) => part.startsWith('files that agree'));
    };
    const counts = { read: 12, aligned: 46, ms: 2400 };
    expect(said({ state: 'kept', best: 7, second: 3, ...counts })).toBe(
      'files that agree: 7 vs 3, 12 read, 46 lined up in 2.4 s; already in step',
    );
    expect(said({ state: 'shifted', best: 6, second: 2, ...counts, offset: 1.03 })).toBe(
      'files that agree: 6 vs 2, 12 read, 46 lined up in 2.4 s; moved +1.0 s by the group’s timing',
    );
    expect(said({ state: 'switched', best: 6, second: 3, ...counts, file: 4 })).toBe(
      'files that agree: 6 vs 3, 12 read, 46 lined up in 2.4 s; switched to file 4',
    );
    expect(
      said({ state: 'moved', best: 9, second: 3, ...counts, offset: -8.7, kept: 'drift' }),
    ).toBe('files that agree: 9 vs 3, 12 read, 46 lined up in 2.4 s; kept: a drift fix is on');
    const none = (why: AgreementAbstain) =>
      said({ state: 'none', why, ...counts })!.replace(', 12 read, 46 lined up in 2.4 s', '');
    expect(none({ kind: 'under', best: 2 })).toBe('files that agree: none, best 2 is under 3');
    expect(none({ kind: 'close', best: 4, second: 3 })).toBe(
      'files that agree: none, 4 vs 3 is too close',
    );
    expect(none({ kind: 'unlinked', score: 1 })).toBe(
      'files that agree: none, files scoring 1 aren’t lined up with the rest',
    );
    expect(none({ kind: 'apart', score: 1, offset: -11.94, rate: 1 })).toBe(
      'files that agree: none, files scoring 1 are 11.9 s apart',
    );
    expect(none({ kind: 'apart', score: 2, offset: 0.1, rate: 25 / 23.976 })).toBe(
      'files that agree: none, files scoring 2 are at another rate',
    );
    expect(none({ kind: 'rate' })).toBe('files that agree: none, this file is at another rate');
    expect(none({ kind: 'edition', edition: 'extended' })).toBe(
      'files that agree: none, the video’s edition (extended) isn’t named by them',
    );
    expect(none({ kind: 'wider', best: 11, second: 8 })).toBe(
      'files that agree: none, a wider read disagrees (11 vs 8)',
    );
    expect(none({ kind: 'unmatched', best: 6, second: 2 })).toBe(
      'files that agree: none, this file lines up with none of them (6 vs 2)',
    );
    expect(none({ kind: 'gave up', after: 'time' })).toBe(
      'files that agree: none, gave up after 120 s',
    );
    expect(none({ kind: 'gave up', after: 'files' })).toBe(
      'files that agree: none, gave up after 100 files',
    );
    expect(none({ kind: 'gave up', after: 'aligned' })).toBe(
      'files that agree: none, gave up after 1000 lined up',
    );
    expect(said({ state: 'none', why: { kind: 'under', best: 2 }, ...counts })).toBe(
      'files that agree: none, best 2 is under 3, 12 read, 46 lined up in 2.4 s',
    );
    expect(said({ state: 'not tried', why: 'recording' })).toBe(
      'files that agree: not tried (a cinema recording)',
    );
    expect(said({ state: 'not tried', why: 'no source' })).toBe(
      'files that agree: not tried (the video names no source)',
    );
  });
});
