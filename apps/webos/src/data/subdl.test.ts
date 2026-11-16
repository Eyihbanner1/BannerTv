import { type CacheRecord, createQueryCache } from '@bannertv/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

// What the TV keeps, in memory: the key-value store and the answers cached.
const saved = vi.hoisted(() => new Map<string, unknown>());
const cached = vi.hoisted(() => new Map<string, unknown>());
// What SubDL answers each request, and the requests it saw.
const sub = vi.hoisted(() => ({
  answer: (() => ({ status: 200, body: {} })) as (url: string) => { status: number; body: unknown },
  seen: [] as Array<{ url: string; headers: Record<string, string> }>,
}));

vi.mock('./storage', () => {
  const kv = {
    get: (key: string) => Promise.resolve(saved.get(key)),
    set: (key: string, value: unknown) => {
      saved.set(key, value);
      return Promise.resolve();
    },
  };
  return { storage: { kv }, profileKv: kv };
});
vi.mock('./profiles', () => ({ isKidsProfile: () => false }));
vi.mock('./addons', () => ({
  queryCache: createQueryCache({
    store: {
      read: (key: string) => Promise.resolve(cached.get(key) as CacheRecord | undefined),
      write: (key: string, record: CacheRecord) => {
        cached.set(key, record);
        return Promise.resolve();
      },
    },
  }),
  runForPlay: (_type: string, _id: string, task: () => Promise<unknown>) => task(),
}));
vi.mock('../platform/http', () => ({
  requestJson: (url: string, init: { headers: Record<string, string> }) => {
    sub.seen.push({ url, headers: init.headers });
    return Promise.resolve(sub.answer(url));
  },
}));

const {
  isSubdlDownload,
  removeSubdlKey,
  saveSubdlKey,
  setSubdlKeyState,
  subdl,
  subdlKey,
  subdlUsage,
} = await import('./subdl');
const { recentSubtitleTraces } = await import('../player/subtitle-trace');

const FAKE = 'FAKE-SUBDL-KEY-0000';

const row = (id: number) => ({
  release_name: 'Test.Film.2026.1080p.WEB-DL.DDP5.1.H.264-GRPA',
  language: 'EN',
  url: `/subtitle/${id}-${id + 100000}.zip`,
  releases: ['Test.Film.2026.1080p.WEB-DL.DDP5.1.H.264-GRPA'],
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  removeSubdlKey();
});

describe('the SubDL key', () => {
  it('is saved only when it can be a key, as not yet tried', async () => {
    expect(saveSubdlKey('not a key')).toBe('bad');
    expect(subdlKey.get()).toBeNull();
    expect(saveSubdlKey(`  ${FAKE} `)).toBe('saved');
    expect(subdlKey.get()).toEqual({ key: FAKE, state: 'unchecked' });
    await flush();
    expect(saved.get('subdl/key')).toEqual({ key: FAKE, state: 'unchecked' });
  });

  it('goes back to not yet tried when saved again, even once refused', () => {
    saveSubdlKey(FAKE);
    setSubdlKeyState(FAKE, 'refused');
    expect(subdlKey.get()?.state).toBe('refused');
    saveSubdlKey(FAKE);
    expect(subdlKey.get()).toEqual({ key: FAKE, state: 'unchecked' });
  });

  it('keeps what SubDL said only for the key it said it of', () => {
    saveSubdlKey(FAKE);
    setSubdlKeyState('OTHER-FAKE-KEY-0001', 'works');
    expect(subdlKey.get()?.state).toBe('unchecked');
  });

  it('leaves a key saved meanwhile as it is when the old key is refused', async () => {
    saveSubdlKey(FAKE);
    let answer: (value: { status: number; body: unknown }) => void = () => undefined;
    const before = sub.answer;
    sub.answer = () =>
      new Promise((resolve) => {
        answer = resolve;
      }) as unknown as { status: number; body: unknown };
    try {
      const search = subdl.search('movie', 'tt9900005', ['en']);
      search.load();
      await vi.waitFor(() => expect(sub.seen.length).toBeGreaterThan(0));
      // The account brings a new key while the old one's search is out.
      await subdlKey.updateNow(() => ({ key: 'FAKE-SUBDL-KEY-0002', state: 'unchecked' }));
      answer({ status: 401, body: undefined });
      await vi.waitFor(() =>
        expect(search.get()).toMatchObject({ status: 'failed', why: 'refused' }),
      );
      await flush();
      expect(subdlKey.get()).toEqual({ key: 'FAKE-SUBDL-KEY-0002', state: 'unchecked' });
    } finally {
      sub.answer = before;
      sub.seen.length = 0;
    }
  });

  it('is removed', async () => {
    saveSubdlKey(FAKE);
    removeSubdlKey();
    expect(subdlKey.get()).toBeNull();
    await flush();
    expect(saved.get('subdl/key')).toBeNull();
  });

  it("tells SubDL's download host", () => {
    expect(isSubdlDownload('https://dl.subdl.com/subtitle/1/2')).toBe(true);
    expect(isSubdlDownload('https://dl.subdl.com.evil.example/x')).toBe(false);
    expect(isSubdlDownload('https://opensubtitles.example/x.srt')).toBe(false);
  });
});

describe('a whole SubDL flow with a fake key', () => {
  it('logs nothing and keeps the key out of everything but its own store', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((name) =>
      vi.spyOn(console, name).mockImplementation(() => undefined),
    );
    // Save, check, search: answered.
    saveSubdlKey(FAKE);
    sub.answer = (url) =>
      url.endsWith('/me')
        ? { status: 200, body: {} }
        : { status: 200, body: { subtitles: [row(9000001)] } };
    expect(await subdl.checkKey(FAKE)).toBe('works');
    setSubdlKeyState(FAKE, 'works');
    const first = subdl.search('movie', 'tt9900001', ['en']);
    first.load();
    await vi.waitFor(() => expect(first.get().status).toBe('answered'));
    // Refused: the key is marked so.
    sub.answer = () => ({ status: 403, body: { status: false, error: 'not_authorized' } });
    const refused = subdl.search('movie', 'tt9900003', ['en']);
    refused.load();
    await vi.waitFor(() =>
      expect(refused.get()).toMatchObject({ status: 'failed', why: 'refused' }),
    );
    expect(subdlKey.get()?.state).toBe('refused');
    // Saved again, then a slow-down: a rest.
    saveSubdlKey(FAKE);
    sub.answer = () => ({ status: 429, body: { error: { code: 'rate_limit' } } });
    const busy = subdl.search('movie', 'tt9900004', ['en']);
    busy.load();
    await vi.waitFor(() => expect(busy.get()).toMatchObject({ status: 'failed', why: 'busy' }));
    expect(subdlUsage.resting()?.why).toBe('busy');
    await flush();

    expect(sub.seen.length).toBe(4);
    for (const request of sub.seen) expect(request.url).not.toContain(FAKE);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    expect(JSON.stringify(recentSubtitleTraces())).not.toContain(FAKE);
    expect(cached.size).toBeGreaterThan(0);
    for (const [key, value] of [...saved, ...cached]) {
      if (key === 'subdl/key') continue;
      expect(JSON.stringify(value)).not.toContain(FAKE);
      expect(key).not.toContain(FAKE);
    }
    spies.forEach((spy) => spy.mockRestore());
  });
});
