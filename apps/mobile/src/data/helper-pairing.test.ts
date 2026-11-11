import { describe, expect, it, vi } from 'vitest';
import { readTvCode, sendHelperToTv } from './helper-pairing';

const HELPER = { host: '192.168.1.42', port: 47020, code: '123456' };

describe('readTvCode', () => {
  it('ignores case, spaces and dashes', () => {
    expect(readTvCode('abc 234')).toBe('ABC234');
    expect(readTvCode(' AB-C2-34 ')).toBe('ABC234');
  });

  it('refuses codes of the wrong length or with lookalike characters', () => {
    expect(readTvCode('ABC23')).toBeUndefined();
    expect(readTvCode('ABC2345')).toBeUndefined();
    expect(readTvCode('ABC0I1')).toBeUndefined();
  });
});

describe('sendHelperToTv', () => {
  it("posts the helper's address and code to the TV's session", async () => {
    const request = vi.fn(() => Promise.resolve(new Response('{"ok":true}', { status: 200 })));
    await expect(sendHelperToTv('abc 234', HELPER, request, 'https://pair.example')).resolves.toBe(
      'sent',
    );
    expect(request).toHaveBeenCalledTimes(1);
    const [url, init] = request.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://pair.example/api/sessions/ABC234');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      url: 'http://192.168.1.42:47020/pair?code=123456',
    });
  });

  it('says why it could not send', async () => {
    const answer = (status: number) => () => Promise.resolve(new Response('{}', { status }));
    expect(await sendHelperToTv('ABC234', HELPER, answer(404), 'https://p')).toBe('gone');
    expect(await sendHelperToTv('ABC234', HELPER, answer(409), 'https://p')).toBe('used');
    expect(await sendHelperToTv('ABC234', HELPER, answer(503), 'https://p')).toBe('offline');
    const down = () => Promise.reject(new TypeError('Network request failed'));
    expect(await sendHelperToTv('ABC234', HELPER, down, 'https://p')).toBe('offline');
  });

  it('asks nothing for a malformed TV code or a helper with no code yet', async () => {
    const request = vi.fn();
    expect(await sendHelperToTv('ABC', HELPER, request, 'https://p')).toBe('bad-code');
    expect(await sendHelperToTv('ABC234', { ...HELPER, code: '' }, request, 'https://p')).toBe(
      'bad-code',
    );
    expect(request).not.toHaveBeenCalled();
  });
});
