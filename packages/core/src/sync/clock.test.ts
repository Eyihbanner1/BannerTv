import { describe, expect, it } from 'vitest';
import { createAccountClock } from './clock';

function screen(start: number) {
  let time = start;
  return { now: () => time, set: (ms: number) => (time = ms), add: (ms: number) => (time += ms) };
}

describe('createAccountClock', () => {
  it("is this screen's own clock until the server answers", () => {
    const local = screen(1000);
    const clock = createAccountClock({ now: local.now });
    expect(clock.now()).toBe(1000);
    expect(clock.skew()).toBe(0);
  });

  it('takes the skew from an answer, half the round trip added, and saves it', () => {
    const local = screen(10000);
    const saved: number[] = [];
    const clock = createAccountClock({ now: local.now, save: (skew) => saved.push(skew) });
    const sentAt = clock.local();
    local.add(400);
    // The server read its clock about halfway, 200 ms before the answer arrived.
    clock.observe(50000, sentAt);
    expect(clock.skew()).toBe(50000 + 200 - 10400);
    expect(clock.now()).toBe(50200);
    expect(saved).toEqual([39800]);
    // A jump of the screen's clock moves its own time, not the account's view of the gap.
    local.add(1000);
    expect(clock.now()).toBe(51200);
  });

  it('reads the saved skew once, and ignores nonsense', () => {
    expect(createAccountClock({ now: () => 100, load: () => '2500' }).now()).toBe(2600);
    expect(createAccountClock({ now: () => 100, load: () => -50 }).now()).toBe(50);
    expect(createAccountClock({ now: () => 100, load: () => 'soon' }).now()).toBe(100);
    expect(
      createAccountClock({
        now: () => 100,
        load: () => {
          throw new Error('SecurityError');
        },
      }).now(),
    ).toBe(100);
  });

  it('stamps at least a millisecond after the value it replaces', () => {
    const local = screen(5000);
    const clock = createAccountClock({ now: local.now });
    expect(clock.stamp()).toBe(5000);
    expect(clock.stamp(4000)).toBe(5000);
    expect(clock.stamp(5000)).toBe(5001);
    expect(clock.stamp(9000)).toBe(9001);
  });

  it('ignores a round trip the clock jumped through, and goes back to its own clock on reset', () => {
    const local = screen(10000);
    const saved: number[] = [];
    const clock = createAccountClock({ now: local.now, save: (skew) => saved.push(skew) });
    const sentAt = clock.local();
    local.set(5000);
    clock.observe(8000, sentAt);
    expect(clock.skew()).toBe(3000);
    clock.reset();
    expect(clock.now()).toBe(5000);
    expect(saved).toEqual([3000, 0]);
  });
});
