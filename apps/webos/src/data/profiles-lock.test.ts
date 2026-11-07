import type { Profile } from '@bannertv/core';
import { describe, expect, it } from 'vitest';
import { offerLockAfterSave, unlockedGrownUps } from './profiles-lock';
import { pinRecovery } from './profiles-recovery';

const pin = { salt: '00', hash: 'ab' };
const main: Profile = { id: 'main', name: 'Eyitayo', colour: 0 };
const grownUp: Profile = { id: 'sam', name: 'Sam', colour: 1 };
const kid: Profile = { id: 'ada', name: 'Ada', colour: 2, kids: '12' };

describe('offering to lock the grown-up profiles (A5)', () => {
  it('lists the grown-ups with no PIN, never a kids profile', () => {
    expect(unlockedGrownUps([main, { ...grownUp, pin }, kid]).map((p) => p.id)).toEqual(['main']);
  });

  it('offers once a profile becomes a kids profile while a grown-up is unlocked', () => {
    expect(offerLockAfterSave(undefined, kid, [main, kid])).toBe(true);
    expect(offerLockAfterSave(grownUp, { ...grownUp, kids: 'PG' }, [main, grownUp])).toBe(true);
  });

  it('stays quiet when every grown-up has a PIN, or the profile was a kids one already', () => {
    expect(offerLockAfterSave(undefined, kid, [{ ...main, pin }, kid])).toBe(false);
    expect(offerLockAfterSave(kid, { ...kid, name: 'Ada B' }, [main, kid])).toBe(false);
    expect(offerLockAfterSave(undefined, grownUp, [main, grownUp])).toBe(false);
  });
});

describe('a forgotten PIN (A4)', () => {
  it("asks for Main's PIN for another profile when Main has one", () => {
    expect(pinRecovery(grownUp, [{ ...main, pin }, grownUp], false)).toBe('main-pin');
  });

  it('warns instead when Main has no PIN', () => {
    expect(pinRecovery(grownUp, [main, grownUp], true)).toBe('warn');
  });

  it("asks for the account code for Main's own PIN, or offers a reset with no account", () => {
    expect(pinRecovery({ ...main, pin }, [{ ...main, pin }], true)).toBe('account-code');
    expect(pinRecovery({ ...main, pin }, [{ ...main, pin }], false)).toBe('reset');
  });
});
