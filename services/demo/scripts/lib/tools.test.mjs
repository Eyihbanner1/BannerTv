import { createServer } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { firstReachable } from './tools.mjs';

const SIZE = 110388897;
let server;
let base;

beforeAll(async () => {
  server = createServer((request, response) => {
    const { pathname } = new URL(request.url, 'http://localhost');
    if (pathname === '/gone.mp4') return response.writeHead(404).end();
    if (pathname === '/signed.mp4') {
      // Like video.blender.org's signed storage links: GET only.
      if (request.method === 'HEAD') return response.writeHead(403).end();
      if (request.headers.range !== 'bytes=0-0') return response.writeHead(400).end();
      return response
        .writeHead(206, { 'content-range': `bytes 0-0/${SIZE}`, 'content-length': '1' })
        .end('x');
    }
    if (pathname === '/plain.mp4') {
      return response.writeHead(200, { 'content-length': String(SIZE) }).end();
    }
    return response.writeHead(404).end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(() => new Promise((resolve) => server.close(resolve)));

describe('finding a source address', () => {
  it('takes the first address that answers HEAD', async () => {
    expect(await firstReachable([`${base}/plain.mp4`])).toEqual({
      url: `${base}/plain.mp4`,
      bytes: SIZE,
    });
  });

  it('asks for one byte when HEAD is refused, and reads the size from the range', async () => {
    expect(await firstReachable([`${base}/gone.mp4`, `${base}/signed.mp4`])).toEqual({
      url: `${base}/signed.mp4`,
      bytes: SIZE,
    });
  });

  it('says what each address answered when none works', async () => {
    await expect(firstReachable([`${base}/gone.mp4`])).rejects.toThrow(
      `${base}/gone.mp4: 404, then 404 for a GET`,
    );
  });
});
