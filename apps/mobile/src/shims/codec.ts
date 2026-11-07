/**
 * Text for SQLite from the values the shared modules hand IndexedDB, which keeps structured
 * clones. JSON alone would lose what the account and the stores keep: byte arrays (keys and sealed
 * documents), `undefined` in arrays, Dates, Maps, Sets and the non-finite numbers. Those are
 * written as tagged objects and read back as they were. A plain object that happens to look like
 * a tag is escaped, so nothing a store writes can turn into something else on the way back.
 */

const TAG = '$bt';

type Tagged =
  | { $bt: 'u8'; v: string }
  | { $bt: 'ab'; v: string }
  | { $bt: 'date'; v: number }
  | { $bt: 'map'; v: unknown[] }
  | { $bt: 'set'; v: unknown[] }
  | { $bt: 'undef' }
  | { $bt: 'num'; v: 'NaN' | 'Infinity' | '-Infinity' }
  | { $bt: 'obj'; v: Record<string, unknown> };

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const LOOKUP = new Map(Array.from(BASE64, (char, index) => [char, index] as const));

export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!;
    const b = i + 1 < bytes.length ? bytes[i + 1]! : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2]! : 0;
    const triple = (a << 16) | (b << 8) | c;
    out += BASE64[(triple >> 18) & 63]! + BASE64[(triple >> 12) & 63]!;
    out += i + 1 < bytes.length ? BASE64[(triple >> 6) & 63]! : '=';
    out += i + 2 < bytes.length ? BASE64[triple & 63]! : '=';
  }
  return out;
}

export function base64ToBytes(text: string): Uint8Array {
  const clean = text.replace(/=+$/, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let bits = 0;
  let value = 0;
  let index = 0;
  for (const char of clean) {
    const digit = LOOKUP.get(char);
    if (digit === undefined) throw new Error('Not base64');
    value = (value << 6) | digit;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[index++] = (value >> bits) & 255;
    }
  }
  return out;
}

function encodeValue(value: unknown): unknown {
  if (value === undefined) return { [TAG]: 'undef' };
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return { [TAG]: 'num', v: 'NaN' };
    if (value === Infinity) return { [TAG]: 'num', v: 'Infinity' };
    if (value === -Infinity) return { [TAG]: 'num', v: '-Infinity' };
    return value;
  }
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Uint8Array) return { [TAG]: 'u8', v: bytesToBase64(value) };
  if (ArrayBuffer.isView(value)) {
    const view = value as ArrayBufferView;
    return {
      [TAG]: 'u8',
      v: bytesToBase64(new Uint8Array(view.buffer, view.byteOffset, view.byteLength)),
    };
  }
  if (value instanceof ArrayBuffer) return { [TAG]: 'ab', v: bytesToBase64(new Uint8Array(value)) };
  if (value instanceof Date) return { [TAG]: 'date', v: value.getTime() };
  if (value instanceof Map) {
    return { [TAG]: 'map', v: Array.from(value, ([k, v]) => [encodeValue(k), encodeValue(v)]) };
  }
  if (value instanceof Set) return { [TAG]: 'set', v: Array.from(value, encodeValue) };
  if (Array.isArray(value)) return value.map(encodeValue);
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    const field = (value as Record<string, unknown>)[key];
    // Structured clones keep an undefined field; JSON readers treat a missing one the same.
    if (field === undefined) continue;
    out[key] = encodeValue(field);
  }
  return TAG in out ? { [TAG]: 'obj', v: out } : out;
}

function decodeValue(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(decodeValue);
  const record = value as Record<string, unknown>;
  const tag = record[TAG];
  if (typeof tag === 'string') {
    const tagged = record as Tagged;
    switch (tagged.$bt) {
      case 'u8':
        return base64ToBytes(tagged.v);
      case 'ab': {
        const bytes = base64ToBytes(tagged.v);
        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      }
      case 'date':
        return new Date(tagged.v);
      case 'map':
        return new Map(
          tagged.v.map((pair) => {
            const [k, v] = pair as [unknown, unknown];
            return [decodeValue(k), decodeValue(v)] as const;
          }),
        );
      case 'set':
        return new Set(tagged.v.map(decodeValue));
      case 'undef':
        return undefined;
      case 'num':
        return Number(tagged.v);
      case 'obj':
        return decodePlain(tagged.v);
    }
  }
  return decodePlain(record);
}

function decodePlain(record: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(record)) out[key] = decodeValue(record[key]);
  return out;
}

export function encodeClone(value: unknown): string {
  return JSON.stringify(encodeValue(value));
}

/**
 * Whether a stored text is plain JSON, which the full decode would only copy: it holds no tag
 * (every tag is written under the key "$bt"), no "__proto__" key (which the copy would turn into
 * a prototype), and no \u escape that could spell either. JSON.parse alone then gives exactly
 * what the full decode gives. Most of what is stored (catalog pages, titles, progress, My List)
 * is like this. Each search starts at a rare character: a quote starts nearly every token of
 * JSON, and searching from one is many times slower.
 */
export function plainJson(text: string): boolean {
  return (
    text.indexOf(`${TAG}"`) === -1 && text.indexOf('__proto__') === -1 && text.indexOf('\\u') === -1
  );
}

/** The full decode: every array and object copied, and every tag read back. */
export function decodeCloneFully(text: string): unknown {
  return decodeValue(JSON.parse(text) as unknown);
}

export function decodeClone(text: string): unknown {
  return plainJson(text) ? (JSON.parse(text) as unknown) : decodeCloneFully(text);
}
