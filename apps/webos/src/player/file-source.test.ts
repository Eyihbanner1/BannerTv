import { describe, expect, it } from 'vitest';
import { createFetchSource, FileReadError, type FileReadFailure, MAX_WALKS } from './file-source';

// As on the TV: the addon's resolve link, which leads to the debrid service's CDN.
const LINK = 'https://resolve.example.com/resolve/debrid/KEY/abc/Film.2023.2160p.WEB-DL.mkv';
const CDN = 'https://cdn.example.com/f/1/Film.2023.2160p.WEB-DL.mkv';
const SIZE = 300 * 1024;

/** Bytes that differ along the file, so a read from the wrong place shows. */
const FILE = (() => {
  const bytes = new Uint8Array(SIZE);
  let seed = 11;
  for (let i = 0; i < SIZE; i++) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    bytes[i] = seed >> 16;
  }
  return bytes;
})();

interface Server {
  /** The link's answers: a new CDN token for each walk. */
  walks?: boolean;
  /** Reads straight to a CDN link it answers before refusing (403); Infinity never refuses. */
  directReads?: number;
  /** The server ignores ranges: the whole file, 200. */
  ignoreRange?: boolean;
  /** Each 206 starts this many bytes later than asked. */
  elsewhere?: number;
  /** Content-Range hidden, as behind cross-origin checks. */
  hideRange?: boolean;
  /** Each 206 sends this many bytes more than asked. */
  overLong?: number;
  /** Every request rejects as a blocked one does. */
  blocked?: boolean;
  contentType?: string;
}

interface Asked {
  url: string;
  range: string;
  aborted: boolean;
  bodyPulls: number;
}

function answer(response: Response, url: string): Response {
  Object.defineProperty(response, 'url', { value: url });
  return response;
}

/** A body that counts how often it was read from, in chunks of 16 KB. */
function body(bytes: Uint8Array, asked: Asked): ReadableStream<Uint8Array> {
  let at = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      asked.bodyPulls++;
      if (at >= bytes.length) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.slice(at, at + 16 * 1024));
      at += 16 * 1024;
    },
  });
}

function serve(server: Server = {}) {
  const asked: Asked[] = [];
  let minted = 0;
  const reads = new Map<string, number>();
  const fetcher = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const range = (init?.headers as Record<string, string>).Range!;
    const entry: Asked = { url, range, aborted: !!init?.signal?.aborted, bodyPulls: 0 };
    asked.push(entry);
    init?.signal?.addEventListener('abort', () => (entry.aborted = true));
    if (init?.signal?.aborted) throw new DOMException('', 'AbortError');
    if (server.blocked) throw new TypeError('Failed to fetch');
    let landed = url;
    if (url === LINK) landed = `${CDN}?token=t${++minted}`;
    else {
      const count = (reads.get(url) ?? 0) + 1;
      reads.set(url, count);
      if (count > (server.directReads ?? Infinity)) {
        return answer(new Response('', { status: 403 }), url);
      }
    }
    const match = /bytes=(\d+)-(\d+)/.exec(range)!;
    const type = { 'content-type': server.contentType ?? 'video/x-matroska' };
    if (server.ignoreRange) {
      return answer(new Response(body(FILE, entry), { status: 200, headers: type }), landed);
    }
    const start = Number(match[1]) + (server.elsewhere ?? 0);
    if (start >= SIZE) {
      return answer(new Response('', { status: 416, headers: type }), landed);
    }
    const end = Math.min(SIZE - 1, Number(match[2]) + (server.overLong ?? 0));
    const headers: Record<string, string> = { ...type };
    if (!server.hideRange) headers['content-range'] = `bytes ${start}-${end}/${SIZE}`;
    return answer(
      new Response(body(FILE.slice(start, end + 1), entry), { status: 206, headers }),
      landed,
    );
  };
  return { asked, fetcher };
}

const slice = (start: number, length: number) => Array.from(FILE.slice(start, start + length));

async function failure(promise: Promise<unknown>): Promise<FileReadFailure | 'none'> {
  try {
    await promise;
    return 'none';
  } catch (error) {
    expect(error).toBeInstanceOf(FileReadError);
    return (error as FileReadError).code;
  }
}

describe('reading a file by ranges', () => {
  it('serves reads inside the hash’s first bytes from memory', async () => {
    const { asked, fetcher } = serve();
    const source = createFetchSource(
      { link: LINK, landed: `${CDN}?token=t0`, head: FILE.slice(0, 65536) },
      fetcher,
    );
    expect(Array.from(await source.read(0, 65536))).toEqual(slice(0, 65536));
    expect(Array.from(await source.read(1000, 50))).toEqual(slice(1000, 50));
    expect(asked).toEqual([]);
    expect(source.stats).toEqual({ requests: 0, bytes: 0, walks: 0 });
    // One that runs past them reads only the rest, straight from where the hash read landed.
    expect(Array.from(await source.read(65000, 2000))).toEqual(slice(65000, 2000));
    expect(asked.map(({ url, range }) => [url, range])).toEqual([
      [`${CDN}?token=t0`, 'bytes=65536-66999'],
    ]);
  });

  it('walks the stream’s link once, and reads straight from where it led after', async () => {
    const { asked, fetcher } = serve();
    const source = createFetchSource({ link: LINK }, fetcher);
    expect(Array.from(await source.read(0, 65536))).toEqual(slice(0, 65536));
    expect(Array.from(await source.read(200000, 4096))).toEqual(slice(200000, 4096));
    expect(Array.from(await source.read(100000, 100))).toEqual(slice(100000, 100));
    expect(asked.map(({ url }) => url)).toEqual([LINK, `${CDN}?token=t1`, `${CDN}?token=t1`]);
    expect(source.stats).toEqual({ requests: 3, bytes: 65536 + 4096 + 100, walks: 1 });
    // The size from the first Content-Range keeps reads inside the file.
    expect(source.size).toBe(SIZE);
    expect(Array.from(await source.read(SIZE - 10, 100))).toEqual(slice(SIZE - 10, 10));
  });

  it('walks again, once, when the link it led to expires after serving reads', async () => {
    const { asked, fetcher } = serve({ directReads: 2 });
    const source = createFetchSource({ link: LINK }, fetcher);
    await source.read(0, 100);
    await source.read(1000, 100);
    await source.read(2000, 100);
    // Refused at t1: walked again for it, and t2 answers the next.
    expect(Array.from(await source.read(3000, 100))).toEqual(slice(3000, 100));
    expect(Array.from(await source.read(4000, 100))).toEqual(slice(4000, 100));
    expect(asked.map(({ url }) => url.replace(CDN, 'cdn').replace(LINK, 'link'))).toEqual([
      'link',
      'cdn?token=t1',
      'cdn?token=t1',
      'cdn?token=t1',
      'link',
      'cdn?token=t2',
    ]);
    expect(source.stats.walks).toBe(2);
    expect(source.stats.requests).toBe(6);
    expect(source.failure()).toBeUndefined();
  });

  it('gives up on a link good for one use once the read in hand has walked again', async () => {
    const { asked, fetcher } = serve({ directReads: 0 });
    const source = createFetchSource({ link: LINK }, fetcher);
    await source.read(0, 100);
    expect(Array.from(await source.read(5000, 100))).toEqual(slice(5000, 100));
    expect(source.failure()).toBe('one-use');
    expect(await failure(source.read(9000, 100))).toBe('one-use');
    // The first walk, the refusal straight to it, the walk for the read in hand; nothing after.
    expect(asked.map(({ url }) => url === LINK)).toEqual([true, false, true]);
    expect(source.stats.walks).toBe(2);
  });

  it('takes the hash read’s link for one that served reads, and stops walking at the cap', async () => {
    const { asked, fetcher } = serve({ directReads: 1 });
    // Each walk's link answers one read straight to it, then refuses.
    const source = createFetchSource({ link: LINK, landed: `${CDN}?token=t0` }, fetcher);
    expect(Array.from(await source.read(0, 100))).toEqual(slice(0, 100));
    // Refused at t0, which served: walks, and t1 is new, so it must serve before it can expire.
    for (let at = 1000; at <= 6000; at += 1000) {
      expect(Array.from(await source.read(at, 100))).toEqual(slice(at, 100));
    }
    expect(source.stats.walks).toBe(MAX_WALKS);
    expect(await failure(source.read(7000, 100))).toBe('refused');
    expect(await failure(source.read(8000, 100))).toBe('refused');
    expect(asked.filter(({ url }) => url === LINK)).toHaveLength(MAX_WALKS);
    expect(source.failure()).toBe('refused');
  });

  it('shares one walk among reads refused at once', async () => {
    const { asked, fetcher } = serve({ directReads: 2 });
    const source = createFetchSource({ link: LINK }, fetcher);
    await source.read(0, 100);
    await source.read(100, 100);
    await source.read(200, 100);
    const both = await Promise.all([source.read(1000, 100), source.read(2000, 100)]);
    expect(both.map((bytes) => Array.from(bytes))).toEqual([slice(1000, 100), slice(2000, 100)]);
    expect(asked.filter(({ url }) => url === LINK)).toHaveLength(2);
  });

  it('stops at the headers of a whole file sent for a range, and gives up', async () => {
    const { asked, fetcher } = serve({ ignoreRange: true });
    const source = createFetchSource({ link: LINK }, fetcher);
    expect(await failure(source.read(0, 65536))).toBe('no-range');
    expect(asked[0]!.aborted).toBe(true);
    expect(asked[0]!.bodyPulls).toBeLessThanOrEqual(1);
    expect(source.stats.bytes).toBe(0);
    expect(await failure(source.read(0, 100))).toBe('no-range');
    expect(asked).toHaveLength(1);
  });

  it('gives up on a 206 that starts elsewhere', async () => {
    const { fetcher } = serve({ elsewhere: 512 });
    const source = createFetchSource({ link: LINK }, fetcher);
    expect(await failure(source.read(0, 100))).toBe('no-range');
    expect(source.failure()).toBe('no-range');
  });

  it('keeps only what was asked of an answer that sends more, and stops reading it', async () => {
    const { asked, fetcher } = serve({ overLong: 100000 });
    const source = createFetchSource({ link: LINK }, fetcher);
    const bytes = await source.read(0, 20000);
    expect(Array.from(bytes)).toEqual(slice(0, 20000));
    // Two 16 KB chunks hold the 20,000 bytes: the rest of the answer is never read.
    expect(asked[0]!.bodyPulls).toBeLessThanOrEqual(3);
    expect(source.stats.bytes).toBe(32768);
  });

  it('takes a 206 alone where Content-Range is hidden', async () => {
    const { fetcher } = serve({ hideRange: true });
    const source = createFetchSource({ link: LINK }, fetcher);
    expect(Array.from(await source.read(4096, 100))).toEqual(slice(4096, 100));
    expect(source.size).toBeUndefined();
    // Past the end, the server's 416 is no bytes.
    expect((await source.read(SIZE + 10, 100)).length).toBe(0);
    expect(source.failure()).toBeUndefined();
  });

  it('says the first request was blocked when it never gets an answer', async () => {
    const { fetcher } = serve({ blocked: true });
    const source = createFetchSource({ link: LINK }, fetcher);
    expect(await failure(source.read(0, 100))).toBe('blocked');
    expect(await failure(source.read(0, 100))).toBe('blocked');
  });

  it('stops at the headers of a file the server says is an MP4', async () => {
    const { asked, fetcher } = serve({ contentType: 'video/mp4' });
    const source = createFetchSource({ link: LINK }, fetcher);
    expect(await failure(source.read(0, 65536))).toBe('not-matroska');
    expect(asked[0]!.aborted).toBe(true);
    expect(source.stats.bytes).toBe(0);
    // Matroska, WebM, or no word of the kind, goes on.
    for (const contentType of ['video/x-matroska', 'video/webm', 'application/octet-stream', '']) {
      const other = createFetchSource({ link: LINK }, serve({ contentType }).fetcher);
      expect((await other.read(0, 10)).length).toBe(10);
    }
  });

  it('aborts the fetch with the caller’s signal, and reads on after', async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const { asked, fetcher } = serve();
    const slow: typeof fetch = async (input, init) => {
      await held;
      return fetcher(input, init);
    };
    const source = createFetchSource({ link: LINK }, slow);
    const controller = new AbortController();
    const reading = source.read(0, 100, controller.signal);
    controller.abort();
    release();
    expect(await failure(reading)).toBe('aborted');
    expect(asked[0]!.aborted).toBe(true);
    expect(source.failure()).toBeUndefined();
    expect((await source.read(0, 100)).length).toBe(100);
    // A signal aborted before the read makes no request.
    const before = asked.length;
    expect(await failure(source.read(0, 100, AbortSignal.abort()))).toBe('aborted');
    expect(asked).toHaveLength(before);
  });

  it('never says the link nor where it led', async () => {
    const errors: unknown[] = [];
    for (const server of [{ blocked: true }, { directReads: 0 }, { ignoreRange: true }]) {
      const source = createFetchSource({ link: LINK }, serve(server).fetcher);
      for (let i = 0; i < 3; i++) await source.read(i * 1000, 100).catch((e) => errors.push(e));
      errors.push(source.stats, source.failure());
    }
    expect(errors.length).toBeGreaterThan(6);
    for (const said of errors) {
      const text = `${JSON.stringify(said)} ${said instanceof Error ? `${said.message} ${said.stack ?? ''}` : ''}`;
      for (const secret of ['example.com', 'token=', 'KEY', 'Film.2023']) {
        expect(text).not.toContain(secret);
      }
    }
  });
});
