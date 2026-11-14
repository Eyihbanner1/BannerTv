import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearSubtitleCache, loadSubtitles, plainId, toOption } from './subtitles';

const CHUNK = new Uint8Array(64 * 1024);
const MB = 1024 * 1024;

/** A body of `total` bytes made as it is read, counting how much was read. */
function counted(total: number, chunk = CHUNK) {
  const read = { bytes: 0 };
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (read.bytes >= total) {
        controller.close();
        return;
      }
      read.bytes += chunk.length;
      controller.enqueue(chunk);
    },
  });
  return { stream, read };
}

function serve(body: ReadableStream<Uint8Array>) {
  vi.stubGlobal('fetch', () => Promise.resolve(new Response(body)));
}

beforeEach(() => {
  vi.stubGlobal('window', globalThis);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('plainId', () => {
  it('keeps an addon’s plain id, and hashes a link, so no key ever holds one', () => {
    expect(plainId('en1')).toBe('en1');
    expect(plainId('1954741')).toBe('1954741');
    const link = 'https://subs.example.com/account-key/file.srt';
    const hashed = plainId(link);
    expect(hashed).toMatch(/^h[0-9a-z]+$/);
    expect(hashed).toBe(plainId(link));
    expect(hashed).not.toBe(plainId('https://subs.example.com/account-key/other.srt'));
  });
});

describe('toOption', () => {
  it('carries what the addon says of a file, and leaves out what it does not', () => {
    const subtitle = {
      id: '9397119',
      url: 'https://subs.example.com/9397119.srt',
      lang: 'eng',
      label: 'The.Last.of.Us.S01E01.1080p.WEB.H264-CAKES-HI.srt',
      releaseName: 'The.Last.of.Us.S01E01.1080p.WEB.H264-CAKES',
      hashMatch: true,
      fps: 23.976,
      season: 1,
      episode: 1,
    };
    expect(toOption('os', 'OpenSubtitles v3', subtitle)).toEqual({
      key: 'os#9397119',
      source: 'OpenSubtitles v3',
      lang: 'eng',
      url: 'https://subs.example.com/9397119.srt',
      label: 'The.Last.of.Us.S01E01.1080p.WEB.H264-CAKES-HI.srt',
      releaseName: 'The.Last.of.Us.S01E01.1080p.WEB.H264-CAKES',
      hashMatch: true,
      fps: 23.976,
      season: 1,
      episode: 1,
    });
    expect(
      toOption('os', 'OpenSubtitles v3', {
        id: '1',
        url: 'https://subs.example.com/1.srt',
        lang: 'eng',
      }),
    ).toEqual({
      key: 'os#1',
      lang: 'eng',
      source: 'OpenSubtitles v3',
      url: 'https://subs.example.com/1.srt',
    });
  });
});

describe('loadSubtitles', () => {
  it('reads a file that arrives in pieces', async () => {
    const text = new TextEncoder().encode('1\n00:00:01,000 --> 00:00:02,000\nHello there\n');
    serve(
      new ReadableStream({
        start(controller) {
          controller.enqueue(text.slice(0, 20));
          controller.enqueue(text.slice(20));
          controller.close();
        },
      }),
    );
    const cues = await loadSubtitles({ url: 'https://subs.example.com/pieces.srt', lang: 'eng' });
    expect(cues.map((cue) => cue.lines[0]![0]!.text)).toEqual(['Hello there']);
  });

  it('reads a file once, and again after the files read so far are forgotten', async () => {
    let fetched = 0;
    vi.stubGlobal('fetch', () => {
      fetched++;
      return Promise.resolve(new Response('1\n00:00:01,000 --> 00:00:02,000\nHello there\n'));
    });
    const file = { url: 'https://subs.example.com/kept.srt', lang: 'eng' };
    await loadSubtitles(file);
    await loadSubtitles(file);
    expect(fetched).toBe(1);
    clearSubtitleCache();
    await loadSubtitles(file);
    expect(fetched).toBe(2);
  });

  it('stops reading a file with no declared size once it passes 5 MB', async () => {
    const { stream, read } = counted(50 * MB);
    serve(stream);
    await expect(
      loadSubtitles({ url: 'https://subs.example.com/endless.srt', lang: 'eng' }),
    ).rejects.toThrow('too big');
    expect(read.bytes).toBeLessThan(6 * MB);
  });

  it('stops unpacking a small gzip that grows past 5 MB', async () => {
    const unpacked = counted(50 * MB);
    // Any gzip unpacks to the 50 MB body.
    class Decompression {
      writable = new WritableStream();
      readable = unpacked.stream;
    }
    vi.stubGlobal('DecompressionStream', Decompression);
    serve(new Blob([new Uint8Array([0x1f, 0x8b, 8, 0])]).stream());
    await expect(
      loadSubtitles({ url: 'https://subs.example.com/bomb.srt.gz', lang: 'eng' }),
    ).rejects.toThrow('too big');
    expect(unpacked.read.bytes).toBeLessThan(6 * MB);
  });
});
