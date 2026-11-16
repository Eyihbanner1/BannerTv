import { decodeUtf8 } from '../ebml';
import type { ByteSource } from '../source';

/**
 * Test helpers: the files in this folder, a source that counts what is asked
 * of it, and a small EBML writer for files the muxers will not make.
 */

interface NodeFs {
  readFileSync(path: string): Uint8Array;
}

interface NodeUrl {
  fileURLToPath(url: string): string;
}

interface NodeZlib {
  deflateSync(bytes: Uint8Array): Uint8Array;
}

// The core is typed without Node or the DOM; the tests run in Node, and need only this.
const FS = 'node:fs';
const URL_MODULE = 'node:url';
const ZLIB = 'node:zlib';
const HERE = (import.meta as unknown as { url: string }).url;
const FOLDER = HERE.slice(0, HERE.lastIndexOf('/') + 1);

export async function readFixture(name: string): Promise<Uint8Array> {
  const fs = (await import(/* @vite-ignore */ FS)) as NodeFs;
  const url = (await import(/* @vite-ignore */ URL_MODULE)) as NodeUrl;
  return new Uint8Array(fs.readFileSync(url.fileURLToPath(FOLDER + name)));
}

export async function readFixtureText(name: string): Promise<string> {
  return decodeUtf8(await readFixture(name));
}

/** zlib (RFC 1950) compression, as mkvmerge writes a compressed track. */
export async function deflater(): Promise<(bytes: Uint8Array) => Uint8Array> {
  const zlib = (await import(/* @vite-ignore */ ZLIB)) as NodeZlib;
  return (bytes) => new Uint8Array(zlib.deflateSync(bytes));
}

export interface CountedRead {
  start: number;
  length: number;
}

export interface FakeSource extends ByteSource {
  reads: CountedRead[];
  bytes: number;
  inFlight: number;
  peakInFlight: number;
}

/**
 * A source over `read`, counting every read and the most in flight at once;
 * each read answers after `delay` turns of the event loop.
 */
export function fakeSource(
  size: number,
  read: (start: number, length: number) => Uint8Array,
  delay = 1,
): FakeSource {
  const source: FakeSource = {
    size,
    reads: [],
    bytes: 0,
    inFlight: 0,
    peakInFlight: 0,
    async read(start, length) {
      source.reads.push({ start, length });
      source.inFlight++;
      source.peakInFlight = Math.max(source.peakInFlight, source.inFlight);
      for (let i = 0; i < delay; i++) await Promise.resolve();
      source.inFlight--;
      const bytes = read(start, Math.max(0, Math.min(length, size - start)));
      source.bytes += bytes.length;
      return bytes;
    },
  };
  return source;
}

export function fakeBytesSource(bytes: Uint8Array, delay = 1): FakeSource {
  return fakeSource(bytes.length, (start, length) => bytes.subarray(start, start + length), delay);
}

// The EBML writer. A part is bytes, or a run of that many zero bytes, so a
// film's video can take gigabytes without being held in memory.
export type Part = Uint8Array | number;

export interface Built {
  parts: Part[];
  length: number;
}

function lengthOf(parts: readonly Part[]): number {
  let length = 0;
  for (const part of parts) length += typeof part === 'number' ? part : part.length;
  return length;
}

export function bytes(...values: number[]): Uint8Array {
  return new Uint8Array(values);
}

export function ascii(text: string): Uint8Array {
  return bytes(...Array.from(text, (char) => char.charCodeAt(0)));
}

export function utf8(text: string): Uint8Array {
  const out: number[] = [];
  for (const char of text) {
    const code = char.codePointAt(0)!;
    if (code < 0x80) out.push(code);
    else if (code < 0x800) out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    else if (code < 0x10000) {
      out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      out.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    }
  }
  return bytes(...out);
}

function idBytes(id: number): Uint8Array {
  const out: number[] = [];
  let value = id;
  while (value > 0) {
    out.unshift(value & 0xff);
    value = Math.floor(value / 256);
  }
  return bytes(...out);
}

/** A size as a vint of `width` bytes (the fewest that hold it when left out). */
export function sizeBytes(size: number, width?: number): Uint8Array {
  let length = 1;
  while (size >= Math.pow(2, 7 * length) - 1) length++;
  const use = width ?? length;
  const out = new Array<number>(use).fill(0);
  let value = size;
  for (let i = use - 1; i >= 0; i--) {
    out[i] = value % 256;
    value = Math.floor(value / 256);
  }
  out[0] = out[0]! | (0x100 >> use);
  return bytes(...out);
}

export const UNKNOWN = -1;

/** An element: ID, size (of `sizeWidth` bytes when given, all ones for UNKNOWN) and data. */
export function el(id: number, content: readonly Part[] | Uint8Array, sizeWidth?: number): Built {
  const parts = content instanceof Uint8Array ? [content] : [...content];
  const length = lengthOf(parts);
  const size =
    sizeWidth === UNKNOWN
      ? bytes(0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff)
      : sizeBytes(length, sizeWidth);
  const head = idBytes(id);
  return { parts: [head, size, ...parts], length: head.length + size.length + length };
}

export function uintBytes(value: number, width?: number): Uint8Array {
  const out: number[] = [];
  let rest = value;
  do {
    out.unshift(rest % 256);
    rest = Math.floor(rest / 256);
  } while (rest > 0);
  while (width !== undefined && out.length < width) out.unshift(0);
  return bytes(...out);
}

export function uint(id: number, value: number, width?: number): Built {
  return el(id, uintBytes(value, width));
}

export function str(id: number, text: string): Built {
  return el(id, utf8(text));
}

export function float64(id: number, value: number): Built {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setFloat64(0, value);
  return el(id, out);
}

/** Pushes one by one: a spread of a film's parts would overflow the stack. */
export function append<T>(target: T[], items: readonly T[]): void {
  for (const item of items) target.push(item);
}

export function joinAll(built: readonly Built[]): Part[] {
  const parts: Part[] = [];
  for (const one of built) append(parts, one.parts);
  return parts;
}

export function join(...built: Built[]): Part[] {
  return joinAll(built);
}

/** A source over parts; runs of zeros are made up as they are read. */
export function partsSource(parts: readonly Part[], delay = 1): FakeSource {
  const starts: number[] = [];
  let at = 0;
  for (const part of parts) {
    starts.push(at);
    at += typeof part === 'number' ? part : part.length;
  }
  const size = at;
  return fakeSource(
    size,
    (start, length) => {
      const out = new Uint8Array(length);
      let low = 0;
      let high = parts.length - 1;
      while (low < high) {
        const middle = (low + high + 1) >>> 1;
        if (starts[middle]! <= start) low = middle;
        else high = middle - 1;
      }
      for (let i = low; i < parts.length && starts[i]! < start + length; i++) {
        const part = parts[i]!;
        if (typeof part === 'number') continue;
        const from = Math.max(0, start - starts[i]!);
        const to = Math.min(part.length, start + length - starts[i]!);
        out.set(part.subarray(from, to), starts[i]! + from - start);
      }
      return out;
    },
    delay,
  );
}

export function flatten(parts: readonly Part[]): Uint8Array {
  const out = new Uint8Array(lengthOf(parts));
  let at = 0;
  for (const part of parts) {
    if (typeof part === 'number') at += part;
    else {
      out.set(part, at);
      at += part.length;
    }
  }
  return out;
}
