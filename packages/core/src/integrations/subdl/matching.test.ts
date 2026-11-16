import { describe, expect, it } from 'vitest';
import { groupKeyOf } from '../../subtitles/agreement';
import { rankSubtitles } from '../../subtitles/rank';
import { madeForRelease, type MatchedFile, type VideoRelease } from '../../subtitles/versions';
import { FILM_RELEASE } from './fixtures';

/** SubDL's files go through release matching, ranking and files that agree as any addon's do. */
describe('a SubDL file', () => {
  const video: VideoRelease = { filename: `${FILM_RELEASE}.mkv`, title: 'Test Film' };
  const subdl: MatchedFile & { id: string } = {
    id: 'subdl',
    label: FILM_RELEASE,
    releaseName: 'Test.Film.2026.1080p.WEB-DL-GRPA',
  };
  const others: Array<MatchedFile & { id: string }> = [
    { id: 'os-1', label: 'Test.Film.2026.1080p.WEB-DL.DDP5.1.H.264-GRPB.srt' },
    { id: 'os-2', label: 'Test.Film.2026.1080p.BluRay.x264-GRPC.srt' },
  ];

  it('is made for the release it is named for', () => {
    expect(madeForRelease(subdl, video)).toBe(true);
    expect(others.some((file) => madeForRelease(file, video))).toBe(false);
  });

  it("ranks first over OpenSubtitles' files named for other groups", () => {
    const ranked = rankSubtitles([...others, subdl], {
      video,
      fit: () => undefined,
      hearing: false,
    });
    expect(ranked[0]!.id).toBe('subdl');
  });

  it('goes in one group with another file for the same release', () => {
    const twin = {
      label: 'Test.Film.2026.1080p.WEB-DL.DDP5.1.H.264-GRPA',
      releaseName: FILM_RELEASE,
    };
    expect(groupKeyOf(subdl)).toBe(groupKeyOf(twin));
    expect(groupKeyOf(subdl)).not.toBe(groupKeyOf(others[0]!));
  });
});
