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

Any fixture added here follows the same rule: timings only. Text in a test is
made up for the test.
