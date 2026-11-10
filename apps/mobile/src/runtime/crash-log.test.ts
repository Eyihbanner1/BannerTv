import { describe, expect, it } from 'vitest';
import {
  addProblem,
  addVisit,
  type Caught,
  CRASH_LOG_KEY,
  crashScreenStep,
  KEEP_PROBLEMS,
  KEEP_SCREENS,
  phoneLine,
  type Problem,
  problemFrom,
  type ProblemStorage,
  problemStore,
  readProblems,
  reportText,
  screenPath,
} from './crash-log';

const NOW = Date.UTC(2026, 10, 9, 14, 5, 12);
const MINUTE = 60_000;
const UPDATE = '0d6c2d8a-5d37-4c1b-9a77-4a5b0f6f9e21';

function caught(over: Partial<Caught> = {}): Caught {
  return {
    at: NOW,
    version: '0.1.0',
    updateId: UPDATE,
    screen: '/player',
    screens: [
      { path: '/', at: NOW - 3 * MINUTE },
      { path: '/title', at: NOW - 2 * MINUTE },
      { path: '/player', at: NOW - MINUTE },
    ],
    ...over,
  };
}

function memory(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial));
  const storage: ProblemStorage = {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
  };
  return { items, storage };
}

/** An error as Hermes builds one: the message, then its frames. */
function hermesError(message: string, frames: string[]): Error {
  const error = new TypeError(message);
  error.stack = [`TypeError: ${message}`, ...frames.map((frame) => `    at ${frame}`)].join('\n');
  return error;
}

describe('screenPath', () => {
  it('keeps route names and nothing else', () => {
    expect(screenPath('/')).toBe('/');
    expect(screenPath('')).toBe('/');
    expect(screenPath('/settings')).toBe('/settings');
    expect(screenPath('/manage-profiles')).toBe('/manage-profiles');
    expect(screenPath('/title?type=movie&id=tt0111161')).toBe('/title');
    expect(screenPath('/stremio:/torrentio.strem.fun/abc/manifest.json')).toBe('/…');
    expect(screenPath('/title/tt0111161/Some Name')).toBe('/title/…');
  });
});

describe('addVisit', () => {
  it('adds each change of screen, once, and keeps the last ones', () => {
    let trail = addVisit([], '/', 1);
    trail = addVisit(trail, '/', 2);
    trail = addVisit(trail, '/search?q=secret', 3);
    expect(trail).toEqual([
      { path: '/', at: 1 },
      { path: '/search', at: 3 },
    ]);
    for (let i = 0; i < 30; i++) trail = addVisit(trail, i % 2 ? '/title' : '/streams', 10 + i);
    expect(trail).toHaveLength(KEEP_SCREENS);
    expect(trail[trail.length - 1]).toEqual({ path: '/title', at: 39 });
  });
});

describe('problemFrom', () => {
  it('keeps the name, message, first frames, build and screens, redacted', () => {
    const error = hermesError(
      'Failed https://torrentio.strem.fun/realdebrid=ABCDEFGHJKMNPQRST234/stream/movie/tt1.json',
      [
        'fetchStreams (address at index.android.bundle:1:2345)',
        'anonymous (https://addon.example/private/abc:1:2)',
        ...Array.from(
          { length: 20 },
          (_, i) => `frame${i} (address at index.android.bundle:1:${i})`,
        ),
      ],
    );
    const problem = problemFrom(error, 'crash', caught({ screen: '/player?id=x' }));
    expect(problem.message).toBe('TypeError: Failed https://torrentio.strem.fun/…');
    expect(problem.stack[0]).toBe('at fetchStreams (address at index.android.bundle:1:2345)');
    expect(problem.stack[1]).toBe('at anonymous (https://addon.example/…:1:2)');
    expect(problem.stack).toHaveLength(8);
    expect(problem).toMatchObject({
      at: NOW,
      kind: 'crash',
      version: '0.1.0',
      updateId: UPDATE,
      screen: '/player',
    });
    expect(problem.screens.map((visit) => visit.path)).toEqual(['/', '/title', '/player']);
    expect(JSON.stringify(problem)).not.toMatch(/realdebrid|ABCDEFGH|private/);
  });

  it('reads whatever was thrown or rejected', () => {
    expect(problemFrom('plain words', 'error', caught()).message).toBe('plain words');
    expect(problemFrom(undefined, 'promise', caught()).message).toBe('Error: undefined');
    expect(problemFrom(null, 'promise', caught()).message).toBe('Error: null');
    expect(
      problemFrom({ message: 'from a library', code: 'E1' }, 'promise', caught()).message,
    ).toBe('Error: from a library');
    expect(problemFrom({ status: 401, token: 'abc' }, 'promise', caught()).message).toBe(
      '{"status":401,"token":"[hidden]"}',
    );
    expect(problemFrom(new Error(''), 'error', caught()).message).toBe('Error');
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(problemFrom(circular, 'promise', caught()).message).toBe('[object Object]');
  });

  it('keeps a message short, and never half a secret', () => {
    const long = `${'word '.repeat(70)}token${'A1'.repeat(30)}`;
    const problem = problemFrom(new Error(long), 'error', caught());
    expect(problem.message.length).toBeLessThanOrEqual(300);
    expect(problem.message.endsWith('…')).toBe(true);
    expect(problem.message).not.toContain('A1A1');
  });
});

describe('addProblem', () => {
  const problem = (at: number, message = 'TypeError: x'): Problem =>
    problemFrom(new Error(message.replace(/^Error: /, '')), 'error', caught({ at }));

  it('keeps the newest first, and only the last few', () => {
    let problems: Problem[] = [];
    for (let i = 0; i < 8; i++) problems = addProblem(problems, problem(NOW + i * MINUTE, `n${i}`));
    expect(problems).toHaveLength(KEEP_PROBLEMS);
    expect(problems[0]!.message).toBe('Error: n7');
    expect(problems[4]!.message).toBe('Error: n3');
  });

  it('keeps one problem caught twice at once, but the same one again later', () => {
    const error = new Error('twice');
    const at = (time: number) => problemFrom(error, 'error', caught({ at: time }));
    let problems = addProblem([], at(NOW));
    problems = addProblem(problems, at(NOW + 500));
    expect(problems).toHaveLength(1);
    problems = addProblem(problems, at(NOW + MINUTE));
    expect(problems).toHaveLength(2);
  });
});

describe('problemStore', () => {
  it('keeps each problem for the next launch, so a crash survives it', () => {
    const { items, storage } = memory();
    const store = problemStore(storage);
    expect(store.get()).toEqual([]);
    const crash = problemFrom(new Error('boom'), 'crash', caught());
    store.set(addProblem(store.get(), crash));
    expect(JSON.parse(items.get(CRASH_LOG_KEY)!).problems).toHaveLength(1);
    expect(problemStore(storage).get()).toEqual([crash]);
  });

  it('starts empty from storage it cannot read, and works without storage', () => {
    expect(readProblems('not json')).toEqual([]);
    expect(readProblems('{"problems":"no"}')).toEqual([]);
    expect(
      readProblems(
        JSON.stringify({
          problems: [
            { at: 'yesterday', kind: 'crash', message: 'x' },
            { at: 1, kind: 'meltdown', message: 'x' },
            {
              at: 2,
              kind: 'error',
              message: 'kept',
              screens: [{ path: '/' }, { path: '/a', at: 1 }],
            },
          ],
        }),
      ),
    ).toEqual([
      {
        at: 2,
        kind: 'error',
        message: 'kept',
        stack: [],
        version: '',
        updateId: null,
        screen: '/',
        screens: [{ path: '/a', at: 1 }],
      },
    ]);
    const broken: ProblemStorage = {
      getItem: () => {
        throw new Error('no storage');
      },
      setItem: () => {
        throw new Error('no storage');
      },
    };
    const store = problemStore(broken);
    store.set([problemFrom(new Error('boom'), 'crash', caught())]);
    expect(store.get()).toHaveLength(1);
  });
});

describe('crashScreenStep', () => {
  it("hands an update's failure before its first screen to expo-updates, and shows the rest", () => {
    expect(crashScreenStep({ firstScreenShown: false, updateLaunch: true })).toBe('handOver');
    expect(crashScreenStep({ firstScreenShown: true, updateLaunch: true })).toBe('show');
    expect(crashScreenStep({ firstScreenShown: false, updateLaunch: false })).toBe('show');
    expect(crashScreenStep({ firstScreenShown: true, updateLaunch: false })).toBe('show');
  });
});

describe('phoneLine', () => {
  it('names the Android version and the phone, and nothing that identifies it', () => {
    expect(
      phoneLine({ os: 'android', version: 34, release: '14', maker: 'Google', model: 'Pixel 8' }),
    ).toBe('Android 14 (API 34), Google Pixel 8');
    expect(
      phoneLine({
        os: 'android',
        version: 35,
        release: '15',
        maker: 'samsung',
        model: 'samsung SM-S911B',
      }),
    ).toBe('Android 15 (API 35), samsung SM-S911B');
    expect(phoneLine({ os: 'web' })).toBe('web');
  });
});

describe('reportText', () => {
  const base = {
    now: NOW,
    build: { version: '0.1.0', updateId: UPDATE },
    takesUpdates: true,
    phone: 'Android 14 (API 34), Google Pixel 8',
    screen: '/settings',
    screens: [
      { path: '/', at: NOW - 2 * MINUTE },
      { path: '/settings', at: NOW - MINUTE },
    ],
    problems: [] as Problem[],
  };

  it('has the basics with no problem: the app, its update, the phone and the screens', () => {
    expect(reportText(base)).toBe(
      [
        'BannerTV phone report',
        'Made: 2026-11-09 14:05:12 UTC',
        `App: 0.1.0, update ${UPDATE}`,
        'Phone: Android 14 (API 34), Google Pixel 8',
        'Screen: /settings',
        'Recent screens: / 14:03:12, /settings 14:04:12',
        '',
        'No problems recorded.',
      ].join('\n'),
    );
    const builtIn = reportText({ ...base, build: { version: '0.1.0', updateId: null } });
    expect(builtIn).toContain('App: 0.1.0, built-in code\n');
    const web = reportText({
      ...base,
      takesUpdates: false,
      build: { version: '0.1.0', updateId: null },
    });
    expect(web).toContain('App: 0.1.0, built-in code, takes no updates');
    expect(reportText({ ...base, screens: [] })).toContain('Recent screens: none yet');
  });

  it('lists each problem with its screen, time, message, frames and screens', () => {
    const crash = problemFrom(
      hermesError("Cannot read property 'id' of undefined", [
        'render (address at index.android.bundle:1:99)',
      ]),
      'crash',
      caught({ at: NOW - 5 * MINUTE, updateId: null }),
    );
    const screen = problemFrom(
      new Error('Rendered more hooks'),
      'screen',
      caught({ at: NOW - MINUTE }),
    );
    const text = reportText({ ...base, problems: addProblem(addProblem([], crash), screen) });
    expect(text).toContain('2 problems, newest first:');
    expect(text).toContain(
      '1. Screen error on /player, 2026-11-09 14:04:12 UTC\nError: Rendered more hooks',
    );
    expect(text).toContain(
      [
        '2. Crash on /player, 2026-11-09 14:00:12 UTC',
        // The build it happened on, when it is not the one running now.
        'App: 0.1.0, built-in code',
        "TypeError: Cannot read property 'id' of undefined",
        '  at render (address at index.android.bundle:1:99)',
        'Screens: / 14:02:12, /title 14:03:12, /player 14:04:12',
      ].join('\n'),
    );
  });

  it('redacts kept text again, and prints only an update id that is one', () => {
    const old: Problem = {
      ...problemFrom(new Error('x'), 'error', caught()),
      message: 'Error: kept before https://addon.example/key/manifest.json me@example.com',
      stack: ['at x (https://addon.example/abc/def:1:2)'],
      screen: '/title?id=secret',
      screens: [{ path: '/stremio:/x/y', at: NOW }],
    };
    const text = reportText({
      ...base,
      build: { version: '0.1.0', updateId: 'not-an-id me@example.com' },
      screen: '/title?id=secret',
      problems: [old],
    });
    expect(text).not.toMatch(/manifest|example\.com\/|abc|def|secret|me@|not-an-id|stremio/);
    expect(text).toContain('Error: kept before https://addon.example/… [email]');
    expect(text).toContain('App: 0.1.0, built-in code\n');
  });

  it('stays short with every problem at its longest', () => {
    const long = problemFrom(
      hermesError(
        'x '.repeat(400),
        Array.from({ length: 40 }, () => `f ${'y '.repeat(200)}`),
      ),
      'crash',
      caught({ screens: Array.from({ length: 40 }, (_, i) => ({ path: '/title', at: i })) }),
    );
    const text = reportText({
      ...base,
      screens: long.screens,
      problems: Array.from({ length: 9 }, () => long),
    });
    expect(text.length).toBeLessThanOrEqual(10_000);
    expect(text.match(/^\d\. Crash/gm)).toHaveLength(KEEP_PROBLEMS);
    // The newest keeps all its frames, the older ones their first few.
    expect(text.split('\n').filter((line) => line.startsWith('  at f'))).toHaveLength(8 + 4 * 4);
  });
});
