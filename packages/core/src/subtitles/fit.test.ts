import { describe, expect, it } from 'vitest';
import {
  FRAME_RATE_RATIO,
  judgeScript,
  judgeSubtitleFit,
  judgeSubtitleFits,
  profileSubtitles,
  type SubtitleProfile,
} from './fit';
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
    // A film called Signs is not a forced file.
    expect(profileSubtitles([], 'Signs.2002.1080p.BluRay').forcedLabel).toBe(false);
    expect(profileSubtitles([], 'Hi.Score.Girl.S01E01').hearingLabel).toBe(false);
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

  it('knows a file ending about 4% before two others that agree: timed for 25 fps on a film-speed video', () => {
    const fits = judgeSubtitleFits(
      [
        { id: 'pal', profile: at(consensus / FRAME_RATE_RATIO) },
        { id: 'a', profile: at(consensus) },
        { id: 'b', profile: at(consensus + 30) },
      ],
      film,
      'en',
    );
    expect(fits.get('pal')!.drift).toBe('ahead');
    expect(fits.get('a')!.drift).toBeUndefined();
    expect(fits.get('b')!.drift).toBeUndefined();
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

  it('counts neither a drifting file nor one of signs among the files that agree', () => {
    const fits = judgeSubtitleFits(
      [
        { id: 'pal', profile: at(consensus / FRAME_RATE_RATIO) },
        { id: 'a', profile: at(consensus) },
        { id: 'signs', profile: profileSubtitles(dialogue(30, 300, consensus)) },
      ],
      film,
      'en',
    );
    expect(fits.get('pal')!.drift).toBeUndefined();
    expect(fits.get('signs')!.unfit).toBe(true);
  });
});
