import { describe, expect, it } from 'vitest';
import { pickSubtitleFile } from './subtitle-pick';

const video = { filename: 'Some.Film.2021.1080p.BluRay.x264-GROUP.mkv' };

const file = (url: string, lang: string, label?: string) => ({ url, lang, label });

describe('pickSubtitleFile', () => {
  it('prefers a file made for the release playing over the first in the list', () => {
    const offered = [
      file('a', 'eng', 'Some.Film.2021.720p.WEB-DL.AAC-OTHER'),
      file('b', 'eng', 'Some.Film.2021.1080p.BluRay.x264-GROUP'),
      file('c', 'fre', 'Some.Film.2021.1080p.BluRay.x264-GROUP'),
    ];
    expect(pickSubtitleFile(offered, 'en', new Set(), video)?.url).toBe('b');
    expect(pickSubtitleFile(offered, 'fr', new Set(), video)?.url).toBe('c');
  });

  it('keeps the list order when nothing matches, or the video gives no release name', () => {
    const offered = [file('a', 'eng', 'Other.Release.720p.WEB'), file('b', 'eng')];
    expect(pickSubtitleFile(offered, 'en', new Set(), video)?.url).toBe('a');
    const matching = [file('a', 'eng'), file('b', 'eng', 'Some.Film.2021.1080p.BluRay.x264-GROUP')];
    expect(pickSubtitleFile(matching, 'en', new Set(), {})?.url).toBe('a');
  });

  it('passes over files that failed, and gives none when all of them did', () => {
    const offered = [
      file('a', 'eng', 'Some.Film.2021.1080p.BluRay.x264-GROUP'),
      file('b', 'eng', 'Other.Release.720p.WEB'),
    ];
    expect(pickSubtitleFile(offered, 'en', new Set(['a']), video)?.url).toBe('b');
    expect(pickSubtitleFile(offered, 'en', new Set(['a', 'b']), video)).toBeUndefined();
    expect(pickSubtitleFile(offered, 'de', new Set(), video)).toBeUndefined();
  });
});
