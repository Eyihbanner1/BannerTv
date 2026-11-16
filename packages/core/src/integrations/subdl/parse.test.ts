import { describe, expect, it, vi } from 'vitest';
import { filmAnswer, filmRow, FILM_RELEASE, packRow, showAnswer } from './fixtures';
import { classifySubdlAnswer, parseSubdlFiles, SUBDL_MAX_FILES } from './parse';
import type { SubdlAsk } from './request';

const film: SubdlAsk = { type: 'movie', imdbId: 'tt9900001', languages: ['EN'] };
const episode: SubdlAsk = {
  type: 'tv',
  imdbId: 'tt9900002',
  season: 2,
  episode: 3,
  languages: ['EN'],
};

describe('classifySubdlAnswer', () => {
  const failure = (status: number, body: unknown) => {
    const outcome = classifySubdlAnswer(status, body, film);
    return 'failure' in outcome ? outcome.failure : `files ${outcome.files.length}`;
  };

  it('reads files from a 200 with a list', () => {
    expect(failure(200, filmAnswer())).toBe('files 1');
    expect(failure(200, { subtitles: [] })).toBe('files 0');
  });

  it('takes "can\'t find" as an answer with no files, whatever the status', () => {
    expect(failure(200, { status: false, error: "Can't find movie or tv" })).toBe('files 0');
    expect(failure(404, { status: false, message: "can't find any subtitle" })).toBe('files 0');
  });

  it('tells a refused key, a challenge, a limit, a slow-down and a server error', () => {
    expect(failure(401, { status: false, error: 'Missing API key' })).toBe('refused');
    expect(failure(401, undefined)).toBe('refused');
    expect(failure(403, { status: false, error: 'not_authorized' })).toBe('refused');
    expect(failure(403, { error: { code: 'unauthorized' } })).toBe('refused');
    expect(failure(403, { message: 'Invalid API key' })).toBe('refused');
    expect(failure(403, { message: 'Not authorised' })).toBe('refused');
    expect(failure(403, undefined)).toBe('challenge');
    expect(failure(403, '<html>Just a moment…</html>')).toBe('challenge');
    expect(failure(403, { error: 'banned_region' })).toBe('server');
    expect(failure(402, { error: 'payment' })).toBe('limit');
    expect(failure(429, { error: 'daily_limit' })).toBe('limit');
    expect(failure(429, { error: { code: 'api_download_limit_exceeded' } })).toBe('limit');
    expect(failure(429, { error: { code: 'quota_exceeded' } })).toBe('limit');
    expect(failure(429, { error: { code: 'rate_limit' } })).toBe('busy');
    expect(failure(429, undefined)).toBe('busy');
    expect(failure(500, { error: 'oops' })).toBe('server');
    expect(failure(503, undefined)).toBe('server');
    expect(failure(418, {})).toBe('server');
  });

  it('says a 200 that is not JSON or not an object is unreadable', () => {
    expect(failure(200, undefined)).toBe('invalid');
    expect(failure(200, 'text')).toBe('invalid');
    expect(failure(200, [1, 2])).toBe('invalid');
    expect(failure(200, { status: true })).toBe('invalid');
  });
});

describe('parseSubdlFiles', () => {
  it('lists a film row with its release names, label, id and fps', () => {
    const files = parseSubdlFiles(filmAnswer(), film);
    expect(files).toEqual([
      {
        id: '9000001-9100001',
        url: 'https://dl.subdl.com/subtitle/9000001-9100001.zip',
        lang: 'en',
        label: FILM_RELEASE,
        releases: [FILM_RELEASE, 'Test.Film.2026.1080p.WEBRip.x264-GRPB'],
        fps: 23.976,
      },
    ]);
    expect(files[0]!.hashMatch).toBeUndefined();
  });

  it('cleans release names, labels and fps', () => {
    const [file] = parseSubdlFiles(
      filmAnswer([
        filmRow({
          release_name: '',
          name: 'Test.Film.2026.720p.zip',
          releases: [' A ', 'A', '', 3, ...Array.from({ length: 30 }, (_, i) => `R${i}`)],
          fps: 5,
          url: 'https://dl.subdl.com/subtitle/9000003-9100003.zip',
        }),
      ]),
      film,
    );
    expect(file!.label).toBe('Test.Film.2026.720p');
    expect(file!.releases[0]).toBe('A');
    expect(file!.releases).toHaveLength(20);
    expect(file!.fps).toBeUndefined();
    expect(file!.url).toBe('https://dl.subdl.com/subtitle/9000003-9100003.zip');
  });

  it('drops junk, files of two languages and bad links', () => {
    const rows = [
      filmRow({ ai_translated: true }),
      filmRow({ release_name: 'Test.Film.2026.[TRAILER].WEB' }),
      filmRow({ comment: 'Machine translated from English' }),
      filmRow({ comment: 'google-translated' }),
      filmRow({ language: 'BG_EN' }),
      filmRow({ language: '' }),
      filmRow({ url: 'https://evil.example/subtitle/1-2.zip' }),
      filmRow({ url: '/subtitle/../../x' }),
      filmRow({ url: '/download/1-2.zip' }),
      filmRow({ url: '/subtitle/9000009' }),
      filmRow({ url: 42 }),
      null,
      'row',
    ];
    expect(parseSubdlFiles(filmAnswer(rows), film)).toEqual([]);
  });

  it("drops another season's rows, and a range pack outside the episode", () => {
    const rows = [
      packRow({ season: 1, unpack_files: [] }),
      packRow({ full_season: false, episode_from: 5, episode_end: 8, unpack_files: [] }),
      packRow({ full_season: false, episode_from: 4, episode_end: 4, unpack_files: [] }),
      packRow({
        url: '/subtitle/9000004-9100004.zip',
        full_season: false,
        episode_from: 1,
        episode_end: 6,
        unpack_files: [],
      }),
    ];
    const files = parseSubdlFiles(showAnswer(rows), episode);
    expect(files.map((file) => file.id)).toEqual(['9000004-9100004']);
  });

  it('lists up to three unpacked files of a film row', () => {
    const unpack = [1, 2, 3, 4].map((n) => ({
      name: `Test.Film.2026.Part${n}.srt`,
      url: `/subtitle/9000001/${9300000 + n}`,
      file_n_id: 9300000 + n,
    }));
    const files = parseSubdlFiles(
      filmAnswer([
        filmRow({
          unpack_files: [
            { name: 'Test.Film.nfo', url: '/subtitle/9000001/9300000' },
            { name: 'Test.Film.srt', url: '/elsewhere/1' },
            ...unpack,
          ],
        }),
      ]),
      film,
    );
    expect(files.map((file) => [file.id, file.url, file.label])).toEqual([
      [
        '9000001-9100001-9300001',
        'https://dl.subdl.com/subtitle/9000001/9300001',
        'Test.Film.2026.Part1',
      ],
      [
        '9000001-9100001-9300002',
        'https://dl.subdl.com/subtitle/9000001/9300002',
        'Test.Film.2026.Part2',
      ],
      [
        '9000001-9100001-9300003',
        'https://dl.subdl.com/subtitle/9000001/9300003',
        'Test.Film.2026.Part3',
      ],
    ]);
    expect(files[0]!.releases).toEqual(filmRow().releases);
  });

  it("takes a pack's one file for the episode, best said first", () => {
    const [file] = parseSubdlFiles(showAnswer([packRow()]), episode);
    expect(file).toMatchObject({
      id: '9000002-9100002-9200003',
      url: 'https://dl.subdl.com/subtitle/9000002/9200003',
      label: 'Test.Show.S02E03.1080p.WEB-DL-GRPA',
      season: 2,
      episode: 3,
    });
    // The name and the server both saying it beat the name alone, which beats the server alone.
    const ranked = (entries: Array<Record<string, unknown>>) =>
      parseSubdlFiles(showAnswer([packRow({ unpack_files: entries })]), episode)[0]?.url;
    const serverOnly = { name: 'Test.Show.Part.A.srt', url: '/subtitle/9000002/1', episode: 3 };
    const nameOnly = { name: 'Test.Show.S02E03.srt', url: '/subtitle/9000002/2', episode: 0 };
    const both = { name: 'Test.Show.2x03.srt', url: '/subtitle/9000002/3', episode: 3 };
    expect(ranked([serverOnly, nameOnly, both])).toBe('https://dl.subdl.com/subtitle/9000002/3');
    expect(ranked([serverOnly, nameOnly])).toBe('https://dl.subdl.com/subtitle/9000002/2');
    expect(ranked([serverOnly])).toBe('https://dl.subdl.com/subtitle/9000002/1');
  });

  it('never uses a file whose name says another episode, and lists nothing without the episode', () => {
    const contradicts = { name: 'Test.Show.S02E04.srt', url: '/subtitle/9000002/4', episode: 3 };
    const other = { name: 'Test.Show.S02E05.srt', url: '/subtitle/9000002/5', episode: 5 };
    const unknown = { name: 'Test.Show.extra.srt', url: '/subtitle/9000002/6', episode: null };
    expect(
      parseSubdlFiles(
        showAnswer([packRow({ unpack_files: [contradicts, other, unknown] })]),
        episode,
      ),
    ).toEqual([]);
  });

  it("takes an unpacked file that names no episode from a row for the episode's alone", () => {
    const single = {
      full_season: false,
      episode_from: 3,
      episode_end: 3,
      release_name: 'Test.Show.S02E03.1080p.WEB-DL-GRPA',
    };
    const plain = { name: 'English.srt', url: '/subtitle/9100001/1', episode: 0 };
    expect(
      parseSubdlFiles(showAnswer([packRow({ ...single, unpack_files: [plain] })]), episode),
    ).toEqual([
      expect.objectContaining({
        url: 'https://dl.subdl.com/subtitle/9100001/1',
        season: 2,
        episode: 3,
      }),
    ]);
    // A name for another episode is still never used, even in a row for this one.
    const contradicts = { name: 'Test.Show.S02E04.srt', url: '/subtitle/9100001/2', episode: 0 };
    expect(
      parseSubdlFiles(showAnswer([packRow({ ...single, unpack_files: [contradicts] })]), episode),
    ).toEqual([]);
  });

  it('falls back to the ZIP, with the episode in the link for packs only', () => {
    const files = parseSubdlFiles(
      showAnswer([
        packRow({ unpack_files: [] }),
        packRow({
          url: '/subtitle/9000005-9100005.zip',
          full_season: false,
          episode_from: 3,
          episode_end: 3,
          unpack_files: undefined,
          release_name: 'Test.Show.S02E03.720p.HDTV-GRPC',
        }),
      ]),
      episode,
    );
    expect(files.map((file) => [file.url, file.season, file.episode])).toEqual([
      ['https://dl.subdl.com/subtitle/9000002-9100002.zip#s2e3', 2, undefined],
      ['https://dl.subdl.com/subtitle/9000005-9100005.zip', 2, 3],
    ]);
    // A film's ZIP never carries an episode.
    expect(parseSubdlFiles(filmAnswer(), film)[0]!.url).not.toContain('#');
  });

  it('keeps no more than SUBDL_MAX_FILES, without the same link twice', () => {
    const rows = Array.from({ length: 80 }, (_, i) =>
      filmRow({ url: `/subtitle/${9000100 + i}-${9100100 + i}.zip` }),
    );
    rows.push(filmRow({ url: '/subtitle/9000100-9100100.zip' }));
    const files = parseSubdlFiles(filmAnswer(rows), film);
    expect(files).toHaveLength(SUBDL_MAX_FILES);
    expect(new Set(files.map((file) => file.url)).size).toBe(SUBDL_MAX_FILES);
  });

  it('never throws on a body that is not an answer', () => {
    for (const body of [
      undefined,
      null,
      1,
      'x',
      [],
      {},
      { subtitles: 'x' },
      { subtitles: [[], 1, {}] },
    ]) {
      expect(() => parseSubdlFiles(body, film)).not.toThrow();
      expect(() => parseSubdlFiles(body, episode)).not.toThrow();
    }
    const getter = {
      get url(): string {
        throw new Error('boom');
      },
    };
    expect(parseSubdlFiles({ subtitles: [getter, filmRow()] }, film)).toHaveLength(1);
  });

  it('uses the ZIPs when unpacked files are not preferred', async () => {
    vi.resetModules();
    vi.doMock('./request', async (original) => ({
      ...(await original<typeof import('./request')>()),
      SUBDL_PREFER_UNPACK: false,
    }));
    const parse = await import('./parse');
    const [file] = parse.parseSubdlFiles(showAnswer([packRow()]), episode);
    expect(file!.url).toBe('https://dl.subdl.com/subtitle/9000002-9100002.zip#s2e3');
    vi.doUnmock('./request');
    vi.resetModules();
  });
});
