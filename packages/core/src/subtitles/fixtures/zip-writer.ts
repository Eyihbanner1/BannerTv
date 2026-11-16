import { utf8 } from '../../media/fixtures/helpers';
import { crc32 } from '../../media/inflate';

export { utf8 };

/**
 * Test helpers: node:zlib's raw deflate, and a small ZIP writer for archives
 * built in the tests (stored or deflated entries, a data descriptor, UTF-8
 * names, and the odd flag a real archive may carry). Text is seeded lines
 * only, never a real subtitle file.
 */

interface NodeZlib {
  deflateRawSync(bytes: Uint8Array, options?: { level?: number }): Uint8Array;
  crc32?(bytes: Uint8Array): number;
}

// The core is typed without Node; the tests run in Node, and need only this.
const ZLIB = 'node:zlib';

export async function nodeZlib(): Promise<NodeZlib> {
  return (await import(/* @vite-ignore */ ZLIB)) as NodeZlib;
}

export interface ZipEntryInput {
  name: string;
  data: Uint8Array;
  /** 0 stored, 8 deflated (the default). */
  method?: 0 | 8 | 12;
  /** Sizes and check after the data, in a data descriptor (flag bit 3). */
  descriptor?: boolean;
  /** The name is written as UTF-8 and flagged so (bit 11); otherwise as latin-1 bytes. */
  utf8?: boolean;
  encrypted?: boolean;
  /** Overrides the size written in the central directory. */
  size?: number;
  /** Overrides the check written. */
  crc?: number;
}

function latin1Bytes(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}

export function writeZip(
  zlib: NodeZlib,
  inputs: readonly ZipEntryInput[],
  options: { zip64Count?: boolean } = {},
): Uint8Array {
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const input of inputs) {
    const method = input.method ?? 8;
    const packed =
      method === 8 ? new Uint8Array(zlib.deflateRawSync(input.data)) : input.data.slice();
    const name = input.utf8 ? utf8(input.name) : latin1Bytes(input.name);
    const flags = (input.descriptor ? 8 : 0) | (input.utf8 ? 0x800 : 0) | (input.encrypted ? 1 : 0);
    const crc = input.crc ?? crc32(input.data);
    const size = input.size ?? input.data.length;

    const local = new Uint8Array(30 + name.length + packed.length + (input.descriptor ? 16 : 0));
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, flags, true);
    lv.setUint16(8, method, true);
    lv.setUint32(14, input.descriptor ? 0 : crc, true);
    lv.setUint32(18, input.descriptor ? 0 : packed.length, true);
    lv.setUint32(22, input.descriptor ? 0 : size, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    local.set(packed, 30 + name.length);
    if (input.descriptor) {
      const at = 30 + name.length + packed.length;
      lv.setUint32(at, 0x08074b50, true);
      lv.setUint32(at + 4, crc, true);
      lv.setUint32(at + 8, packed.length, true);
      lv.setUint32(at + 12, size, true);
    }

    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, flags, true);
    cv.setUint16(10, method, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, packed.length, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    central.set(name, 46);

    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }
  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  const count = options.zip64Count ? 0xffff : inputs.length;
  ev.setUint16(8, count, true);
  ev.setUint16(10, count, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  const parts = [...locals, ...centrals, end];
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** Seeded subtitle lines ("Line 1", "Line 2", …), never a real file's text. */
export function seededSrt(lines: number, first = 1): string {
  const out: string[] = [];
  for (let n = 0; n < lines; n++) {
    const start = 10 + n * 4;
    const stamp = (s: number) =>
      `00:${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')},000`;
    out.push(`${n + 1}\n${stamp(start)} --> ${stamp(start + 2)}\nLine ${first + n}\n`);
  }
  return out.join('\n');
}
