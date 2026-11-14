import { describe, expect, it } from 'vitest';
import {
  discPart,
  fileReleaseMatch,
  hearingName,
  keepOrder,
  madeForRelease,
  numberBySource,
  otherEpisode,
  releaseMatch,
} from './versions';

describe('releaseMatch', () => {
  const episode = {
    filename: 'The.Long.Shore.S01E04.1080p.WEB-DL.DDP5.1.H.264-NTb.mkv',
    title: 'The Long Shore S01E04 1080p WEB-DL',
  };

  it('matches a release name that agrees on at least two facts and differs on none', () => {
    expect(releaseMatch('The.Long.Shore.S01E04.1080p.WEB-DL', episode)).toBe(true);
    // WEBRip and WEB-DL come from the same web source, with the same timing.
    expect(releaseMatch('The Long Shore S01E04 WEBRip', episode)).toBe(true);
    expect(releaseMatch('The.Long.Shore.S01E04.720p.HDTV-NTb.srt', episode)).toBe(false);
    expect(releaseMatch('The.Long.Shore.S01E05.1080p.WEB-DL', episode)).toBe(false);
  });

  it('says nothing when a name gives too little to go on', () => {
    expect(releaseMatch('Long.Shore.104', episode)).toBe(false);
    expect(releaseMatch('English', episode)).toBe(false);
    expect(releaseMatch('The.Long.Shore.S01E04', episode)).toBe(false);
    expect(releaseMatch(undefined, episode)).toBe(false);
    expect(releaseMatch('The.Long.Shore.S01E04.1080p.WEB-DL', {})).toBe(false);
  });

  it('reads the group after the last dash, never the DL of WEB-DL', () => {
    const film = { filename: 'Open.Movie.2160p.UHD.BluRay.x265-GROUPX.mkv' };
    expect(releaseMatch('Open.Movie.BluRay-GROUPX', film)).toBe(true);
    expect(releaseMatch('Open.Movie.BluRay-OTHER', film)).toBe(false);
    expect(releaseMatch('Open.Movie.4K.WEB-DL', film)).toBe(false);
  });

  it('fills what the file name leaves out from the title', () => {
    const video = { filename: 'movie-1080p.webm', title: 'Open Movie 1080p WEB-DL x264' };
    expect(releaseMatch('Open.Movie.1080p.WEB-DL', video)).toBe(true);
    expect(releaseMatch('Open.Movie.720p.BluRay', video)).toBe(false);
  });

  it('takes the file name over the title where they differ', () => {
    const video = { filename: 'Film.720p.BluRay.mkv', title: 'Film 1080p WEB' };
    expect(releaseMatch('Film.720p.BluRay', video)).toBe(true);
    expect(releaseMatch('Film.1080p.WEB', video)).toBe(false);
  });

  it('does not take a title word for the source when the name gives one', () => {
    const video = { filename: "Charlotte's.Web.1973.1080p.BluRay.x264-AMIABLE.mkv" };
    expect(releaseMatch("Charlotte's.Web.1973.1080p.BluRay", video)).toBe(true);
    expect(releaseMatch("Charlotte's.Web.1973.1080p.WEB-DL", video)).toBe(false);
  });
});

// Names from OpenSubtitles v3's answers and Torrentio's lists of 14 November 2026.
describe('fileReleaseMatch', () => {
  const lastOfUs = {
    filename: 'The.Last.of.Us.S01E01.1080p.WEB.H264-CAKES.mkv',
    season: 1,
    episode: 1,
  };

  it('reads a subtitle file’s own tags off the end before its group', () => {
    // For the hard of hearing: "HI" is no group.
    expect(
      fileReleaseMatch({ label: 'The.Last.of.Us.S01E01.1080p.WEB.H264-CAKES-HI.srt' }, lastOfUs),
    ).toBe('exact');
    // Its language, in any of the ways sites write it.
    for (const tag of ['.eng', '.en', '.English', ' ENG', '_en', '.en[cc]', '(SDH)', '.HI.v2']) {
      expect(
        fileReleaseMatch(
          { label: `The.Last.of.Us.S01E01.1080p.WEB.H264-CAKES${tag}.srt` },
          lastOfUs,
        ),
        tag,
      ).toBe('exact');
    }
    // A subtitle pack's numbering before its language.
    expect(
      fileReleaseMatch(
        { label: 'The.Last.of.Us.S01E01.1080p.WEB.H264-CAKES13_[spa].srt' },
        lastOfUs,
      ),
    ).toBe('exact');
    // Another group, its language read off, is no match: it was any group's WEB 1080p before.
    expect(
      fileReleaseMatch({ label: 'The.Last.of.Us.S01E01.1080p.WEB.H264-NTb.eng.srt' }, lastOfUs),
    ).toBeUndefined();
  });

  it('matches two names that are the same once read, though they give few facts', () => {
    const video = { filename: 'Inception.2010.TS.V2.XVID.FEEL-FREE.avi' };
    expect(fileReleaseMatch({ label: 'Inception.2010.TS.V2.XVID.FEEL-FREE.srt' }, video)).toBe(
      'exact',
    );
    expect(fileReleaseMatch({ label: 'Inception 2010 TS V2 XVID FEEL-FREE' }, video)).toBe('exact');
    // Not a bare title: "Inception" says nothing of the release.
    expect(
      fileReleaseMatch({ label: 'Inception.srt' }, { filename: 'Inception.mkv' }),
    ).toBeUndefined();
  });

  it('confirms a match by the group on both sides, and says when no group does', () => {
    const film = { filename: 'Dune.Part.Two.2024.1080p.WEB-DL.H264.AAC-InMemoryOfEVO.mp4' };
    expect(
      fileReleaseMatch({ label: 'Dune.Part.Two.2024.1080p.WEBRip.x264-InMemoryOfEVO' }, film),
    ).toBe('group');
    // The episode, resolution and source alone: another group's or service's file says as much.
    expect(
      fileReleaseMatch(
        { label: 'Dune.Part.Two.2024.1080p.AMZN.WEB-DL.DDP5.1.Atmos.H.264.srt' },
        film,
      ),
    ).toBe('loose');
    expect(fileReleaseMatch({ label: 'Dune.Part.Two.2024.1080p.WEB-DL - AnoZu' }, film)).toBe(
      'loose',
    );
    // Both groups must agree.
    expect(
      fileReleaseMatch({ label: 'Dune.Part.Two.2024.1080p.WEB-DL.x264-FLUX' }, film),
    ).toBeUndefined();
    // The same group in 720p and 1080p differs on a fact: still no match.
    expect(
      fileReleaseMatch({ label: 'Dune.Part.Two.2024.720p.WEB-DL.H264.AAC-InMemoryOfEVO' }, film),
    ).toBeUndefined();
  });

  it('reads the second release name the addon sends, unless it is a bare title', () => {
    const film = { filename: 'Dune.Part.Two.2024.1080p.WEB-DL.H264.AAC-InMemoryOfEVO.mp4' };
    expect(
      fileReleaseMatch(
        {
          label: 'Dune.Part.Two.2024.1080p.AMZN.WEB-DL.DDP5.1.Atmos.H.264.srt',
          releaseName: 'Dune.Part.Two.2024.1080p.WEB-DL.H264.AAC-InMemoryOfEVO',
        },
        film,
      ),
    ).toBe('exact');
    expect(
      fileReleaseMatch(
        {
          label: 'The_Shawshank_Redemption_(1994).CD1.aFLDp.srt',
          releaseName: 'Shawshank Redemption, The (1994)',
        },
        { filename: 'The.Shawshank.Redemption.1994.1080p.BluRay.x264-aFLDp.mkv' },
      ),
    ).toBeUndefined();
  });

  it('takes YTS and YIFY for one group, as they name their releases with a tag', () => {
    const yts = { filename: 'Inception (2010) [1080p] [BluRay] [5.1] [YTS.MX]' };
    expect(fileReleaseMatch({ label: 'Inception.2010.1080p.BluRay.x264-[YTS.AM].srt' }, yts)).toBe(
      'group',
    );
    expect(fileReleaseMatch({ label: 'Inception.2010.1080p.BRrip.x264.YIFY.srt' }, yts)).toBe(
      'group',
    );
    expect(
      fileReleaseMatch({ label: 'Inception.2010.1080p.BluRay.x264-SPARKS' }, yts),
    ).toBeUndefined();
  });

  it('tells copies made in the cinema from each other and from the web', () => {
    const cam = { filename: 'Inception.2010.CAM.XviD-FLAWL3SS.avi' };
    expect(fileReleaseMatch({ label: 'Inception.2010.HDCAM.XviD-FLAWL3SS' }, cam)).toBe('group');
    for (const other of ['TS', 'TELESYNC', 'TC', 'DVDSCR', 'HDTS', 'WEB-DL']) {
      expect(
        fileReleaseMatch({ label: `Inception.2010.${other}.XviD-FLAWL3SS` }, cam),
        other,
      ).toBeUndefined();
    }
    // A title word is not a source: "The.TS.Madison…" from the web.
    expect(
      fileReleaseMatch(
        { label: 'The.TS.Madison.Experience.2024.1080p.WEB-DL-GRP' },
        { filename: 'The.TS.Madison.Experience.2024.1080p.WEB-DL-GRP.mkv' },
      ),
    ).toBe('exact');
  });
});

describe('madeForRelease', () => {
  const video = { filename: 'The.Last.of.Us.S01E01.1080p.WEB.H264-CAKES.mkv' };

  it('takes a file found by the video’s hash, or named for the release with its group', () => {
    expect(madeForRelease({ label: 'Night_of_the_Living_Dead.srt', hashMatch: true }, video)).toBe(
      true,
    );
    expect(
      madeForRelease({ label: 'The.Last.of.Us.S01E01.1080p.WEB.H264-CAKES-HI.srt' }, video),
    ).toBe(true);
    // A loose match is not enough.
    expect(madeForRelease({ label: 'The.Last.of.Us.S01E01.1080p.WEB.srt' }, video)).toBe(false);
    expect(madeForRelease({}, video)).toBe(false);
  });
});

describe('otherEpisode', () => {
  const video = {
    filename: 'The.Last.of.Us.S01E01.1080p.WEB.H264-CAKES.mkv',
    season: 1,
    episode: 1,
  };

  it('tells a file for another episode or season by its names or its addon’s fields', () => {
    expect(otherEpisode({ label: 'The.Last.of.Us.S01E02.1080p.WEB.H264-CAKES.srt' }, video)).toBe(
      true,
    );
    expect(otherEpisode({ label: 'The.Last.of.Us.S02E01.srt' }, video)).toBe(true);
    expect(otherEpisode({ label: 'The.Last.of.Us.2x01.srt' }, video)).toBe(true);
    expect(otherEpisode({ season: 1, episode: 2 }, video)).toBe(true);
    expect(otherEpisode({ season: 2 }, video)).toBe(true);
    // The episode playing, a double episode with it, a season pack of its season, or nothing said.
    expect(
      otherEpisode({ label: 'The.Last.of.Us.S01E01.1080p.WEB.H264-CAKES-HI.srt' }, video),
    ).toBe(false);
    expect(otherEpisode({ label: 'The.Last.of.Us.S01E01E02.srt' }, video)).toBe(false);
    expect(otherEpisode({ label: 'The.Last.of.Us.S01.Complete.srt' }, video)).toBe(false);
    expect(otherEpisode({ label: 'English', season: 1, episode: 1 }, video)).toBe(false);
    // From the video's names when its id says nothing.
    expect(otherEpisode({ label: 'The.Last.of.Us.S01E02.srt' }, { filename: video.filename })).toBe(
      true,
    );
    // A film has no episode.
    expect(otherEpisode({ label: 'Show.S01E02.srt' }, { filename: 'Film.2021.1080p.mkv' })).toBe(
      false,
    );
  });
});

describe('discPart and hearingName', () => {
  const film = { filename: 'The.Shawshank.Redemption.1994.1080p.BluRay.x264-aFLDp.mkv' };

  it('reads which disc of a release split in two a file goes with', () => {
    for (const [name, part] of [
      ['The_Shawshank_Redemption_(1994).CD1.aFLDp.srt', 1],
      ['Film.1994.DVDRip.XviD-GRP.cd.2.srt', 2],
      ['Film 1994 CD 1.srt', 1],
      ['Film.1994.Disc 2.srt', 2],
      ['Film (1994) Part 1 of 2.srt', 1],
      ['Film.1994.DVDRip.XviD-GRP.part1.srt', 1],
    ] as const) {
      expect(discPart({ label: name }, film), name).toBe(part);
    }
    // Not a title's "Part" or a CD number in a word.
    expect(discPart({ label: 'Dune.Part.Two.2024.1080p.WEB-DL.srt' }, film)).toBeUndefined();
    expect(discPart({ label: 'Kill.Bill.Vol.1.2003.1080p.BluRay.srt' }, film)).toBeUndefined();
    expect(discPart({ label: 'CD12.Film.srt' }, film)).toBeUndefined();
    // The video is that disc: then it is that disc's file.
    expect(
      discPart({ label: 'Film.1994.CD1.srt' }, { filename: 'Film.1994.DVDRip.XviD-GRP.CD1.avi' }),
    ).toBeUndefined();
  });

  it('reads that a file is for the hard of hearing from its name, never from a title', () => {
    for (const name of [
      'The.Last.of.Us.S01E01.1080p.WEB.H264-CAKES-HI.srt',
      'Film.2021.1080p.BluRay.x264-GRP(SDH).srt',
      'Film.2021.1080p.WEB.en[cc].srt',
      'Film.2021.HI.C.updated.Addic7ed.com.srt',
      'Film 2021 hearing impaired.srt',
    ]) {
      expect(hearingName(name), name).toBe(true);
    }
    for (const name of [
      'Hi.Score.Girl.S01E01.srt',
      'Film.2021.NonHI.srt',
      'Chicago.srt',
      undefined,
    ]) {
      expect(hearingName(name), String(name)).toBe(false);
    }
  });
});

describe('numberBySource', () => {
  it('numbers the files of a source that sent several, and leaves a lone one plain', () => {
    const files = [
      { id: 'a', source: 'OpenSubtitles' },
      { id: 'b', source: 'SubDL' },
      { id: 'c', source: 'OpenSubtitles' },
      { id: 'd', source: 'OpenSubtitles' },
    ];
    expect(numberBySource(files).map(({ item, number }) => [item.id, number])).toEqual([
      ['a', 1],
      ['b', undefined],
      ['c', 2],
      ['d', 3],
    ]);
    expect(numberBySource([])).toEqual([]);
  });
});

describe('keepOrder', () => {
  it('keeps the rows shown in their places and puts new ones after them', () => {
    expect(keepOrder([], ['en', 'fr'])).toEqual(['en', 'fr']);
    // An addon earlier in the list answered late with German.
    expect(keepOrder(['en', 'fr'], ['de', 'en', 'fr', 'es'])).toEqual(['en', 'fr', 'de', 'es']);
    // Another stream's list: what it no longer has goes.
    expect(keepOrder(['en', 'fr', 'de'], ['fr', 'it'])).toEqual(['fr', 'it']);
    // Given twice, kept once.
    expect(keepOrder(['en'], ['fr', 'fr', 'en'])).toEqual(['en', 'fr']);
  });
});
