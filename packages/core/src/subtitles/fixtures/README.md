# Subtitle timing fixtures

`align-timings.json` holds the timing of real subtitle files, and nothing else:
each key is a flat array of start and end times, in hundredths of a second,
two numbers to a line (`[start, end, start, end, …]`). No line's text is kept,
and no link to where a file came from.

The files were public subtitle files for two series' first episodes. The
aligner's tests use them as pairs it has to line up, and as pairs it has to
turn down:

| Key                          | Lines | What it is                                                    |
| ---------------------------- | ----- | ------------------------------------------------------------- |
| `strangerThingsE01Hungarian` | 475   | Episode 1, Hungarian: the reference                           |
| `strangerThingsE01English`   | 769   | Episode 1, English, 5.2 s later than the reference            |
| `strangerThingsE02English`   | 700   | Episode 2, English: another episode, must come out 'none'     |
| `lastOfUsE01EnglishHearing`  | 1199  | Episode 1, English for the hard of hearing: the reference     |
| `lastOfUsE01Arabic25`        | 752   | Episode 1, Arabic, timed for 25 fps against a 23.976 fps cut  |
| `lastOfUsE02English`         | 352   | Episode 2, English: another episode, must come out 'none'     |

`align-boundaries.json` holds more of the same, from the files the aligner's
gates were set on (ADR 0003 item 9): the pairs that came closest to each gate,
so its tests show the gates where real files put them. The rest of that set
stays outside the repository.

| Key                         | Lines | What it is                                                                                                         |
| --------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------ |
| `shawshankEnglishCd1`       | 890   | A film's first CD, English: against `oppenheimerEnglish`, the highest peak a file for another video reached (1.39) |
| `oppenheimerEnglish`        | 3719  | A film, English: the reference                                                                                     |
| `oppenheimerArabicOtherCut` | 2836  | The same film, Arabic, for another cut: 30 s apart from 53 minutes in                                              |
| `matrixGreek`               | 1196  | A film, Greek, timed for 25 fps                                                                                    |
| `matrixFrench`              | 1379  | The same film, French, timed loosely: its parts over a second apart                                                |
| `matrixFinnish`             | 827   | The same film, Finnish, timed for 23.976 fps: the reference                                                        |
| `gameOfThronesE01English`   | 584   | Episode 1, English: against `lastOfUsE01EnglishHearing`, a peak over 1.25 that one window agrees with              |
| `interstellarBrazilian`     | 2024  | A film, Brazilian Portuguese                                                                                       |
| `interstellarOtherFrom80`   | 64    | Another file of the film, only the 5 minutes from 80% in: a stream's track resumed there                           |

Any fixture added here follows the same rule: timings only. Text in a test is
made up for the test.
