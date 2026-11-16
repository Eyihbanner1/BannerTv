/**
 * Raw DEFLATE (RFC 1951) in plain code, for engines without a
 * DecompressionStream that takes 'deflate-raw' (Chromium 68 on webOS 5,
 * Hermes): a SubDL archive is opened in the page, and nothing leaves it.
 * Stored, fixed and dynamic blocks; output grows by doubling and never passes
 * `maxLength`. No recursion, so a crafted input cannot run the stack out.
 */

export type InflateFailure = 'corrupt' | 'too-big' | 'truncated';

export class InflateError extends Error {
  readonly reason: InflateFailure;

  constructor(reason: InflateFailure) {
    super(
      reason === 'too-big'
        ? 'The data unpacks to more than allowed'
        : reason === 'truncated'
          ? 'The data ends too soon'
          : 'The data is not valid deflate',
    );
    this.name = 'InflateError';
    this.reason = reason;
  }
}

const LENGTH_BASE = [
  3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131,
  163, 195, 227, 258,
];
const LENGTH_EXTRA = [
  0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0,
];
const DIST_BASE = [
  1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049,
  3073, 4097, 6145, 8193, 12289, 16385, 24577,
];
const DIST_EXTRA = [
  0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13,
];
/** The order the code length code's lengths come in. */
const LENGTH_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

const MAX_BITS = 15;
/** Codes this long or shorter are found with one look in a table; longer ones bit by bit. */
const FAST_BITS = 10;

interface Huffman {
  /** How many codes of each length. */
  counts: Uint16Array;
  /** The symbols in canonical order. */
  symbols: Uint16Array;
  /** By the next FAST_BITS bits, reversed: symbol << 4 | length, or 0 for a longer code. */
  fast: Int32Array;
}

function buildHuffman(lengths: ArrayLike<number>, count: number): Huffman {
  const counts = new Uint16Array(MAX_BITS + 1);
  for (let i = 0; i < count; i++) counts[lengths[i]!]!++;
  counts[0] = 0;
  // Over-subscribed: more codes than the lengths can hold.
  let left = 1;
  for (let len = 1; len <= MAX_BITS; len++) {
    left = left * 2 - counts[len]!;
    if (left < 0) throw new InflateError('corrupt');
  }
  const offsets = new Uint16Array(MAX_BITS + 2);
  for (let len = 1; len <= MAX_BITS; len++) offsets[len + 1] = offsets[len]! + counts[len]!;
  const symbols = new Uint16Array(count);
  for (let symbol = 0; symbol < count; symbol++) {
    const len = lengths[symbol]!;
    if (len !== 0) symbols[offsets[len]!++] = symbol;
  }
  // The canonical codes, reversed into the order bits are read, for the short ones.
  const fast = new Int32Array(1 << FAST_BITS);
  let code = 0;
  let index = 0;
  for (let len = 1; len <= FAST_BITS; len++) {
    for (let n = 0; n < counts[len]!; n++) {
      const symbol = symbols[index++]!;
      let reversed = 0;
      for (let bit = 0; bit < len; bit++) reversed |= ((code >>> bit) & 1) << (len - 1 - bit);
      for (let fill = reversed; fill < 1 << FAST_BITS; fill += 1 << len) {
        fast[fill] = (symbol << 4) | len;
      }
      code++;
    }
    code <<= 1;
  }
  return { counts, symbols, fast };
}

let fixedLengths: Huffman | undefined;
let fixedDistances: Huffman | undefined;

function fixedTables(): [Huffman, Huffman] {
  if (!fixedLengths || !fixedDistances) {
    const lengths = new Uint8Array(288);
    for (let i = 0; i < 288; i++) lengths[i] = i < 144 ? 8 : i < 256 ? 9 : i < 280 ? 7 : 8;
    fixedLengths = buildHuffman(lengths, 288);
    const distances = new Uint8Array(30).fill(5);
    fixedDistances = buildHuffman(distances, 30);
  }
  return [fixedLengths, fixedDistances];
}

/** Unpacks raw deflate data; throws InflateError. */
export function inflateRaw(data: Uint8Array, maxLength: number): Uint8Array {
  let pos = 0;
  let bitBuf = 0;
  let bitCount = 0;
  // Zero bits added past the end of the input, so a look ahead never fails by itself.
  let padded = 0;

  let out = new Uint8Array(Math.max(1, Math.min(maxLength, Math.max(1024, data.length * 4))));
  let outPos = 0;

  function fill(n: number) {
    while (bitCount < n) {
      if (pos < data.length) bitBuf |= data[pos++]! << bitCount;
      else padded += 8;
      bitCount += 8;
    }
  }

  function drop(n: number) {
    bitBuf >>>= n;
    bitCount -= n;
    if (padded > bitCount) throw new InflateError('truncated');
  }

  function bits(n: number): number {
    if (n === 0) return 0;
    fill(n);
    const value = bitBuf & ((1 << n) - 1);
    drop(n);
    return value;
  }

  function decode(table: Huffman): number {
    fill(FAST_BITS);
    const entry = table.fast[bitBuf & ((1 << FAST_BITS) - 1)]!;
    if (entry !== 0) {
      drop(entry & 15);
      return entry >>> 4;
    }
    // A longer code, read a bit at a time against the canonical counts.
    let code = 0;
    let first = 0;
    let index = 0;
    for (let len = 1; len <= MAX_BITS; len++) {
      code |= bits(1);
      const count = table.counts[len]!;
      if (code - first < count) return table.symbols[index + code - first]!;
      index += count;
      first = (first + count) << 1;
      code <<= 1;
    }
    throw new InflateError('corrupt');
  }

  function room(n: number) {
    const needed = outPos + n;
    if (needed > maxLength) throw new InflateError('too-big');
    if (needed <= out.length) return;
    let size = out.length;
    while (size < needed) size *= 2;
    const grown = new Uint8Array(Math.min(size, maxLength));
    grown.set(out.subarray(0, outPos));
    out = grown;
  }

  function stored() {
    // To the next whole byte; the bytes already taken into the buffer come first.
    drop(bitCount & 7);
    const length = bits(16);
    const inverse = bits(16);
    if ((length ^ 0xffff) !== inverse) throw new InflateError('corrupt');
    room(length);
    let left = length;
    while (left > 0 && bitCount >= 8) {
      out[outPos++] = bitBuf & 0xff;
      drop(8);
      left--;
    }
    if (left > data.length - pos) throw new InflateError('truncated');
    out.set(data.subarray(pos, pos + left), outPos);
    pos += left;
    outPos += left;
  }

  function dynamicTables(): [Huffman, Huffman] {
    const literals = bits(5) + 257;
    const distances = bits(5) + 1;
    const codeLengths = bits(4) + 4;
    if (literals > 286 || distances > 30) throw new InflateError('corrupt');
    const order = new Uint8Array(19);
    for (let i = 0; i < codeLengths; i++) order[LENGTH_ORDER[i]!] = bits(3);
    const lengthCode = buildHuffman(order, 19);
    const lengths = new Uint8Array(literals + distances);
    let at = 0;
    while (at < literals + distances) {
      const symbol = decode(lengthCode);
      if (symbol < 16) {
        lengths[at++] = symbol;
        continue;
      }
      let value = 0;
      let repeat: number;
      if (symbol === 16) {
        if (at === 0) throw new InflateError('corrupt');
        value = lengths[at - 1]!;
        repeat = 3 + bits(2);
      } else if (symbol === 17) {
        repeat = 3 + bits(3);
      } else {
        repeat = 11 + bits(7);
      }
      if (at + repeat > literals + distances) throw new InflateError('corrupt');
      while (repeat-- > 0) lengths[at++] = value;
    }
    // A block with no end-of-block code could never end.
    if (lengths[256] === 0) throw new InflateError('corrupt');
    return [buildHuffman(lengths, literals), buildHuffman(lengths.subarray(literals), distances)];
  }

  function codes(lengthTable: Huffman, distanceTable: Huffman) {
    for (;;) {
      const symbol = decode(lengthTable);
      if (symbol < 256) {
        if (outPos >= out.length) room(1);
        out[outPos++] = symbol;
        continue;
      }
      if (symbol === 256) return;
      const lengthIndex = symbol - 257;
      if (lengthIndex >= 29) throw new InflateError('corrupt');
      const length = LENGTH_BASE[lengthIndex]! + bits(LENGTH_EXTRA[lengthIndex]!);
      const distanceSymbol = decode(distanceTable);
      if (distanceSymbol >= 30) throw new InflateError('corrupt');
      const distance = DIST_BASE[distanceSymbol]! + bits(DIST_EXTRA[distanceSymbol]!);
      if (distance > outPos) throw new InflateError('corrupt');
      room(length);
      // Byte by byte: the copy may overlap what it writes (a run).
      let from = outPos - distance;
      for (let n = 0; n < length; n++) out[outPos++] = out[from++]!;
    }
  }

  for (;;) {
    const last = bits(1);
    const type = bits(2);
    if (type === 0) stored();
    else if (type === 1) {
      const [lengthTable, distanceTable] = fixedTables();
      codes(lengthTable, distanceTable);
    } else if (type === 2) {
      const [lengthTable, distanceTable] = dynamicTables();
      codes(lengthTable, distanceTable);
    } else throw new InflateError('corrupt');
    if (last) break;
  }
  return outPos === out.length ? out : out.slice(0, outPos);
}

let crcTable: Uint32Array | undefined;

/** CRC-32 (the 0xEDB88320 polynomial, as ZIP and gzip use), unsigned. */
export function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = crcTable[(crc ^ bytes[i]!) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
