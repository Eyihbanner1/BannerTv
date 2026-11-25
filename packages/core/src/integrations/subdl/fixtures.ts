/**
 * Made-up SubDL answers for the tests, shaped like the real API's (names,
 * ids, language codes, release names): no row here was copied from SubDL,
 * and no subtitle text is kept. The key is obviously fake.
 */

export const FAKE_SUBDL_KEY = 'FAKE-SUBDL-KEY-0000';

export const FILM_RELEASE = 'Test.Film.2026.1080p.WEB-DL.DDP5.1.H.264-GRPA';

type Row = Record<string, unknown>;

export function filmRow(overrides: Row = {}): Row {
  return {
    release_name: FILM_RELEASE,
    name: 'SUBDL.com::Test.Film.2026.1080p.WEB-DL.DDP5.1.H.264-GRPA.zip',
    lang: 'english',
    author: 'test-author',
    url: '/subtitle/9000001-9100001.zip',
    subtitlePage: '/s/info/AAAA0001/test-film',
    season: 0,
    episode: null,
    language: 'EN',
    hi: false,
    episode_from: null,
    episode_end: 0,
    full_season: false,
    releases: [FILM_RELEASE, 'Test.Film.2026.1080p.WEBRip.x264-GRPB'],
    comment: 'Synced for the WEB-DL',
    fps: '23.976',
    ai_translated: false,
    ...overrides,
  };
}

export function filmAnswer(rows: unknown[] = [filmRow()]): Row {
  return {
    status: true,
    results: [
      { sd_id: 9000001, type: 'movie', name: 'Test Film', imdb_id: 'tt9900001', year: 2026 },
    ],
    subtitles: rows,
    totalPages: 1,
    currentPage: 1,
  };
}

/** A season 2 pack of "Test Show", with unpacked files for episodes 1 to 5. */
export function packRow(overrides: Row = {}): Row {
  const files = [1, 2, 3, 4, 5].map((episode) => ({
    name: `Test.Show.S02E0${episode}.1080p.WEB-DL-GRPA.srt`,
    url: `/subtitle/9000002/${9200000 + episode}`,
    file_n_id: 9200000 + episode,
    episode,
  }));
  return {
    release_name: 'Test.Show.S02.1080p.WEB-DL-GRPA',
    name: 'SUBDL.com::Test.Show.S02.1080p.WEB-DL-GRPA.zip',
    lang: 'english',
    url: '/subtitle/9000002-9100002.zip',
    season: 2,
    episode: null,
    language: 'EN',
    episode_from: 0,
    episode_end: 0,
    full_season: true,
    releases: ['Test.Show.S02.1080p.WEB-DL-GRPA'],
    unpack_files: files,
    ...overrides,
  };
}

export function showAnswer(rows: Row[]): Row {
  return {
    status: true,
    results: [{ sd_id: 9000002, type: 'tv', name: 'Test Show', imdb_id: 'tt9900002', year: 2025 }],
    subtitles: rows,
  };
}

/**
 * SubDL's v2 search signs every link with the caller's key, the row's and
 * each unpacked file's, and gives unpacked files ids of letters and digits.
 * Shaped like answers other open-source clients recorded in 2026; every id,
 * name and the key are made up.
 */
export const signed = (path: string) => `${path}?api_key=${FAKE_SUBDL_KEY}`;

export function v2FilmRow(overrides: Row = {}): Row {
  return {
    release_name: FILM_RELEASE,
    name: `${FILM_RELEASE}.zip`,
    lang: 'English',
    author: 'test-author',
    url: signed('/subtitle/9000011-9100011.zip'),
    subtitlePage: '/s/info/TestPage01',
    season: 0,
    episode: null,
    language: 'EN',
    framerate: 2,
    fps: '23.976',
    hi: false,
    episode_from: null,
    episode_end: 0,
    full_season: false,
    releases: [FILM_RELEASE],
    unpack_files: [
      {
        file_n_id: 'TestFile01',
        name: `${FILM_RELEASE}.srt`,
        release_name: FILM_RELEASE,
        season: 0,
        episode: 0,
        language: 'EN',
        hi: false,
        format: 'srt',
        size: 80000,
        md5: '00000000000000000000000000000000',
        url: signed('/subtitle/TestPage01/TestFile01'),
      },
    ],
    ...overrides,
  };
}

/**
 * A v2 row for season 2 of "Test Show" asked for episode 3: SubDL sends only
 * that episode's file from the pack, marked `from_pack`, its own season 0.
 */
export function v2PackRow(overrides: Row = {}): Row {
  return {
    release_name: 'Test.Show.S02.1080p.WEB-DL-GRPA',
    name: 'SUBDL::test-show-second-season-english-9100012.zip',
    lang: 'english',
    author: 'test-author',
    url: signed('/subtitle/9000012-9100012.zip'),
    subtitlePage: '/s/info/TestPage02',
    season: 2,
    episode: null,
    language: 'EN',
    framerate: 0,
    fps: null,
    hi: false,
    episode_from: null,
    episode_end: 0,
    full_season: true,
    unpack_files: [
      {
        file_n_id: 'TestFile23',
        name: '03 Test Episode Three.en.srt',
        release_name: '03 Test Episode Three.en',
        season: 0,
        episode: 3,
        language: 'EN',
        hi: false,
        format: 'srt',
        size: 40000,
        md5: '00000000000000000000000000000000',
        url: signed('/subtitle/TestPage02/TestFile23'),
        from_pack: true,
      },
    ],
    ...overrides,
  };
}
