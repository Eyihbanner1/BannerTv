import { afterEach, describe, expect, it } from 'vitest';
import {
  forgetSubtitleTraces,
  recentSubtitleTraces,
  startSubtitleTrace,
  subtitleTraceRows,
  traceFiles,
  traceFirstLine,
  traceHash,
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

  it('keeps three plays, and drops one that saw nothing', () => {
    for (let i = 0; i < 7; i++) {
      startSubtitleTrace(`tt${i}`);
      traceFiles(`tt${i}`, ['eng']);
    }
    startSubtitleTrace('tt-empty');
    startSubtitleTrace('tt-next');
    expect(recentSubtitleTraces().map((trace) => trace.videoId)).toEqual(['tt-next', 'tt6', 'tt5']);
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
});
