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
   *
   * Once `signal` aborts, the source stops fetching and rejects soon after.
   * The source sets no time limit of its own on a read that has a signal:
   * the window (matroska-window.ts) aborts each of its reads after 15 s.
   * Reads made with no signal (openMatroska and readMatroskaCues unless
   * given one) are the caller's to bound, by aborting the signal it passes
   * them or by a time limit in the source.
   */
  read(start: number, length: number, signal?: ReadSignal): Promise<Uint8Array>;
  /** The file's size in bytes, when known: reads are kept inside it. */
  size?: number;
}

/**
 * What a source needs of an AbortSignal. The reader hands over the
 * engine's own where it has one (every engine the apps run in does), so a
 * source can pass it straight to fetch; otherwise a stand-in of this shape.
 */
export interface ReadSignal {
  readonly aborted: boolean;
  addEventListener(type: 'abort', listener: () => void): void;
  removeEventListener(type: 'abort', listener: () => void): void;
}

export interface ReadCanceller {
  signal: ReadSignal;
  abort(): void;
}

// The core is typed without the DOM; Chromium 66 and later, React Native and Node have it.
declare const AbortController: (new () => { signal: ReadSignal; abort(): void }) | undefined;

/** A signal and the means to abort it. */
export function readCanceller(): ReadCanceller {
  if (typeof AbortController !== 'undefined') {
    const controller = new AbortController();
    return { signal: controller.signal, abort: () => controller.abort() };
  }
  const listeners = new Set<() => void>();
  const signal = {
    aborted: false,
    addEventListener(_type: 'abort', listener: () => void) {
      listeners.add(listener);
    },
    removeEventListener(_type: 'abort', listener: () => void) {
      listeners.delete(listener);
    },
  };
  return {
    signal,
    abort() {
      if (signal.aborted) return;
      signal.aborted = true;
      for (const listener of Array.from(listeners)) listener();
      listeners.clear();
    },
  };
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
    async read(start, length, signal) {
      let wanted = length;
      if (source.size !== undefined) wanted = Math.max(0, Math.min(length, source.size - start));
      if (wanted <= 0) return new Uint8Array(0);
      stats.requests++;
      const bytes = await source.read(start, wanted, signal);
      stats.bytes += bytes.length;
      return bytes;
    },
  };
}
