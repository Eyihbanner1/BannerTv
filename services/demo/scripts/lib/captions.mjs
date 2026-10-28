/**
 * Subtitle check captions: numbered test lines through the whole film, so
 * whoever tests the app (LG's QA among them, self-check item 48) can see that
 * subtitles show and that the size and colour settings apply. None of the
 * demo films has dialogue, so there is nothing to translate; the lines say
 * plainly that they are a test.
 *
 * WebVTT in UTF-8, which the app reads as is (packages/core/src/subtitles).
 * BannerTV never turns these on by itself, even for a viewer whose subtitle
 * language is English or Korean (apps/webos/src/screens/player/use-subtitles.ts),
 * so nobody sees them by accident.
 */

export const CHECK_EVERY_SECONDS = 30;
export const CHECK_SHOWN_SECONDS = 6;
const FIRST_AT_SECONDS = 5;

/** The tracks every film gets, in the order the player lists them. */
export const CHECK_TRACKS = [
  {
    lang: 'eng',
    file: 'eng.vtt',
    lines: (n, total) => [
      `Subtitle check ${n} of ${total}`,
      'This line uses your subtitle size and colour.',
    ],
  },
  {
    lang: 'kor',
    file: 'kor.vtt',
    lines: (n, total) => [
      `자막 확인 ${n}/${total}`,
      '이 줄은 설정한 자막 크기와 색상으로 표시됩니다.',
    ],
  },
];

/** hh:mm:ss.mmm, as WebVTT wants it. */
export function vttTime(seconds) {
  const ms = Math.round(seconds * 1000);
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const pad = (value, size = 2) => String(value).padStart(size, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(ms % 1000, 3)}`;
}

/** The cue start times for a film, none running past its end. */
export function checkTimes(durationSeconds) {
  const times = [];
  for (
    let at = FIRST_AT_SECONDS;
    at + CHECK_SHOWN_SECONDS <= durationSeconds;
    at += CHECK_EVERY_SECONDS
  ) {
    times.push(at);
  }
  return times;
}

export function checkCaptions(durationSeconds, track) {
  const times = checkTimes(durationSeconds);
  const cues = times.map((at, index) => {
    const [first, second] = track.lines(index + 1, times.length);
    return `${index + 1}\n${vttTime(at)} --> ${vttTime(at + CHECK_SHOWN_SECONDS)}\n${first}\n${second}`;
  });
  return `WEBVTT\n\n${cues.join('\n\n')}\n`;
}
