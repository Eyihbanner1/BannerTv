import { describe, expect, it } from 'vitest';
import {
  base64Url,
  choosePull,
  type Listed,
  MAX_BODY_CHARS,
  MAX_DOCS,
  MAX_PULL_CHARS,
  MAX_PUTS,
  MAX_WANT,
  readCreateKey,
  readMaxAccounts,
  readPull,
  readPullMinutes,
  readPush,
  readSigned,
  sameText,
  secondsToMidnight,
  utcDay,
  writesToday,
} from './rules';

/** A name, an id or an epoch: 22 characters, made distinct by the number. */
const id = (n: number) => `n${String(n).padStart(4, '0')}${'A'.repeat(17)}`;
const ACCOUNT = id(1);
const AUTH = 'K'.repeat(43);
const EPOCH = id(2);
const BODY = `1.${'I'.repeat(16)}.${'C'.repeat(40)}`;

describe('readSigned', () => {
  it('takes a 22-character account id and a 43-character auth key in base64url', () => {
    expect(readSigned({ account: ACCOUNT, auth: AUTH, other: 1 })).toEqual({
      account: ACCOUNT,
      auth: AUTH,
    });
    expect(readSigned({ account: 'abc-_09'.padEnd(22, 'z'), auth: AUTH })).toBeDefined();
    for (const value of [
      null,
      [],
      'text',
      { account: ACCOUNT },
      { auth: AUTH },
      { account: ACCOUNT.slice(1), auth: AUTH },
      { account: `${ACCOUNT}A`, auth: AUTH },
      { account: `${ACCOUNT.slice(1)}+`, auth: AUTH },
      { account: `${ACCOUNT.slice(1)}/`, auth: AUTH },
      { account: ACCOUNT, auth: AUTH.slice(1) },
      { account: ACCOUNT, auth: `${AUTH.slice(1)}=` },
      { account: ACCOUNT, auth: `${AUTH}K` },
      { account: 1, auth: AUTH },
    ]) {
      expect(readSigned(value), JSON.stringify(value)).toBeUndefined();
    }
  });
});

describe('readPull', () => {
  const signed = { account: ACCOUNT, auth: AUTH };

  it('takes the versions held and the names wanted, each once', () => {
    expect(
      readPull({ ...signed, epoch: EPOCH, have: { [id(3)]: 4 }, want: [id(3), id(4), id(3)] }),
    ).toEqual({
      ...signed,
      epoch: EPOCH,
      have: new Map([[id(3), 4]]),
      want: [id(3), id(4)],
    });
    // A screen that has not learned the epoch, or holds nothing yet, leaves them out.
    expect(readPull({ ...signed, want: [] })).toEqual({
      ...signed,
      epoch: undefined,
      have: new Map(),
      want: [],
    });
    expect(readPull({ ...signed, epoch: null, have: null, want: [] })).not.toBeTypeOf('string');
  });

  const many = (count: number) => Array.from({ length: count }, (_, n) => id(n));

  it('calls a pull too big past 64 names wanted or 120 held', () => {
    const versions = (count: number) => Object.fromEntries(many(count).map((n) => [n, 1]));
    expect(readPull({ ...signed, want: many(MAX_WANT) })).not.toBeTypeOf('string');
    expect(readPull({ ...signed, want: many(MAX_WANT + 1) })).toBe('too-big');
    expect(readPull({ ...signed, want: [], have: versions(MAX_DOCS) })).not.toBeTypeOf('string');
    expect(readPull({ ...signed, want: [], have: versions(MAX_DOCS + 1) })).toBe('too-big');
  });

  it('refuses anything else out of its form', () => {
    for (const value of [
      { want: [] },
      { ...signed },
      { ...signed, want: 'all' },
      { ...signed, want: ['short'] },
      { ...signed, want: [id(3)], epoch: 'short' },
      { ...signed, want: [], have: [] },
      { ...signed, want: [], have: { short: 1 } },
      { ...signed, want: [], have: { [id(3)]: -1 } },
      { ...signed, want: [], have: { [id(3)]: 1.5 } },
      { ...signed, want: [], have: { [id(3)]: '1' } },
      { ...signed, want: [], have: { [id(3)]: 2 ** 53 } },
    ]) {
      expect(readPull(value), JSON.stringify(value)).toBe('bad-request');
    }
    // JSON.parse makes __proto__ an ordinary key, which is not a name either.
    expect(
      readPull(
        JSON.parse(`{"account":"${ACCOUNT}","auth":"${AUTH}","want":[],"have":{"__proto__":1}}`),
      ),
    ).toBe('bad-request');
  });
});

describe('readPush', () => {
  const signed = { account: ACCOUNT, auth: AUTH, epoch: EPOCH };
  const put = (n: number, base = 0, body = BODY) => ({ name: id(n), base, body });

  it('takes the documents with the versions they started from', () => {
    expect(readPush({ ...signed, put: [put(3), put(4, 7)] })).toEqual({
      ...signed,
      put: [put(3), put(4, 7)],
    });
    expect(readPush({ ...signed, put: [] })).toEqual({ ...signed, put: [] });
    const longest = `1.${'I'.repeat(16)}.${'C'.repeat(MAX_BODY_CHARS - 19)}`;
    expect(readPush({ ...signed, put: [put(3, 0, longest)] })).not.toBeTypeOf('string');
  });

  it('calls a push too big past 12 documents or a body past 1,000,000 characters', () => {
    const puts = Array.from({ length: MAX_PUTS }, (_, n) => put(n));
    expect(readPush({ ...signed, put: puts })).not.toBeTypeOf('string');
    expect(readPush({ ...signed, put: [...puts, put(MAX_PUTS)] })).toBe('too-big');
    const long = `1.${'I'.repeat(16)}.${'C'.repeat(MAX_BODY_CHARS - 18)}`;
    expect(readPush({ ...signed, put: [put(3, 0, long)] })).toBe('too-big');
  });

  it('refuses anything else out of its form', () => {
    for (const value of [
      { account: ACCOUNT, auth: AUTH, put: [] },
      { ...signed, epoch: 'short', put: [] },
      { ...signed },
      { ...signed, put: {} },
      { ...signed, put: [null] },
      { ...signed, put: [{ name: id(3), body: BODY }] },
      { ...signed, put: [{ name: id(3), base: 0 }] },
      { ...signed, put: [put(3, -1)] },
      { ...signed, put: [put(3, 1.5)] },
      { ...signed, put: [{ ...put(3), base: '0' }] },
      { ...signed, put: [{ ...put(3), name: 'short' }] },
      { ...signed, put: [put(3), put(3, 1)] },
      { ...signed, put: [put(3, 0, '')] },
      { ...signed, put: [put(3, 0, '1.')] },
      { ...signed, put: [put(3, 0, '1.abc')] },
      { ...signed, put: [put(3, 0, '1.abc.')] },
      { ...signed, put: [put(3, 0, '2.abc.def')] },
      { ...signed, put: [put(3, 0, '1.ab+c.def')] },
      { ...signed, put: [put(3, 0, '1.abc.de=')] },
      { ...signed, put: [put(3, 0, '1.abc.def.ghi')] },
      { ...signed, put: [put(3, 0, '{"items":{}}')] },
      { ...signed, put: [put(3, 0, 42 as unknown as string)] },
    ]) {
      expect(readPush(value), JSON.stringify(value)).toBe('bad-request');
    }
  });
});

describe('choosePull', () => {
  const doc = (n: number, ver: number, size = 100): Listed => ({ name: id(n), ver, at: 1, size });

  it('gives the wanted documents whose version differs, in the order wanted', () => {
    const listing = [doc(1, 1), doc(2, 3), doc(3, 2)];
    expect(choosePull(listing, new Map(), [id(3), id(1), id(9)])).toEqual({
      names: [id(3), id(1)],
      more: false,
    });
    expect(choosePull(listing, new Map([[id(2), 3]]), [id(1), id(2), id(3)])).toEqual({
      names: [id(1), id(3)],
      more: false,
    });
    // A screen ahead of the server, after a restore, gets the server's version back.
    expect(choosePull(listing, new Map([[id(2), 5]]), [id(2)]).names).toEqual([id(2)]);
    expect(choosePull(listing, new Map(), [])).toEqual({ names: [], more: false });
  });

  it('stops before the bodies pass 1 MB, but always gives one', () => {
    const half = MAX_PULL_CHARS / 2;
    const listing = [doc(1, 1, half), doc(2, 1, half), doc(3, 1, 1)];
    expect(choosePull(listing, new Map(), [id(1), id(2), id(3)])).toEqual({
      names: [id(1), id(2)],
      more: true,
    });
    const big = [doc(1, 1, MAX_PULL_CHARS + 1), doc(2, 1, 1)];
    expect(choosePull(big, new Map(), [id(1), id(2)])).toEqual({ names: [id(1)], more: true });
  });
});

describe('days', () => {
  it('counts UTC days and the seconds to the next one', () => {
    const noon = Date.parse('2026-10-31T12:00:00Z');
    expect(utcDay(noon)).toBe(utcDay(Date.parse('2026-10-31T00:00:00Z')));
    expect(utcDay(Date.parse('2026-11-01T00:00:00Z'))).toBe(utcDay(noon) + 1);
    expect(secondsToMidnight(noon)).toBe(12 * 60 * 60);
    expect(secondsToMidnight(Date.parse('2026-10-31T23:59:59.500Z'))).toBe(1);
    expect(secondsToMidnight(Date.parse('2026-11-01T00:00:00Z'))).toBe(24 * 60 * 60);
  });

  it('starts the write count again each day', () => {
    expect(writesToday({ day: 100, writes: 40 }, 100)).toBe(40);
    expect(writesToday({ day: 99, writes: 40 }, 100)).toBe(0);
  });
});

describe('settings', () => {
  it('reads MAX_ACCOUNTS, closed when missing or unreadable', () => {
    expect(readMaxAccounts('1')).toBe(1);
    expect(readMaxAccounts(' 25 ')).toBe(25);
    for (const value of [undefined, null, '', 'one', '-1', '1.5', '1e3', true, -1, 1.5, NaN]) {
      expect(readMaxAccounts(value), String(value)).toBe(0);
    }
  });

  it('reads PULL_MINUTES, from 15 minutes to a day', () => {
    expect(readPullMinutes('30')).toBe(30);
    expect(readPullMinutes('120')).toBe(120);
    expect(readPullMinutes('1')).toBe(15);
    expect(readPullMinutes('100000')).toBe(24 * 60);
    for (const value of [undefined, null, '', 'often', '-5', '7.5', -5, 7.5, Infinity]) {
      expect(readPullMinutes(value), String(value)).toBe(30);
    }
  });

  it('takes a whole number as well as text, as TOML gives one without quotes', () => {
    expect(readMaxAccounts(2)).toBe(2);
    expect(readMaxAccounts(0)).toBe(0);
    expect(readPullMinutes(60)).toBe(60);
    expect(readPullMinutes(5)).toBe(15);
    expect(readPullMinutes(100000)).toBe(24 * 60);
  });

  it('reads CREATE_KEY, none when missing or blank', () => {
    expect(readCreateKey('k3yOnTheTV42')).toBe('k3yOnTheTV42');
    // A secret pasted into the dashboard can bring a space or a line break with it.
    expect(readCreateKey(' k3yOnTheTV42\n')).toBe('k3yOnTheTV42');
    for (const value of [undefined, null, '', '   ', 42]) {
      expect(readCreateKey(value), String(value)).toBe('');
    }
  });
});

describe('sameText', () => {
  it('compares whole strings', () => {
    expect(sameText(AUTH, 'K'.repeat(43))).toBe(true);
    expect(sameText(AUTH, `${'K'.repeat(42)}L`)).toBe(false);
    expect(sameText(AUTH, `L${'K'.repeat(42)}`)).toBe(false);
    expect(sameText(AUTH, AUTH.slice(1))).toBe(false);
    expect(sameText('', '')).toBe(true);
  });
});

describe('base64Url', () => {
  it('writes bytes in base64url without padding', () => {
    expect(base64Url(new Uint8Array([251, 255, 191]))).toBe('-_-_');
    expect(base64Url(new Uint8Array(16))).toHaveLength(22);
    expect(base64Url(new Uint8Array(32))).toHaveLength(43);
  });
});
