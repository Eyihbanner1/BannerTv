/**
 * Where a media file's bytes come from: a byte-range read and, when known,
 * the file's size. How the bytes are fetched (a page fetch with a Range
 * header, a service on the TV, a file on disk) is the platform's business;
 * the core only asks for ranges and counts what it asked for.
 */
export interface ByteSource {
  /**
   * `length` bytes from `start`. Fewer only where the file ends first, and
   * none at all from its end on. A read that fails rejects.
   */
  read(start: number, length: number): Promise<Uint8Array>;
  /** The file's size in bytes, when known: reads are kept inside it. */
  size?: number;
}

/** What a reader has asked its source for, so the cost of a play can be measured. */
export interface ReadStats {
  /** Reads asked for. */
  requests: number;
  /** Bytes received. */
  bytes: number;
}

/** A source over bytes already in memory, for tests and for files read whole. */
export function bytesSource(bytes: Uint8Array): ByteSource {
  return {
    size: bytes.length,
    read(start, length) {
      return Promise.resolve(bytes.subarray(start, Math.min(bytes.length, start + length)));
    },
  };
}

/** Wraps a source so that every read and every byte received is counted in `stats`. */
export function countedSource(source: ByteSource, stats: ReadStats): ByteSource {
  return {
    size: source.size,
    async read(start, length) {
      let wanted = length;
      if (source.size !== undefined) wanted = Math.max(0, Math.min(length, source.size - start));
      if (wanted <= 0) return new Uint8Array(0);
      stats.requests++;
      const bytes = await source.read(start, wanted);
      stats.bytes += bytes.length;
      return bytes;
    },
  };
}
