import { describe, expect, it } from 'vitest';
import { memoryKeyValueStore } from '../storage';
import {
  checkPin,
  cleanName,
  createPinGuard,
  isPinFormat,
  MAIN_PROFILE_ID,
  makePin,
  MAX_PROFILES,
  newProfileId,
  PIN_LOCK_MS,
  PIN_TRIES,
  profileKeyPrefix,
  readProfiles,
} from './profiles';
import { profileKeyValueStore } from './scoped';
import { sha256 } from './sha256';

const counter = () => {
  let n = 0;
  return () => (n++ % 97) / 97;
};

describe('sha256', () => {
  it('matches the published test vectors', () => {
    expect(sha256('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
    expect(sha256('a'.repeat(1000))).toBe(
      '41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3',
    );
  });

  it('hashes the UTF-8 bytes of characters beyond ASCII', () => {
    expect(sha256('é')).toBe('4a99557e4033c3539de2eb65472017cad5f9557f7a0625a09f1c3f6e2ba69c4c');
    expect(sha256('é'.repeat(40))).toBe(
      '84fe2e03d50dd3a18b630669d7d5e361117ac6af9cbb487c284c8e6c91a9758a',
    );
    expect(sha256('😀')).toBe('f0443a342c5ef54783a111b51ba56c938e474c32324d90c3a60c9c8e3a37e2d9');
  });
});

describe('PINs', () => {
  it('keeps a salted hash, never the digits', () => {
    const pin = makePin('1234', counter());
    expect(JSON.stringify(pin)).not.toContain('1234');
    expect(pin.hash).toHaveLength(64);
    expect(checkPin('1234', pin)).toBe(true);
    expect(checkPin('4321', pin)).toBe(false);
    const other = makePin('1234', () => 0.5);
    expect(other.hash).not.toBe(pin.hash);
  });

  it('accepts four digits only', () => {
    expect(isPinFormat('0000')).toBe(true);
    expect(isPinFormat('123')).toBe(false);
    expect(isPinFormat('12a4')).toBe(false);
    expect(isPinFormat('12345')).toBe(false);
  });

  it('waits after too many wrong PINs, and a right one starts the count again', () => {
    let time = 1000;
    const guard = createPinGuard({ now: () => time });
    const profile = { id: 'kid', name: 'Kid', colour: 1, pin: makePin('2468', counter()) };
    for (let i = 0; i < PIN_TRIES - 1; i++) expect(guard.attempt(profile, '0000')).toBe('wrong');
    expect(guard.attempt(profile, '2468')).toBe('ok');
    for (let i = 0; i < PIN_TRIES - 1; i++) expect(guard.attempt(profile, '0000')).toBe('wrong');
    // The try that reaches the limit says so at once.
    expect(guard.attempt(profile, '0000')).toBe('locked');
    expect(guard.waitMs('kid')).toBe(PIN_LOCK_MS);
    expect(guard.attempt(profile, '2468')).toBe('locked');
    time += PIN_LOCK_MS;
    expect(guard.attempt(profile, '2468')).toBe('ok');
    // A profile without a PIN always opens.
    expect(guard.attempt({ id: 'x', name: 'X', colour: 0 }, '')).toBe('ok');
  });

  it('keeps counting across launches, and ignores damaged counts', () => {
    let time = 1000;
    let saved: unknown;
    const launch = () =>
      createPinGuard({ now: () => time, saved, save: (tries) => (saved = tries) });
    const profile = { id: 'kid', name: 'Kid', colour: 1, pin: makePin('2468', counter()) };
    let guard = launch();
    for (let i = 0; i < PIN_TRIES - 1; i++) guard.attempt(profile, '0000');
    guard = launch();
    expect(guard.attempt(profile, '0000')).toBe('locked');
    guard = launch();
    expect(guard.waitMs('kid')).toBe(PIN_LOCK_MS);
    // A clock moved back a day waits the usual time, not a day.
    time -= 86_400_000;
    guard = launch();
    expect(guard.waitMs('kid')).toBe(PIN_LOCK_MS);
    time += PIN_LOCK_MS;
    expect(guard.attempt(profile, '2468')).toBe('ok');

    // A deleted profile's tries go with it.
    guard.attempt(profile, '0000');
    expect(saved).toEqual({ kid: { count: 1, lockedUntil: expect.any(Number) } });
    guard.forget('kid');
    expect(saved).toEqual({});

    const damaged = createPinGuard({
      saved: { kid: { count: 'x', lockedUntil: 1 }, other: null },
    });
    expect(damaged.waitMs('kid')).toBe(0);
  });
});

describe('readProfiles', () => {
  it('starts with Main alone', () => {
    expect(readProfiles(undefined, 'Main')).toEqual({
      profiles: [{ id: MAIN_PROFILE_ID, name: 'Main', colour: 0 }],
      lastId: MAIN_PROFILE_ID,
      askAtLaunch: true,
    });
  });

  it('keeps good profiles, drops damaged ones, and puts Main first', () => {
    const pin = makePin('1111', counter());
    const state = readProfiles(
      {
        profiles: [
          { id: 'kid1', name: '  Ada  ', colour: 3, kids: 'PG', pin },
          { id: 'main', name: 'Mum', colour: 9, kids: 'U' },
          { id: 'BAD ID', name: 'x' },
          { id: 'noname', name: '   ' },
          { id: 'kid1', name: 'Twice' },
          { id: 'odd', name: 'Odd', kids: 'R18', pin: { salt: 'a', hash: 'short' } },
        ],
        lastId: 'kid1',
        askAtLaunch: false,
      },
      'Main',
    );
    expect(state.profiles).toEqual([
      { id: 'main', name: 'Mum', colour: 0 },
      { id: 'kid1', name: 'Ada', colour: 3, kids: 'PG', pin },
      { id: 'odd', name: 'Odd', colour: 0 },
    ]);
    expect(state.lastId).toBe('kid1');
    expect(state.askAtLaunch).toBe(false);
  });

  it('adds Main back when it went missing, within the limit', () => {
    const many = Array.from({ length: MAX_PROFILES + 2 }, (_, i) => ({
      id: `p${i}`,
      name: `P${i}`,
    }));
    const state = readProfiles({ profiles: many, lastId: 'gone' }, 'Main');
    expect(state.profiles).toHaveLength(MAX_PROFILES);
    expect(state.profiles[0]!.id).toBe('main');
    expect(state.lastId).toBe('main');
  });
});

describe('profile keys', () => {
  it('leaves Main on the bare keys and gives others a prefix', () => {
    expect(profileKeyPrefix('main')).toBe('');
    expect(profileKeyPrefix('k3x9')).toBe('p/k3x9/');
  });

  it('makes new ids that are free', () => {
    const fixed = () => 0;
    const first = newProfileId([], fixed);
    expect(first).toMatch(/^[a-z0-9]{6}$/);
    let n = 0;
    const second = newProfileId([first], () => (n++ < 6 ? 0 : 0.5));
    expect(second).not.toBe(first);
  });

  it('cleans names', () => {
    expect(cleanName('  Big   Kid  ')).toBe('Big Kid');
    expect(cleanName('x'.repeat(40))).toHaveLength(20);
  });

  it('holds reads and writes until the profile is known, then prefixes them', async () => {
    const base = memoryKeyValueStore();
    await base.set('progress', 'main progress');
    let choose: (prefix: string) => void = () => undefined;
    const scoped = profileKeyValueStore(
      base,
      new Promise<string>((resolve) => {
        choose = resolve;
      }),
    );
    let read: unknown = 'not yet';
    const reading = scoped.get('progress').then((value) => {
      read = value;
    });
    const writing = scoped.set('library', ['a']);
    await Promise.resolve();
    expect(read).toBe('not yet');
    expect(await base.get('p/kid/library')).toBeUndefined();
    choose(profileKeyPrefix('kid'));
    await reading;
    await writing;
    expect(read).toBeUndefined();
    expect(await base.get('p/kid/library')).toEqual(['a']);
    await scoped.delete!('library');
    expect(await base.get('p/kid/library')).toBeUndefined();
    expect(await base.get('progress')).toBe('main progress');
  });
});
