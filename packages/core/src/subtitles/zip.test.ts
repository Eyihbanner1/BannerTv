import { describe, expect, it } from 'vitest';
import { decodeUtf8 } from '../media/ebml';
import { crc32 } from '../media/inflate';
import { nodeZlib, seededSrt, utf8, writeZip, type ZipEntryInput } from './fixtures/zip-writer';
import { isZip, subtitleFromZip, ZIP_LIMITS, ZipError, type ZipPick } from './zip';

const text = (bytes: Uint8Array) => decodeUtf8(bytes);

async function zipOf(entries: ZipEntryInput[], options?: { zip64Count?: boolean }) {
  return writeZip(await nodeZlib(), entries, options);
}

function reason(bytes: Uint8Array, pick: ZipPick = {}, limits = ZIP_LIMITS): string | undefined {
  try {
    subtitleFromZip(bytes, pick, limits);
  } catch (error) {
    return error instanceof ZipError ? error.reason : 'other';
  }
  return undefined;
}

describe('subtitleFromZip', () => {
  it('reads stored and deflated entries', async () => {
    const lines = seededSrt(20);
    for (const method of [0, 8] as const) {
      const zip = await zipOf([{ name: 'Test.Film.2026.srt', data: utf8(lines), method }]);
      expect(isZip(zip)).toBe(true);
      expect(text(subtitleFromZip(zip, {}))).toBe(lines);
    }
  });

  it('reads an entry written with a data descriptor (flag bit 3)', async () => {
    const lines = seededSrt(12);
    const zip = await zipOf([{ name: 'a.srt', data: utf8(lines), descriptor: true }]);
    expect(text(subtitleFromZip(zip, {}))).toBe(lines);
  });

  it('decodes UTF-8 names (bit 11) and latin-1 names otherwise', async () => {
    const zip = await zipOf([
      { name: 'Café.S01E02.srt', data: utf8(seededSrt(3)), utf8: true },
      { name: 'Café.S01E03.srt', data: utf8(seededSrt(4)) },
    ]);
    expect(text(subtitleFromZip(zip, { season: 1, episode: 2 }))).toBe(seededSrt(3));
    expect(text(subtitleFromZip(zip, { season: 1, episode: 3 }))).toBe(seededSrt(4));
  });

  it('ignores __MACOSX and ._ files, folders, .nfo and .sub', async () => {
    const wanted = seededSrt(5);
    const big = utf8(seededSrt(400));
    const zip = await zipOf([
      { name: '__MACOSX/._Test.srt', data: big },
      { name: 'Subs/._Test.srt', data: big },
      { name: 'Subs/', data: new Uint8Array(0), method: 0 },
      { name: 'Test.nfo', data: big },
      { name: 'Test.sub', data: big },
      { name: 'Test.txt', data: big },
      { name: 'Subs/Test.Film.2026.SRT', data: utf8(wanted) },
    ]);
    expect(text(subtitleFromZip(zip, {}))).toBe(wanted);
    const none = await zipOf([{ name: 'Test.nfo', data: big }]);
    expect(reason(none)).toBe('no-subtitle');
  });

  it("takes a film's largest subtitle file, the first of equals", async () => {
    const zip = await zipOf([
      { name: 'Forced.srt', data: utf8(seededSrt(3)) },
      { name: 'Full.srt', data: utf8(seededSrt(30)) },
      { name: 'Full.copy.srt', data: utf8(seededSrt(30).replace(/Line/g, 'Lime')) },
    ]);
    expect(text(subtitleFromZip(zip, {}))).toBe(seededSrt(30));
  });

  it("takes a pack's file for the episode, by S02E03 or 2x03", async () => {
    const files = (names: string[]) =>
      zipOf(names.map((name, i) => ({ name, data: utf8(seededSrt(5 + i, (i + 1) * 100)) })));
    const se = await files([
      'Test.Show.S02E02.srt',
      'Test.Show.S02E03.srt',
      'Test.Show.S02E04.srt',
    ]);
    expect(text(subtitleFromZip(se, { season: 2, episode: 3 }))).toBe(seededSrt(6, 200));
    const cross = await files(['Test Show 2x02.srt', 'Test Show 2x03.srt']);
    expect(text(subtitleFromZip(cross, { season: 2, episode: 3 }))).toBe(seededSrt(6, 200));
    // Another season's episode 3 is not this one.
    const other = await files(['Test.Show.S01E03.srt']);
    expect(reason(other, { season: 2, episode: 3 })).toBe('no-subtitle');
  });

  it('never gives another episode when the one wanted is missing', async () => {
    const zip = await zipOf([
      { name: 'Test.Show.S02E01.srt', data: utf8(seededSrt(5)) },
      { name: 'Test.Show.S02E02.srt', data: utf8(seededSrt(50)) },
    ]);
    expect(reason(zip, { season: 2, episode: 3 })).toBe('no-subtitle');
  });

  it('refuses RAR, encrypted, zip64 and archives with too many entries', async () => {
    const rar = new Uint8Array([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00]);
    expect(reason(rar)).toBe('rar');
    expect(reason(utf8('1\n00:00:01,000 --> 00:00:02,000\nLine 1\n'))).toBe('not-zip');
    const encrypted = await zipOf([{ name: 'a.srt', data: utf8(seededSrt(3)), encrypted: true }]);
    expect(reason(encrypted)).toBe('encrypted');
    const zip64 = await zipOf([{ name: 'a.srt', data: utf8(seededSrt(3)) }], { zip64Count: true });
    expect(reason(zip64)).toBe('zip64');
    const many = await zipOf(
      Array.from({ length: 65 }, (_, i) => ({ name: `f${i}.srt`, data: utf8(seededSrt(1)) })),
    );
    expect(reason(many)).toBe('too-many');
    const sixtyFour = await zipOf(
      Array.from({ length: 64 }, (_, i) => ({ name: `f${i}.srt`, data: utf8(seededSrt(1)) })),
    );
    expect(reason(sixtyFour)).toBeUndefined();
  });

  it('refuses a file over the size cap, or that unpacks more than the ratio allows', async () => {
    const zeros = new Uint8Array(ZIP_LIMITS.maxBytes + 1);
    const big = await zipOf([{ name: 'a.srt', data: zeros }]);
    expect(reason(big)).toBe('too-big');
    // 1 MB of zeros packs to about 1 KB: over 100 times.
    const bomb = await zipOf([{ name: 'a.srt', data: new Uint8Array(1024 * 1024) }]);
    expect(reason(bomb)).toBe('too-big');
    expect(reason(bomb, {}, { ...ZIP_LIMITS, maxRatio: 10_000 })).toBeUndefined();
    // A size written smaller than the data unpacks to stops at the size.
    const lying = await zipOf([{ name: 'a.srt', data: utf8(seededSrt(50)), size: 10 }]);
    expect(reason(lying)).toBe('too-big');
  });

  it('says a changed byte fails the check', async () => {
    const data = utf8(seededSrt(20));
    const stored = await zipOf([{ name: 'a.srt', data, method: 0, crc: crc32(data) ^ 1 }]);
    expect(reason(stored)).toBe('crc');
    const zip = await zipOf([{ name: 'a.srt', data, method: 0 }]);
    zip[30 + 'a.srt'.length + 5]! ^= 0x20;
    expect(reason(zip)).toBe('crc');
  });

  it('says a method other than stored or deflate, or a cut archive, is corrupt', async () => {
    const zip = await zipOf([{ name: 'a.srt', data: utf8(seededSrt(3)), method: 12 }]);
    expect(reason(zip)).toBe('corrupt');
    const whole = await zipOf([{ name: 'a.srt', data: utf8(seededSrt(30)) }]);
    expect(reason(whole.subarray(0, whole.length - 30))).toBe('corrupt');
  });
});
