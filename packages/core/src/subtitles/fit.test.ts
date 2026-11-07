import { describe, expect, it } from 'vitest';
import {
  FRAME_RATE_RATIO,
  isForcedName,
  judgeScript,
  judgeSubtitleFit,
  judgeSubtitleFits,
  profileSubtitles,
  type SubtitleProfile,
} from './fit';
import { parseSubtitleText } from './parse';
import { fitTier, rankSubtitles } from './rank';
import type { Cue } from './types';

const cue = (start: number, end: number, text: string): Cue => ({
  start,
  end,
  lines: text.split('\n').map((line) => [{ text: line }]),
});

const ENGLISH = [
  'Where have you been all night?',
  'I waited for you until the sun came up.',
  'You know I had to finish the job first.',
  'Then you should have called me, at least once.',
];

/** A full file: `count` lines spread evenly from `from` to `to` seconds, each two seconds long. */
function dialogue(count: number, from: number, to: number, lines = ENGLISH): Cue[] {
  const step = (to - from - 2) / Math.max(1, count - 1);
  return Array.from({ length: count }, (_, i) =>
    cue(from + i * step, from + i * step + 2, lines[i % lines.length]!),
  );
}

const FILM_S = 2 * 3600;
const film = { seconds: FILM_S, exact: true };

describe('profileSubtitles', () => {
  it('counts the lines, where they start and end, and leaves out a stray credit long after the rest', () => {
    const cues = dialogue(600, 60, 6600).concat(cue(7400, 7404, 'Thanks for watching'));
    const profile = profileSubtitles(cues);
    expect(profile.lines).toBe(601);
    expect(profile.start).toBe(60);
    expect(profile.end).toBe(6600);
    // The latest ends, latest first, leave the stray out too.
    expect(profile.latestEnds).toHaveLength(3);
    expect(profile.latestEnds[0]).toBe(6600);
    expect(profile.latestEnds[1]).toBeLessThan(6600);
    expect(profileSubtitles([]).latestEnds).toEqual([]);
    // Six hundred lines of two seconds, apart from one another; the stray is left out.
    expect(profile.covered).toBeCloseTo(1200);
    expect(profileSubtitles([]).covered).toBe(0);
    // Each of the six hundred starts once the one before it has ended.
    expect(profile.apart).toBe(600);
    expect(profileSubtitles([]).apart).toBe(0);
    // A line drawn over another is not counted; one that starts as the last ends is.
    const drawnOver = [
      cue(10, 20, 'Into the wind we run together'),
      cue(10, 12, 'ka'),
      cue(12, 14, 'ze'),
      cue(20, 22, 'Where have you been?'),
    ];
    expect(profileSubtitles(drawnOver).apart).toBe(2);
    // A quiet stretch of a few minutes before the last words is the film's, not a stray.
    const quiet = dialogue(600, 60, 6000).concat(cue(6400, 6403, 'Goodbye.'));
    expect(profileSubtitles(quiet).end).toBe(6403);
  });

  it('counts the letters of each script, and the lines for the hard of hearing', () => {
    const profile = profileSubtitles([
      cue(1, 2, '[door creaks]'),
      cue(3, 4, 'JOHN: Over here!'),
      cue(5, 6, '♪ ♪'),
      cue(7, 8, '(sighs) I know.'),
      cue(9, 10, '♪ Hold me closer ♪'),
      cue(11, 12, 'Привет'),
    ]);
    expect(profile.hearingLines).toBe(4);
    expect(profile.scripts.cyrillic).toBe(6);
    expect(profile.scripts.latin).toBeGreaterThan(20);
  });

  it('reads the release name for SDH and forced files', () => {
    expect(profileSubtitles([], 'Film.2021.1080p.WEB.SDH').hearingLabel).toBe(true);
    expect(profileSubtitles([], 'Film.2021.Forced.English').forcedLabel).toBe(true);
    expect(profileSubtitles([], 'Film.2021.Signs.&.Songs').forcedLabel).toBe(true);
    expect(profileSubtitles([], 'Film.2021.Signs.&.Songs').songsLabel).toBe(true);
    expect(profileSubtitles([], 'Film.2021.Forced.English').songsLabel).toBe(false);
    // A film called Signs is not a forced file.
    expect(profileSubtitles([], 'Signs.2002.1080p.BluRay').forcedLabel).toBe(false);
    expect(profileSubtitles([], 'Hi.Score.Girl.S01E01').hearingLabel).toBe(false);
  });

  it('takes a name that says the file is not forced for no forced tag at all', () => {
    const forced = (label: string) => profileSubtitles([], label).forcedLabel;
    expect(forced('Film.2021.1080p.BluRay.Non-Forced')).toBe(false);
    expect(forced('Film 2021 (Full, no forced)')).toBe(false);
    expect(forced('Film.2021.Not.Forced')).toBe(false);
    expect(forced('Film.2021.non forced.srt')).toBe(false);
    // A full file with the forced lines in it still says forced: its lines tell (judgeSubtitleFit).
    expect(forced('Film.2021.Full+Forced')).toBe(true);
    expect(isForcedName('English (Non-Forced)')).toBe(false);
    expect(isForcedName('English, not forced')).toBe(false);
  });

  it('takes "Forced" at the start of a name for the film’s title, not a tag', () => {
    const forced = (label: string) => profileSubtitles([], label).forcedLabel;
    expect(forced('Forced.Vengeance.1982.1080p.BluRay.x264-GRP')).toBe(false);
    expect(forced('Forced Entry (1973) DVDRip')).toBe(false);
    expect(forced('forced.to.kill.1993.720p')).toBe(false);
    // A tag after the title still counts, and so does the word on its own.
    expect(forced('Forced.Vengeance.1982.1080p.FORCED')).toBe(true);
    expect(forced('Forced')).toBe(true);
    expect(forced('forced.srt')).toBe(true);
    expect(forced('[Forced] Film.2021.1080p')).toBe(true);
  });

  it('reads a stream track’s own name for forced lines, a leading "Forced" too', () => {
    expect(isForcedName('English (Forced)')).toBe(true);
    expect(isForcedName('Forced Subs')).toBe(true);
    expect(isForcedName('Signs & Songs')).toBe(true);
    expect(isForcedName('English SDH')).toBe(false);
    expect(isForcedName('Signs')).toBe(false);
    expect(isForcedName('')).toBe(false);
  });
});

describe('judgeScript', () => {
  const english = profileSubtitles(dialogue(40, 0, 400));
  const russian = profileSubtitles(
    dialogue(40, 0, 400, ['Где ты был всю ночь?', 'Я ждала тебя до самого утра.']),
  );
  const japanese = profileSubtitles(
    dialogue(40, 0, 400, ['どこに行ってたの？', 'ずっと待ってたのよ、朝まで。']),
  );
  const chinese = profileSubtitles(
    dialogue(40, 0, 400, ['你整晚去哪儿了？', '我一直等你到天亮。']),
  );

  it('takes a file in the language’s own script', () => {
    expect(judgeScript(english, 'eng')).toBe('right');
    expect(judgeScript(russian, 'rus')).toBe('right');
    expect(judgeScript(japanese, 'jpn')).toBe('right');
    expect(judgeScript(chinese, 'chi')).toBe('right');
    expect(judgeScript(chinese, 'zht')).toBe('right');
    // Serbian is written in both.
    expect(judgeScript(russian, 'srp')).toBe('right');
    expect(judgeScript(english, 'scc')).toBe('right');
  });

  it('knows a file in another script for another language', () => {
    expect(judgeScript(russian, 'eng')).toBe('wrong');
    expect(judgeScript(english, 'rus')).toBe('wrong');
    expect(judgeScript(english, 'ara')).toBe('wrong');
    // Chinese has no kana; Japanese is full of them.
    expect(judgeScript(chinese, 'jpn')).toBe('wrong');
    expect(judgeScript(japanese, 'chi')).toBe('wrong');
  });

  it('says nothing with too few letters, or for a language whose script it does not know', () => {
    expect(judgeScript(profileSubtitles([cue(1, 2, 'Привет')]), 'eng')).toBe('unknown');
    expect(judgeScript(russian, 'und')).toBe('unknown');
    expect(judgeScript(russian, 'xyz')).toBe('unknown');
  });

  it('takes a file with English and Chinese lines for either', () => {
    const both = profileSubtitles(
      dialogue(40, 0, 400, ['你整晚去哪儿了？', 'Where have you been all night?']),
    );
    expect(judgeScript(both, 'eng')).toBe('right');
    expect(judgeScript(both, 'zhe')).toBe('right');
  });

  it('counts a Chinese, Japanese or Korean character as three letters, so short lines next to English ones count', () => {
    // Each Chinese line is about a ninth of the letters, as a short line goes.
    const chinese = profileSubtitles(
      dialogue(40, 0, 400, ['相信我', 'You have to trust me on this one.']),
    );
    expect(judgeScript(chinese, 'zhe')).toBe('right');
    expect(judgeScript(chinese, 'chi')).toBe('right');
    expect(judgeScript(chinese, 'eng')).toBe('right');
    // Still no kana: not Japanese.
    expect(judgeScript(chinese, 'jpn')).toBe('wrong');
    const japanese = profileSubtitles(
      dialogue(40, 0, 400, ['待ってた', 'I waited for you until the sun came up.']),
    );
    expect(judgeScript(japanese, 'jpn')).toBe('right');
    // Kana among the kanji, however much English is next to them: not Chinese.
    expect(judgeScript(japanese, 'chi')).toBe('wrong');
    const korean = profileSubtitles(
      dialogue(40, 0, 400, ['날 믿어', 'You have to trust me on this one.']),
    );
    expect(judgeScript(korean, 'kor')).toBe('right');
    // A few Chinese characters in an English file do not make it Chinese.
    const names = profileSubtitles(
      dialogue(40, 0, 400, ['Where have you been all night, 李?', ...ENGLISH]),
    );
    expect(judgeScript(names, 'chi')).toBe('wrong');
  });
});

describe('judgeSubtitleFit', () => {
  const full = profileSubtitles(dialogue(1300, 30, FILM_S - 360));

  it('takes a full file ending before the end titles as it is: ending early is not a drift', () => {
    expect(judgeSubtitleFit(full, film, 'en')).toEqual({
      script: 'right',
      signs: false,
      hearing: false,
      length: 'fits',
      coverage: (FILM_S - 360) / FILM_S,
      unfit: false,
    });
    // Ten minutes of end titles, and still no drift.
    const early = profileSubtitles(dialogue(1300, 30, FILM_S - 600));
    expect(judgeSubtitleFit(early, film, 'en')).toMatchObject({ length: 'fits', unfit: false });
    expect(judgeSubtitleFit(early, film, 'en').drift).toBeUndefined();
  });

  it('knows a file of signs only, by how few lines it has for the video’s length', () => {
    const signs = profileSubtitles(dialogue(40, 300, FILM_S - 900));
    expect(judgeSubtitleFit(signs, film, 'en')).toMatchObject({ signs: true, unfit: true });
    // The title's running time is enough to tell.
    expect(judgeSubtitleFit(signs, { seconds: FILM_S, exact: false }, 'en').signs).toBe(true);
    // With no length at all, nothing is said.
    expect(judgeSubtitleFit(signs, { exact: false }, 'en')).toMatchObject({
      signs: false,
      unfit: false,
    });
    // Nor for a clip too short to judge.
    expect(judgeSubtitleFit(signs, { seconds: 40, exact: true }, 'en').signs).toBe(false);
    // A forced file says so in its release name.
    const forced = profileSubtitles(dialogue(400, 30, 7000), 'Film.2021.FORCED');
    expect(judgeSubtitleFit(forced, { exact: false }, 'en').unfit).toBe(true);
    expect(judgeSubtitleFit(forced, film, 'en')).toMatchObject({ signs: true, unfit: true });
  });

  it('trusts a name that says signs and songs, however many lines the file has', () => {
    const songs = profileSubtitles(dialogue(1300, 30, FILM_S - 360), 'Film.2021.Signs.&.Songs');
    expect(judgeSubtitleFit(songs, film, 'en')).toMatchObject({ signs: true, unfit: true });
    expect(judgeSubtitleFit(songs, { seconds: FILM_S, exact: false }, 'en').signs).toBe(true);
    expect(judgeSubtitleFit(songs, { exact: false }, 'en').signs).toBe(true);
  });

  it('trusts a name that says forced only while the file has fewer lines than a full one', () => {
    // As many lines as a full file: one, with the forced lines in it.
    for (const label of ['Film.2021.Forced', 'Film.2021.Full+Forced']) {
      const named = profileSubtitles(dialogue(1300, 30, FILM_S - 360), label);
      expect(judgeSubtitleFit(named, film, 'en')).toMatchObject({ signs: false, unfit: false });
      expect(judgeSubtitleFit(named, { seconds: FILM_S, exact: false }, 'en').signs).toBe(false);
      // With no length to judge its lines by, the name is trusted.
      expect(judgeSubtitleFit(named, { exact: false }, 'en').signs).toBe(true);
    }
    // Under five lines a minute, the name is trusted.
    const few = profileSubtitles(dialogue(500, 30, FILM_S - 360), 'Film.2021.Forced');
    expect(judgeSubtitleFit(few, film, 'en')).toMatchObject({ signs: true, unfit: true });
    // A name that says the file is not forced is not trusted as forced, whatever is known.
    for (const label of ['Film.2021.1080p.BluRay.Non-Forced', 'Film 2021 (Full, no forced)']) {
      const full = profileSubtitles(dialogue(1300, 30, FILM_S - 360), label);
      expect(judgeSubtitleFit(full, film, 'en')).toMatchObject({ signs: false, unfit: false });
      expect(judgeSubtitleFit(full, { exact: false }, 'en').signs).toBe(false);
    }
    // A film whose title starts with the word is still judged by its lines.
    const title = profileSubtitles(dialogue(1300, 30, FILM_S - 360), 'Forced.Vengeance.1982.1080p');
    expect(judgeSubtitleFit(title, film, 'en')).toMatchObject({ signs: false, unfit: false });
  });

  it('knows a file in another script, and passes it over', () => {
    const russian = profileSubtitles(
      dialogue(1300, 30, FILM_S - 360, ['Где ты был всю ночь?', 'Я ждала тебя до самого утра.']),
    );
    expect(judgeSubtitleFit(russian, film, 'en')).toMatchObject({ script: 'wrong', unfit: true });
  });

  it('knows a file for the hard of hearing, and not a plain one with a few sounds and songs', () => {
    const lines = [...ENGLISH, '[door creaks]', 'MARY: Who is it?', ...ENGLISH, '(sighs)'];
    const sdh = profileSubtitles(dialogue(1300, 30, FILM_S - 360, lines));
    expect(judgeSubtitleFit(sdh, film, 'en').hearing).toBe(true);
    const plain = dialogue(1300, 30, FILM_S - 360);
    for (let i = 0; i < 20; i++)
      plain[i * 50]!.lines = [[{ text: '♪ Hold me closer, tiny dancer ♪' }]];
    plain[700]!.lines = [[{ text: '[in French] Where is he?' }]];
    expect(judgeSubtitleFit(profileSubtitles(plain), film, 'en').hearing).toBe(false);
    expect(judgeSubtitleFit(full, film, 'en').hearing).toBe(false);
  });

  it('knows a file that covers only part of the film', () => {
    const half = profileSubtitles(dialogue(700, 30, 3700));
    expect(judgeSubtitleFit(half, film, 'en')).toMatchObject({ length: 'short', unfit: false });
    expect(judgeSubtitleFit(half, { seconds: FILM_S, exact: false }, 'en').length).toBe('short');
  });

  it('fixes a file timed for film speed on a faster (PAL) video, by its lines running past the end', () => {
    // The PAL video is 4% shorter; the file still has the film-speed timing.
    const pal = { seconds: FILM_S / FRAME_RATE_RATIO, exact: true };
    const filmSpeed = profileSubtitles(dialogue(1300, 30, FILM_S - 100));
    expect(judgeSubtitleFit(filmSpeed, pal, 'en')).toMatchObject({
      length: 'fits',
      drift: 'behind',
      unfit: false,
    });
    // Only the video's own length tells: the title's running time is rounded.
    const fromPage = judgeSubtitleFit(filmSpeed, { seconds: pal.seconds, exact: false }, 'en');
    expect(fromPage.drift).toBeUndefined();
    expect(fromPage.length).toBe('fits');
  });

  it('takes no drift from a lone late line, or from lines just past the end', () => {
    // A translator's credit just after the video's end: the ad filter knows only English ones.
    const spanish = ['¿Dónde estuviste toda la noche?', 'Te esperé hasta que salió el sol.'];
    const credit = profileSubtitles(
      dialogue(1300, 30, 6785, spanish).concat(cue(7226, 7230, 'Traducido por Juan')),
    );
    expect(credit.end).toBe(7230);
    expect(judgeSubtitleFit(credit, film, 'es')).toMatchObject({ length: 'fits', unfit: false });
    expect(judgeSubtitleFit(credit, film, 'es').drift).toBeUndefined();
    // The same credit much later, past half of what a drift gives, is still one line.
    const lateCredit = profileSubtitles(
      dialogue(1300, 30, 7000).concat(cue(7360, 7364, 'Subtitulado por Juan')),
    );
    expect(lateCredit.latestEnds[0]).toBe(7364);
    expect(lateCredit.latestEnds[1]).toBeCloseTo(7000);
    expect(judgeSubtitleFit(lateCredit, film, 'en').drift).toBeUndefined();
    // A 45-minute episode whose lines end half a minute after it: another release's ending.
    const episode = { seconds: 2700, exact: true };
    const teaser = profileSubtitles(dialogue(500, 20, 2730));
    expect(judgeSubtitleFit(teaser, episode, 'en')).toMatchObject({ length: 'fits' });
    expect(judgeSubtitleFit(teaser, episode, 'en').drift).toBeUndefined();
    // Lines running on well past its end, line after line, are a drift.
    const behind = profileSubtitles(dialogue(500, 20, 2780));
    expect(judgeSubtitleFit(behind, episode, 'en').drift).toBe('behind');
  });

  it('says when its lines run on past the end, line after line, for other files to judge', () => {
    const episode = { seconds: 1320, exact: true };
    // 26 s past a 22-minute episode: too little for a drift on its own.
    const past = judgeSubtitleFit(profileSubtitles(dialogue(370, 20, 1346)), episode, 'en');
    expect(past).toMatchObject({ length: 'fits', runsOn: true });
    expect(past.drift).toBeUndefined();
    // A second past the end, or one late line, is not lines running on.
    const justPast = profileSubtitles(dialogue(370, 20, 1321));
    expect(judgeSubtitleFit(justPast, episode, 'en').runsOn).toBeUndefined();
    const credit = profileSubtitles(
      dialogue(370, 20, 1300).concat(cue(1340, 1344, 'Translated by Juan')),
    );
    expect(judgeSubtitleFit(credit, episode, 'en').runsOn).toBeUndefined();
    // Nor is anything said with only the title's running time.
    const fromPage = { seconds: 1320, exact: false };
    expect(
      judgeSubtitleFit(profileSubtitles(dialogue(370, 20, 1346)), fromPage, 'en').runsOn,
    ).toBeUndefined();
  });

  it('takes no drift from a next-episode preview under a minute long after a short episode', () => {
    // A 24-minute episode; the file is timed for the airing, with a preview after the end.
    const episode = { seconds: 1420, exact: true };
    const preview = Array.from({ length: 6 }, (_, i) =>
      cue(1428 + i * 5, 1433 + i * 5, `Next time: part ${i + 1}`),
    );
    const aired = profileSubtitles(dialogue(320, 20, 1400).concat(preview));
    expect(aired.end).toBe(1458);
    expect(judgeSubtitleFit(aired, episode, 'en')).toMatchObject({ length: 'fits', unfit: false });
    expect(judgeSubtitleFit(aired, episode, 'en').drift).toBeUndefined();
  });

  it('takes a few seconds past the end as a release’s difference, and far past it as another cut', () => {
    const justPast = profileSubtitles(dialogue(1300, 30, FILM_S + 6));
    expect(judgeSubtitleFit(justPast, film, 'en')).toMatchObject({ length: 'fits' });
    expect(judgeSubtitleFit(justPast, film, 'en').drift).toBeUndefined();
    const extended = profileSubtitles(dialogue(1500, 30, FILM_S * 1.12));
    expect(judgeSubtitleFit(extended, film, 'en')).toMatchObject({ length: 'long', unfit: false });
    expect(judgeSubtitleFit(extended, film, 'en').drift).toBeUndefined();
  });

  it('judges no length rule on a live broadcast or a clip', () => {
    for (const video of [{ exact: true }, { seconds: 120, exact: true }]) {
      const fit = judgeSubtitleFit(full, video, 'en');
      expect(fit.length).toBeUndefined();
      expect(fit.coverage).toBeUndefined();
      expect(fit.unfit).toBe(false);
    }
  });
});

describe('judgeSubtitleFits', () => {
  const at = (end: number): SubtitleProfile => profileSubtitles(dialogue(1300, 30, end));
  const consensus = FILM_S - 480;

  it('never takes a file ending about 4% before two others that agree for one getting ahead', () => {
    const fits = judgeSubtitleFits(
      [
        { id: 'pal', profile: at(consensus / FRAME_RATE_RATIO) },
        { id: 'a', profile: at(consensus) },
        { id: 'b', profile: at(consensus + 30) },
      ],
      film,
      'en',
    );
    for (const id of ['pal', 'a', 'b']) {
      expect(fits.get(id)).toMatchObject({ length: 'fits', unfit: false });
      expect(fits.get(id)!.drift).toBeUndefined();
    }
  });

  it('leaves the one file timed for a PAL video as it is, next to two timed for film speed', () => {
    // A two-hour film as a PAL rip: two files are timed for the film-speed
    // releases and hide their drift in the end titles; the third is right.
    const video = { seconds: 6905, exact: true };
    const fits = judgeSubtitleFits(
      [
        { id: 'a', profile: at(6778) },
        { id: 'b', profile: at(6782) },
        { id: 'right', profile: at(6502) },
      ],
      video,
      'en',
    );
    expect(fits.get('right')).toMatchObject({ length: 'fits', unfit: false });
    expect(fits.get('right')!.drift).toBeUndefined();
  });

  it('leaves a plain file that stops at the last spoken line, next to two that caption the song over the end titles', () => {
    const lyrics = (end: number) =>
      dialogue(1300, 30, 6880).concat(
        Array.from({ length: 30 }, (_, i) => {
          const start = 6890 + ((end - 6892) * i) / 29;
          return cue(start, start + 2, '♪ And the night goes on ♪');
        }),
      );
    const fits = judgeSubtitleFits(
      [
        { id: 'plain', profile: at(6885) },
        { id: 'songs1', profile: profileSubtitles(lyrics(7178)) },
        { id: 'songs2', profile: profileSubtitles(lyrics(7182)) },
      ],
      film,
      'en',
    );
    expect(fits.get('plain')).toMatchObject({ length: 'fits', unfit: false });
    expect(fits.get('plain')!.drift).toBeUndefined();
  });

  it('says nothing on thin evidence', () => {
    const pal = { id: 'pal', profile: at(consensus / FRAME_RATE_RATIO) };
    const judge = (others: Array<{ id: string; profile: SubtitleProfile }>, video = film) =>
      judgeSubtitleFits([pal, ...others], video, 'en').get('pal')!.drift;
    // One other file: either of the two could be the one that drifts.
    expect(judge([{ id: 'a', profile: at(consensus) }])).toBeUndefined();
    // Two others that do not agree.
    expect(
      judge([
        { id: 'a', profile: at(consensus) },
        { id: 'b', profile: at(consensus - 150) },
      ]),
    ).toBeUndefined();
    // Another file ends with it: two releases' timing, not a drift.
    expect(
      judge([
        { id: 'a', profile: at(consensus) },
        { id: 'b', profile: at(consensus + 20) },
        { id: 'c', profile: at(consensus / FRAME_RATE_RATIO + 10) },
      ]),
    ).toBeUndefined();
    // The title's running time only.
    expect(
      judge(
        [
          { id: 'a', profile: at(consensus) },
          { id: 'b', profile: at(consensus + 30) },
        ],
        { seconds: FILM_S, exact: false },
      ),
    ).toBeUndefined();
    // Files that end long before the video tell nothing of where the last line goes.
    expect(
      judge([
        { id: 'a', profile: at(FILM_S - 1500) },
        { id: 'b', profile: at(FILM_S - 1480) },
      ]),
    ).toBeUndefined();
  });

  it('takes a file running past the end for another cut, not a drift, when others agree elsewhere', () => {
    const episode = { seconds: 2700, exact: true };
    const ending = (end: number) => profileSubtitles(dialogue(500, 20, end));
    // A longer ending (a teaser for the next episode) runs on a minute past the others'.
    const longer = judgeSubtitleFits(
      [
        { id: 'teaser', profile: ending(2765) },
        { id: 'a', profile: ending(2690) },
        { id: 'b', profile: ending(2700) },
      ],
      episode,
      'en',
    );
    expect(longer.get('teaser')).toMatchObject({ length: 'long', unfit: false });
    expect(longer.get('teaser')!.drift).toBeUndefined();
    // Alone, the same file is taken for one timed for film speed.
    expect(
      judgeSubtitleFits([{ id: 'teaser', profile: ending(2765) }], episode, 'en').get('teaser')!
        .drift,
    ).toBe('behind');
    // About 4% after the others' end: a drift indeed.
    const drifting = judgeSubtitleFits(
      [
        { id: 'film', profile: ending(2650 * FRAME_RATE_RATIO) },
        { id: 'a', profile: ending(2650) },
        { id: 'b', profile: ending(2655) },
      ],
      episode,
      'en',
    );
    expect(drifting.get('film')).toMatchObject({ length: 'fits', drift: 'behind' });
    expect(drifting.get('a')!.drift).toBeUndefined();
  });

  it('fixes a short episode’s file that runs on past the end, when two others agree on an end about 4% before', () => {
    // On its own the file runs under a minute past the 24-minute episode: no drift.
    const episode = { seconds: 1420, exact: true };
    const ending = (end: number) => profileSubtitles(dialogue(320, 20, end));
    const drifting = ending(1390 * FRAME_RATE_RATIO);
    expect(judgeSubtitleFit(drifting, episode, 'en').drift).toBeUndefined();
    const fits = judgeSubtitleFits(
      [
        { id: 'film', profile: drifting },
        { id: 'a', profile: ending(1390) },
        { id: 'b', profile: ending(1392) },
      ],
      episode,
      'en',
    );
    expect(fits.get('film')).toMatchObject({ length: 'fits', drift: 'behind', unfit: false });
    expect(fits.get('a')!.drift).toBeUndefined();
    // Running on past the end by other than a drift, when the others agree: another cut.
    const longer = judgeSubtitleFits(
      [
        { id: 'longer', profile: ending(1445) },
        { id: 'a', profile: ending(1400) },
        { id: 'b', profile: ending(1402) },
      ],
      episode,
      'en',
    );
    expect(longer.get('longer')).toMatchObject({ length: 'long', unfit: false });
    expect(longer.get('longer')!.drift).toBeUndefined();
    // A lone late line, a translator's credit, is not lines running on.
    const credit = profileSubtitles(
      dialogue(320, 20, 1395).concat(cue(1440, 1444, 'Translated by Juan')),
    );
    const withCredit = judgeSubtitleFits(
      [
        { id: 'credit', profile: credit },
        { id: 'a', profile: ending(1400) },
        { id: 'b', profile: ending(1402) },
      ],
      episode,
      'en',
    );
    expect(withCredit.get('credit')).toMatchObject({ length: 'fits', unfit: false });
    expect(withCredit.get('credit')!.drift).toBeUndefined();
  });

  it('counts neither a drifting file nor one of signs among the files that agree', () => {
    const episode = { seconds: 2700, exact: true };
    const ending = (end: number) => profileSubtitles(dialogue(500, 20, end));
    const fits = judgeSubtitleFits(
      [
        { id: 'teaser', profile: ending(2765) },
        { id: 'other', profile: ending(2770) },
        { id: 'a', profile: ending(2690) },
        { id: 'signs', profile: profileSubtitles(dialogue(30, 300, 2690)) },
      ],
      episode,
      'en',
    );
    // Only one file that fits ends before the video does: no agreement, each judged on its own.
    expect(fits.get('teaser')!.drift).toBe('behind');
    expect(fits.get('other')!.drift).toBe('behind');
    expect(fits.get('signs')!.unfit).toBe(true);
  });

  it('knows a file with under half the lines of the others for one covering only part: a forced file', () => {
    // A 153-minute film with long German and French scenes.
    const video = { seconds: 153 * 60, exact: true };
    const sdhLines = [...ENGLISH, '[speaking German]', 'HANS: Wo ist er?', ...ENGLISH, '(sighs)'];
    const sdh = () => profileSubtitles(dialogue(1800, 30, video.seconds - 300, sdhLines));
    const files = [
      { id: 'forced', profile: profileSubtitles(dialogue(400, 600, video.seconds - 900)) },
      { id: 'sdh1', profile: sdh() },
      { id: 'sdh2', profile: sdh() },
    ];
    const fits = judgeSubtitleFits(files, video, 'en');
    expect(fits.get('forced')).toMatchObject({ length: 'short', unfit: false });
    expect(fits.get('forced')!.drift).toBeUndefined();
    expect(fits.get('sdh1')).toMatchObject({ length: 'fits', hearing: true });
    // It ranks below both full files, whose lines are for the hard of hearing.
    expect(fitTier(fits.get('forced'), false)).toBeGreaterThan(fitTier(fits.get('sdh1'), false));
    // The title's running time is enough to tell.
    const fromPage = judgeSubtitleFits(files, { seconds: video.seconds, exact: false }, 'en');
    expect(fromPage.get('forced')!.length).toBe('short');
    // On its own, nothing tells.
    expect(judgeSubtitleFits(files.slice(0, 1), video, 'en').get('forced')!.length).toBe('fits');
    // Nor on a live broadcast or a clip.
    expect(judgeSubtitleFits(files, { exact: true }, 'en').get('forced')!.length).toBeUndefined();
  });

  it('knows a forced file on an episode, even one that runs past the end, and drops its drift', () => {
    const episode = { seconds: 42 * 60, exact: true };
    // Its last three lines run on well past the end, as a drift's would.
    const forced = profileSubtitles(
      dialogue(57, 120, 2400).concat(
        [2560, 2578, 2596].map((at) => cue(at, at + 4, 'We have to go.')),
      ),
    );
    expect(judgeSubtitleFit(forced, episode, 'en')).toMatchObject({
      drift: 'behind',
      signs: false,
    });
    const fits = judgeSubtitleFits(
      [
        { id: 'forced', profile: forced },
        { id: 'full', profile: profileSubtitles(dialogue(600, 20, 2480)) },
      ],
      episode,
      'en',
    );
    expect(fits.get('forced')).toMatchObject({ length: 'short', signs: false });
    expect(fits.get('forced')!.drift).toBeUndefined();
    expect(fits.get('full')!.length).toBe('fits');
  });

  it('never takes a plain file for one covering only part, next to one for the hard of hearing', () => {
    const lines = [...ENGLISH, '[door creaks]', 'MARY: Who is it?', ...ENGLISH, '(sighs)'];
    const fits = judgeSubtitleFits(
      [
        // 30% fewer lines than the file for the hard of hearing.
        { id: 'plain', profile: profileSubtitles(dialogue(1260, 30, FILM_S - 360)) },
        { id: 'sdh', profile: profileSubtitles(dialogue(1800, 30, FILM_S - 360, lines)) },
      ],
      film,
      'en',
    );
    expect(fits.get('plain')).toMatchObject({ length: 'fits', hearing: false });
    expect(fits.get('sdh')).toMatchObject({ length: 'fits', hearing: true });
  });

  it('never takes a whole file for part of one by its time on screen alone', () => {
    // 1300 lines, one every 5.3 s, each on screen for `shown` seconds.
    const timed = (shown: number) =>
      Array.from({ length: 1300 }, (_, i) =>
        cue(30 + i * 5.3, 30 + i * 5.3 + shown, ENGLISH[i % ENGLISH.length]!),
      );
    // Beside a file that keeps each line on until the next starts (made from a format with no
    // end times), on screen for over twice as long.
    const held = judgeSubtitleFits(
      [
        { id: 'ordinary', profile: profileSubtitles(timed(2.2)) },
        { id: 'held', profile: profileSubtitles(timed(5.3)) },
      ],
      film,
      'en',
    );
    expect(held.get('ordinary')).toMatchObject({ length: 'fits', unfit: false });
    expect(held.get('held')).toMatchObject({ length: 'fits', unfit: false });
    // Beside one whose line near the start was left on for an hour by mistake.
    const typo = timed(1.6);
    typo[100] = { ...typo[100]!, end: typo[100]!.start + 3600 };
    const mistake = judgeSubtitleFits(
      [
        { id: 'ordinary', profile: profileSubtitles(timed(1.6)) },
        { id: 'typo', profile: profileSubtitles(typo) },
      ],
      film,
      'en',
    );
    expect(mistake.get('typo')!.length).toBe('fits');
    expect(mistake.get('ordinary')).toMatchObject({ length: 'fits', unfit: false });
  });

  describe('an anime episode whose songs are sung one syllable to a line', () => {
    const episode = { seconds: 1420, exact: true };
    const SYLLABLES = ['ka', 'ze', 'ni', 'mu', 'ke', 'te', 'ha', 'shi', 'ru', 'yo', 'so', 'ra'];
    const clock = (seconds: number) => {
      const cs = Math.round(seconds * 100);
      const two = (n: number) => (n < 10 ? `0${n}` : `${n}`);
      return `0:${two(Math.floor(cs / 6000))}:${two(Math.floor(cs / 100) % 60)}.${two(cs % 100)}`;
    };
    const event = (from: number, to: number, style: string, text: string) =>
      `Dialogue: 0,${clock(from)},${clock(to)},${style},,0,0,0,,${text}`;
    /** The opening and the ending: each line its syllables one after another, and its translation. */
    const songs = (linesEach: number, syllables: number) => {
      const events: string[] = [];
      for (const at of [60, 1330]) {
        for (let line = 0; line < linesEach; line++) {
          const from = at + line * 4;
          events.push(event(from, from + 4, 'Translation', 'Into the wind we run together'));
          for (let s = 0; s < syllables; s++) {
            const step = 4 / syllables;
            events.push(event(from + s * step, from + (s + 1) * step, 'Romaji', SYLLABLES[s]!));
          }
        }
      }
      return events;
    };
    const signs = Array.from({ length: 60 }, (_, i) =>
      event(170 + i * 19, 173 + i * 19, 'Sign', `{\\an8}SIGN ${i + 1}`),
    );
    const speech = Array.from({ length: 370 }, (_, i) => {
      const from = 160 + (i * (1320 - 163)) / 369;
      return { from, to: from + 2.5, text: ENGLISH[i % ENGLISH.length]! };
    });
    const ass = (events: string[]) =>
      parseSubtitleText(
        ['[Script Info]', 'Title: Show', '', '[Events]']
          .concat('Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text')
          .concat(events)
          .join('\n'),
      );
    const srt = parseSubtitleText(
      speech
        .map(
          (line, i) =>
            `${i + 1}\n${clock(line.from).replace('.', ',')}0 --> ${clock(line.to).replace('.', ',')}0\n${line.text}`,
        )
        .join('\n\n'),
    );
    const judge = (linesEach: number, syllables: number) => {
      const sung = songs(linesEach, syllables);
      const files: Array<{ id: string; label?: string; profile: SubtitleProfile }> = [
        {
          id: 'songs',
          profile: profileSubtitles(
            ass(sung.concat(signs)),
            '[Group] Show - 01 (1080p) [Signs & Songs]',
          ),
        },
        {
          id: 'full',
          profile: profileSubtitles(
            ass(
              sung.concat(
                signs,
                speech.map((l) => event(l.from, l.to, 'Default', l.text)),
              ),
            ),
            '[Group] Show - 01 (1080p)',
          ),
        },
        { id: 'srt', profile: profileSubtitles(srt) },
      ];
      const fits = judgeSubtitleFits(files, episode, 'en');
      const ranked = rankSubtitles(files, {
        video: {},
        fit: (file) => fits.get(file.id),
        hearing: false,
      }).map((file) => file.id);
      return { files, fits, ranked };
    };

    it('takes the signs and songs file by its name for signs only, many lines as it has', () => {
      const { files, fits, ranked } = judge(20, 9);
      // More lines a minute than a full file has.
      expect(files[0]!.profile.lines / 24).toBeGreaterThan(15);
      expect(fits.get('songs')).toMatchObject({ signs: true, unfit: true });
      expect(ranked[ranked.length - 1]).toBe('songs');
    });

    it('knows the signs and songs file for part of the episode, with no name or one that says only forced', () => {
      const sung = songs(20, 9);
      const plain = { id: 'srt', profile: profileSubtitles(srt) };
      const full = {
        id: 'full',
        profile: profileSubtitles(
          ass(
            sung.concat(
              signs,
              speech.map((l) => event(l.from, l.to, 'Default', l.text)),
            ),
          ),
        ),
      };
      const rankedIn = (files: Array<{ id: string; label?: string; profile: SubtitleProfile }>) => {
        const fits = judgeSubtitleFits(files, episode, 'en');
        const ranked = rankSubtitles(files, {
          video: {},
          fit: (each) => fits.get(each.id),
          hearing: false,
        }).map((each) => each.id);
        return { fits, ranked };
      };
      // OpenSubtitles sends no release name at all.
      const unnamed = { id: 'songs', profile: profileSubtitles(ass(sung.concat(signs))) };
      // The karaoke gives it more than half the plain file's lines, and a full file's a minute.
      expect(unnamed.profile.lines).toBeGreaterThan(plain.profile.lines / 2);
      expect(unnamed.profile.lines / (episode.seconds / 60)).toBeGreaterThan(15);
      // Each line of a song counts once, however many syllables are drawn over it.
      expect(unnamed.profile.apart).toBeLessThan(plain.profile.apart / 2);
      for (const files of [
        [unnamed, plain],
        [unnamed, full, plain],
      ]) {
        const { fits, ranked } = rankedIn(files);
        expect(fits.get('songs')).toMatchObject({ length: 'short', signs: false });
        expect(ranked[ranked.length - 1]).toBe('songs');
      }
      // A name that says only forced is trusted: the karaoke is not a full file's lines.
      const named = {
        id: 'songs',
        profile: profileSubtitles(ass(sung.concat(signs)), '[Group] Show - 01 (1080p) [Forced]'),
      };
      for (const files of [[named], [named, plain], [named, full, plain]]) {
        const { fits, ranked } = rankedIn(files);
        expect(fits.get('songs')).toMatchObject({ signs: true, unfit: true });
        expect(ranked[ranked.length - 1]).toBe('songs');
      }
      // A full file that says forced as well is still a full file, its karaoke left out.
      const fullForced = {
        id: 'full',
        profile: profileSubtitles(
          ass(
            sung.concat(
              signs,
              speech.map((l) => event(l.from, l.to, 'Default', l.text)),
            ),
          ),
          '[Group] Show - 01 (1080p) [Full+Forced]',
        ),
      };
      expect(rankedIn([fullForced, plain]).fits.get('full')).toMatchObject({
        signs: false,
        length: 'fits',
        unfit: false,
      });
    });

    it('never takes the plain file for part of one beside the full file with the karaoke', () => {
      const { files, fits, ranked } = judge(22, 12);
      // The full file has far more than twice the plain file's lines.
      expect(files[1]!.profile.lines).toBeGreaterThan(files[2]!.profile.lines * 2);
      expect(fits.get('srt')).toMatchObject({ length: 'fits', unfit: false });
      expect(fits.get('full')).toMatchObject({ length: 'fits', unfit: false });
      expect(ranked).toEqual(['full', 'srt', 'songs']);
    });
  });
});
