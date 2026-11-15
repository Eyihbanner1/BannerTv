// Writes the made-up subtitles muxed into the journeys' MKV files (make-mkv.sh): test lines
// only, at times from a seeded generator, so every run makes the same files. Also writes
// lines.json, the times the journeys check the lines against.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const out = process.argv[2];
if (!out) throw new Error('usage: node make-text.mjs <folder>');

/** A seeded generator (an LCG, as glibc's): the same numbers on every machine. */
function seeded(seed) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

/** 150 lines over the 10-minute video from 3 s: one every 2.3 to 5.3 s, lasting 1 to 2.5 s. */
function speech() {
  const random = seeded(20261115);
  const lines = [];
  let at = 3;
  while (lines.length < 150) {
    const length = 1 + 1.5 * random();
    lines.push([round(at), round(at + length)]);
    at += length + 1.3 + 2 * random();
  }
  return lines;
}

const round = (seconds) => Math.round(seconds * 1000) / 1000;

const pad = (n, width = 2) => String(n).padStart(width, '0');
const clock = (seconds, separator) => {
  const whole = Math.floor(seconds);
  const millis = Math.round((seconds - whole) * 1000);
  return `${pad(Math.floor(whole / 3600))}:${pad(Math.floor(whole / 60) % 60)}:${pad(whole % 60)}${separator}${pad(millis, 3)}`;
};

const srt = (lines, text) =>
  lines
    .map(
      ([start, end], i) =>
        `${i + 1}\n${clock(start, ',')} --> ${clock(end, ',')}\n${text(i + 1)}\n`,
    )
    .join('\n');

/** ASS time: 0:01:02.50. */
const assTime = (seconds) => {
  const centis = Math.round(seconds * 100);
  const whole = Math.floor(centis / 100);
  return `${Math.floor(whole / 3600)}:${pad(Math.floor(whole / 60) % 60)}:${pad(whole % 60)}.${pad(centis % 100)}`;
};

const ass = (lines, text) =>
  [
    '[Script Info]',
    'ScriptType: v4.00+',
    'PlayResX: 640',
    'PlayResY: 360',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    'Style: Default,Arial,20,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,1,0,2,10,10,10,1',
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    ...lines.map(
      ([start, end], i) =>
        `Dialogue: 0,${assTime(start)},${assTime(end)},Default,,0,0,0,,${text(i + 1)}`,
    ),
    '',
  ].join('\n');

/**
 * A minimal PGS (.sup) stream: each picture a display set (a composition, a window, a palette,
 * a 1x1 object, the end) and a clearing set (a composition with no object, a window, the end).
 */
function sup(count) {
  const parts = [];
  const segment = (pts, type, data) => {
    const head = Buffer.alloc(13);
    head.write('PG', 0, 'ascii');
    head.writeUInt32BE(pts, 2);
    head.writeUInt32BE(0, 6);
    head.writeUInt8(type, 10);
    head.writeUInt16BE(data.length, 11);
    parts.push(head, data);
  };
  const composition = (number, objects) => {
    const data = Buffer.alloc(11 + objects * 8);
    data.writeUInt16BE(320, 0);
    data.writeUInt16BE(180, 2);
    data.writeUInt8(0x10, 4);
    data.writeUInt16BE(number, 5);
    data.writeUInt8(objects ? 0x80 : 0, 7);
    data.writeUInt8(0, 8);
    data.writeUInt8(0, 9);
    data.writeUInt8(objects, 10);
    if (objects) {
      data.writeUInt16BE(0, 11);
      data.writeUInt8(0, 13);
      data.writeUInt8(0, 14);
      data.writeUInt16BE(10, 15);
      data.writeUInt16BE(150, 17);
    }
    return data;
  };
  const window = Buffer.from([1, 0, 0, 10, 0, 150, 0, 100, 0, 20]);
  const palette = Buffer.from([0, 0, 1, 235, 128, 128, 255]);
  const rle = [1, 0, 0];
  const object = Buffer.from([0, 0, 0, 0xc0, 0, 0, rle.length + 4, 0, 1, 0, 1, ...rle]);
  let number = 0;
  for (let i = 0; i < count; i++) {
    const start = (2 + i * 3) * 90000;
    const end = start + 2 * 90000;
    segment(start, 0x16, composition(number++, 1));
    segment(start, 0x17, window);
    segment(start, 0x14, palette);
    segment(start, 0x15, object);
    segment(start, 0x80, Buffer.alloc(0));
    segment(end, 0x16, composition(number++, 0));
    segment(end, 0x17, window);
    segment(end, 0x80, Buffer.alloc(0));
  }
  return Buffer.concat(parts);
}

const lines = speech();
// A sign every ten lines, as a forced track has a few.
const signs = lines.filter((_, i) => i % 10 === 4);

writeFileSync(
  join(out, 'english.srt'),
  srt(lines, (n) => `Test line ${n}`),
);
writeFileSync(
  join(out, 'signs.srt'),
  srt(signs, (n) => `Test sign ${n}`),
);
writeFileSync(
  join(out, 'spanish.ass'),
  ass(lines, (n) => `Línea de prueba ${n}`),
);
writeFileSync(
  join(out, 'spanish.srt'),
  srt(lines, (n) => `Línea de prueba ${n}`),
);
writeFileSync(join(out, 'pictures.sup'), sup(40));
// As Prettier writes it: a line of the file for each line of the film.
writeFileSync(
  join(out, 'lines.json'),
  `{\n  "lines": [\n${lines.map(([start, end]) => `    [${start}, ${end}]`).join(',\n')}\n  ]\n}\n`,
);
