import { cleanSubdlKey } from '@bannertv/core';
import { describe, expect, it, vi } from 'vitest';
import { createSubdlChecks } from './subdl-checks';
import type { SubdlNotice } from './subdl-status';

// Obviously fake keys.
const TYPED_KEY = 'FAKE-SUBDL-KEY-0000';
const PHONE_KEY = 'FAKE-SUBDL-KEY-1111';
const LATER_PHONE_KEY = 'FAKE-SUBDL-KEY-2222';

type Answer = 'works' | 'refused' | 'unreachable';

/** The screen's checks over a saved key in memory and a SubDL that answers when told to. */
function setUp() {
  let saved: { key: string; state: string } | undefined;
  let clock = 0;
  const asked: string[] = [];
  const replies: Array<(answer: Answer) => void> = [];
  let running = 0;
  let most = 0;
  const notices: SubdlNotice[] = [];
  const checks = createSubdlChecks({
    checkKey: (key) => {
      asked.push(key);
      running++;
      most = Math.max(most, running);
      return new Promise<Answer>((resolve) => {
        replies.push((answer) => {
          running--;
          resolve(answer);
        });
      });
    },
    save: (text) => {
      const key = cleanSubdlKey(text);
      if (key === null) return 'bad';
      saved = { key, state: 'unchecked' };
      return 'saved';
    },
    saved: () => saved?.key,
    setState: (key, state) => {
      if (saved && saved.key === key) saved = { key, state };
    },
    remove: () => void (saved = undefined),
    now: () => clock,
  });
  checks.onNotice((notice) => notices.push(notice));
  return {
    checks,
    asked,
    notices,
    saved: () => saved,
    /** SubDL answers the oldest question still open. */
    async answer(answer: Answer) {
      replies.shift()!(answer);
      for (let i = 0; i < 5; i++) await Promise.resolve();
    },
    most: () => most,
    tick: (ms: number) => void (clock += ms),
  };
}

describe('createSubdlChecks', () => {
  it('saves a key typed and checks it, as Save always has', async () => {
    const t = setUp();
    expect(t.checks.save('not a key')).toBe('bad');
    expect(t.notices).toEqual(['badFormat']);
    expect(t.saved()).toBeUndefined();
    expect(t.asked).toEqual([]);

    expect(t.checks.save(` ${TYPED_KEY} `)).toBe('saved');
    expect(t.saved()).toEqual({ key: TYPED_KEY, state: 'unchecked' });
    expect(t.notices).toEqual(['badFormat', 'checking']);
    // One check at a time: Save does nothing meanwhile.
    expect(t.checks.save(PHONE_KEY)).toBe('busy');
    await t.answer('works');
    expect(t.saved()).toEqual({ key: TYPED_KEY, state: 'works' });
    expect(t.notices).toEqual(['badFormat', 'checking', 'works']);
    expect(t.asked).toEqual([TYPED_KEY]);
  });

  it('keeps an unreachable answer from changing what is known of the key', async () => {
    const t = setUp();
    t.checks.save(TYPED_KEY);
    await t.answer('unreachable');
    expect(t.saved()).toEqual({ key: TYPED_KEY, state: 'unchecked' });
    expect(t.notices).toEqual(['checking', 'unreachable']);
  });

  it('saves and checks a key from the phone, and says where it came from', async () => {
    const t = setUp();
    t.checks.receive(PHONE_KEY);
    expect(t.saved()).toEqual({ key: PHONE_KEY, state: 'unchecked' });
    expect(t.notices).toEqual(['phoneChecking']);
    await t.answer('refused');
    expect(t.saved()).toEqual({ key: PHONE_KEY, state: 'refused' });
    expect(t.notices).toEqual(['phoneChecking', 'refused']);
  });

  it('applies keys from the phone that come during a check once it ends, in turn', async () => {
    const t = setUp();
    t.checks.save(TYPED_KEY);
    t.checks.receive(PHONE_KEY);
    t.checks.receive(LATER_PHONE_KEY);
    expect(t.saved()?.key).toBe(TYPED_KEY);
    await t.answer('works');
    expect(t.saved()).toEqual({ key: PHONE_KEY, state: 'unchecked' });
    await t.answer('works');
    expect(t.saved()).toEqual({ key: LATER_PHONE_KEY, state: 'unchecked' });
    await t.answer('works');
    expect(t.saved()).toEqual({ key: LATER_PHONE_KEY, state: 'works' });
    expect(t.asked).toEqual([TYPED_KEY, PHONE_KEY, LATER_PHONE_KEY]);
    expect(t.most()).toBe(1);
    expect(t.notices).toEqual([
      'checking',
      'works',
      'phoneChecking',
      'works',
      'phoneChecking',
      'works',
    ]);
  });

  it('keeps a key removed during its check removed, and the phone key waiting goes too', async () => {
    const t = setUp();
    t.checks.receive(PHONE_KEY);
    t.checks.receive(LATER_PHONE_KEY);
    t.checks.remove();
    expect(t.saved()).toBeUndefined();
    await t.answer('works');
    expect(t.saved()).toBeUndefined();
    expect(t.asked).toEqual([PHONE_KEY]);
    expect(t.notices).toEqual(['phoneChecking', 'removed']);
  });

  it('checks again at most every ten seconds', async () => {
    const t = setUp();
    t.checks.checkAgain();
    expect(t.asked).toEqual([]);
    t.checks.save(TYPED_KEY);
    await t.answer('unreachable');
    t.tick(5000);
    t.checks.checkAgain();
    expect(t.asked).toEqual([TYPED_KEY]);
    t.tick(5000);
    t.checks.checkAgain();
    expect(t.asked).toEqual([TYPED_KEY, TYPED_KEY]);
    await t.answer('works');
    expect(t.saved()).toEqual({ key: TYPED_KEY, state: 'works' });
  });

  it('says when something from the phone did not open, or could not be saved', () => {
    const notify = vi.fn();
    const checks = createSubdlChecks({
      checkKey: () => Promise.resolve('works'),
      save: () => 'bad',
      saved: () => undefined,
      setState: () => undefined,
      remove: () => undefined,
    });
    const off = checks.onNotice(notify);
    checks.failed();
    checks.receive(PHONE_KEY);
    expect(notify.mock.calls).toEqual([['phoneFailed'], ['phoneFailed']]);
    // Once the screen has closed, nothing is said.
    off();
    checks.failed();
    expect(notify).toHaveBeenCalledTimes(2);
  });

  it("tells no one once the screen has closed, and still keeps SubDL's answer", async () => {
    const t = setUp();
    const notify = vi.fn();
    const off = t.checks.onNotice(notify);
    t.checks.save(TYPED_KEY);
    off();
    await t.answer('works');
    expect(notify.mock.calls).toEqual([['checking']]);
    expect(t.saved()).toEqual({ key: TYPED_KEY, state: 'works' });
  });
});
