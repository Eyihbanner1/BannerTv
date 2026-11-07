import { describe, expect, it } from 'vitest';
import {
  CREDITS_COUNT_S,
  type CreditsCard,
  creditsCardAt,
  creditsCount,
  endAction,
  type EndState,
  inLastStretch,
  rearms,
  secondsToEnd,
  UP_NEXT_AFTER_END_S,
  UP_NEXT_BEFORE_END_S,
  UP_NEXT_REARM_S,
  upNextStage,
} from './up-next';

describe('secondsToEnd', () => {
  it('counts the seconds left, rounded up', () => {
    expect(secondsToEnd(25.2, 40)).toBe(15);
    expect(secondsToEnd(39.01, 40)).toBe(1);
    expect(secondsToEnd(30, 40)).toBe(10);
  });

  it('counts watching seconds at other speeds', () => {
    expect(secondsToEnd(25, 40, 1.5)).toBe(10);
    expect(secondsToEnd(31, 40, 2)).toBe(5);
    expect(secondsToEnd(35, 40, 0.5)).toBe(10);
  });

  it('never shows more than the lead, so it never counts up', () => {
    expect(secondsToEnd(0, 2700)).toBe(UP_NEXT_BEFORE_END_S);
    expect(secondsToEnd(10, 40)).toBe(30);
    // 20 media seconds at half speed are 40 watching seconds.
    expect(secondsToEnd(20, 40, 0.5)).toBe(30);
  });

  it('is 0 at the end and after it', () => {
    expect(secondsToEnd(40, 40)).toBe(0);
    expect(secondsToEnd(41, 40)).toBe(0);
  });

  it('is null while the length is unknown, as on live', () => {
    expect(secondsToEnd(12, 0)).toBeNull();
    expect(secondsToEnd(12, NaN)).toBeNull();
    expect(secondsToEnd(12, Infinity)).toBeNull();
    expect(secondsToEnd(12, -40)).toBeNull();
    expect(secondsToEnd(NaN, 40)).toBeNull();
    expect(secondsToEnd(Infinity, 40)).toBeNull();
  });

  it('is null when the speed is not positive', () => {
    expect(secondsToEnd(30, 40, 0)).toBeNull();
    expect(secondsToEnd(30, 40, -1)).toBeNull();
    expect(secondsToEnd(30, 40, NaN)).toBeNull();
  });
});

describe('inLastStretch', () => {
  it('starts at 30 watching seconds before the end', () => {
    expect(inLastStretch(9.9, 40)).toBe(false);
    expect(inLastStretch(10, 40)).toBe(true);
    expect(inLastStretch(39, 40)).toBe(true);
  });

  it('includes the end and past it', () => {
    expect(inLastStretch(40, 40)).toBe(true);
    expect(inLastStretch(45, 40)).toBe(true);
  });

  it('follows the speed', () => {
    // 40 media seconds at 1.5x are under 27 watching seconds.
    expect(inLastStretch(60, 100, 1.5)).toBe(true);
    // 20 media seconds at half speed are 40 watching seconds.
    expect(inLastStretch(80, 100, 0.5)).toBe(false);
  });

  it('is false while the length or the speed is unknown', () => {
    expect(inLastStretch(5, 0)).toBe(false);
    expect(inLastStretch(5, Infinity)).toBe(false);
    expect(inLastStretch(35, 40, 0)).toBe(false);
    expect(inLastStretch(35, 40, -1)).toBe(false);
    expect(inLastStretch(NaN, 40)).toBe(false);
    expect(inLastStretch(5, -40)).toBe(false);
  });

  it('has no 95% rule: a long episode waits for its last 30 seconds', () => {
    // 95% of a 45-minute episode is 2565 s, over two minutes before the end.
    expect(inLastStretch(2565, 2700)).toBe(false);
    expect(inLastStretch(2669, 2700)).toBe(false);
    expect(inLastStretch(2670, 2700)).toBe(true);
  });
});

describe('rearms', () => {
  it('needs a rewind past the lead and its margin', () => {
    expect(UP_NEXT_BEFORE_END_S + UP_NEXT_REARM_S).toBe(32);
    expect(rearms(69, 100)).toBe(false); // 31 s left
    expect(rearms(68, 100)).toBe(false); // 32 s left
    expect(rearms(67, 100)).toBe(true); // 33 s left
    expect(rearms(0, 100)).toBe(true);
  });

  it('never rearms inside the last stretch', () => {
    expect(rearms(90, 100)).toBe(false);
    expect(rearms(100, 100)).toBe(false);
  });

  it('follows the speed', () => {
    // 33 media seconds at 1.5x are 22 watching seconds.
    expect(rearms(67, 100, 1.5)).toBe(false);
    // 17 media seconds at half speed are 34 watching seconds.
    expect(rearms(83, 100, 0.5)).toBe(true);
  });

  it('is false while the length is unknown, as during a stream switch', () => {
    expect(rearms(0, 0)).toBe(false);
    expect(rearms(0, NaN)).toBe(false);
    expect(rearms(0, Infinity)).toBe(false);
  });

  it('is false while the speed or the position is unusable', () => {
    expect(rearms(0, 100, 0)).toBe(false);
    expect(rearms(0, 100, -1)).toBe(false);
    expect(rearms(NaN, 100)).toBe(false);
  });
});

describe('endAction', () => {
  // An episode with a next one, which the viewer watched count down to 0.
  const base: EndState = {
    hasNext: true,
    live: false,
    dismissed: false,
    held: false,
    countedOnScreen: true,
    sleepsHere: false,
    stillWatching: false,
  };
  const at = (change: Partial<EndState>) => endAction({ ...base, ...change });

  it('plays the next episode once the viewer saw the count reach 0', () => {
    expect(at({})).toBe('play');
  });

  it('gives a countdown when the count was not seen, as with an unknown length', () => {
    expect(at({ countedOnScreen: false })).toBe('hold');
    expect(UP_NEXT_AFTER_END_S).toBe(10);
  });

  it('leaves at the end of a film, a broadcast or a dismissed Up Next', () => {
    expect(at({ hasNext: false })).toBe('leave');
    expect(at({ live: true })).toBe('leave');
    expect(at({ dismissed: true })).toBe('leave');
    expect(at({ hasNext: false, countedOnScreen: false })).toBe('leave');
  });

  it('holds while a sheet, menu or skip holds the end', () => {
    expect(at({ held: true })).toBe('hold');
    expect(at({ held: true, countedOnScreen: false })).toBe('hold');
  });

  it('never leaves from under a sheet: a film ending under one waits', () => {
    expect(at({ held: true, hasNext: false })).toBe('hold');
    expect(at({ held: true, dismissed: true })).toBe('hold');
    expect(at({ held: true, live: true })).toBe('hold');
  });

  it('sleeps where the sleep timer stops, film or episode, once nothing holds', () => {
    expect(at({ sleepsHere: true })).toBe('sleep');
    expect(at({ sleepsHere: true, hasNext: false })).toBe('sleep');
    expect(at({ sleepsHere: true, dismissed: true })).toBe('sleep');
    expect(at({ sleepsHere: true, stillWatching: true })).toBe('sleep');
    expect(at({ sleepsHere: true, held: true })).toBe('hold');
  });

  it('asks "Still watching?" in place of the next episode', () => {
    expect(at({ stillWatching: true })).toBe('ask');
    expect(at({ stillWatching: true, countedOnScreen: false })).toBe('ask');
    expect(at({ stillWatching: true, held: true })).toBe('hold');
  });

  it('never asks "Still watching?" where nothing would play next', () => {
    expect(at({ stillWatching: true, hasNext: false })).toBe('leave');
    expect(at({ stillWatching: true, live: true })).toBe('leave');
    expect(at({ stillWatching: true, dismissed: true })).toBe('leave');
  });

  it('sleeps at the end of a broadcast when the timer stops there', () => {
    expect(at({ sleepsHere: true, live: true })).toBe('sleep');
  });

  it('follows the one order for every combination', () => {
    const keys: (keyof EndState)[] = [
      'hasNext',
      'live',
      'dismissed',
      'held',
      'countedOnScreen',
      'sleepsHere',
      'stillWatching',
    ];
    for (let bits = 0; bits < 1 << keys.length; bits++) {
      const state = { ...base };
      keys.forEach((key, i) => {
        state[key] = (bits & (1 << i)) !== 0;
      });
      const action = endAction(state);
      const nothingNext = !state.hasNext || state.live || state.dismissed;
      if (state.held) expect(action).toBe('hold');
      else if (state.sleepsHere) expect(action).toBe('sleep');
      else if (nothingNext) expect(action).toBe('leave');
      else if (state.stillWatching) expect(action).toBe('ask');
      else expect(action).toBe(state.countedOnScreen ? 'play' : 'hold');
    }
  });

  it('plays after the countdown given once a held end is free', () => {
    // At the end, under a sheet.
    expect(at({ held: true, countedOnScreen: false })).toBe('hold');
    // The sheet closes: the countdown starts.
    expect(at({ countedOnScreen: false })).toBe('hold');
    // The countdown ran out on screen.
    expect(at({ countedOnScreen: true })).toBe('play');
  });
});

describe('upNextStage', () => {
  it('is due from the credits, then counts the last stretch', () => {
    expect(upNextStage(2400, 2600, 1, 2500)).toBe('none');
    expect(upNextStage(2500, 2600, 1, 2500)).toBe('credits');
    expect(upNextStage(2600 - UP_NEXT_BEFORE_END_S, 2600, 1, 2500)).toBe('last');
    expect(upNextStage(2700, 2600, 1, 2500)).toBe('last');
  });

  it('has only the last stretch without a credits mark, and nothing while the length is unknown', () => {
    expect(upNextStage(2500, 2600)).toBe('none');
    expect(upNextStage(2580, 2600)).toBe('last');
    expect(upNextStage(2500, 0, 1, 2400)).toBe('none');
    expect(upNextStage(2500, 2600, 0, 2400)).toBe('none');
  });
});

describe('creditsCardAt', () => {
  const counts = () => true;

  it('comes up as playback passes the credits mark, and stays', () => {
    expect(creditsCardAt(null, 2499, 2500, counts)).toBeNull();
    const card = creditsCardAt(null, 2500.4, 2500, counts);
    expect(card).toEqual({ at: 2500.4, counts: true, gone: false });
    expect(creditsCardAt(card, 2560, 2500, counts)).toBe(card);
  });

  it('asks whether it counts only as it comes up', () => {
    let asked = 0;
    const ask = () => {
      asked += 1;
      return false;
    };
    const card = creditsCardAt(null, 2500, 2500, ask);
    creditsCardAt(card, 2510, 2500, ask);
    expect(asked).toBe(1);
    expect(card?.counts).toBe(false);
  });

  it('is forgotten after a rewind well before the credits, not one just before them', () => {
    const gone: CreditsCard = { at: 2500, counts: false, gone: true };
    expect(creditsCardAt(gone, 2500 - UP_NEXT_REARM_S / 2, 2500, counts)).toBe(gone);
    expect(creditsCardAt(gone, 2500 - UP_NEXT_REARM_S - 0.1, 2500, counts)).toBeNull();
  });

  it('has none without a mark', () => {
    expect(creditsCardAt({ at: 1, counts: true, gone: false }, 2550, undefined, counts)).toBeNull();
  });
});

describe('creditsCount', () => {
  const card: CreditsCard = { at: 2500, counts: true, gone: false };

  it('counts CREDITS_COUNT_S watching seconds from where it came up, rounded up', () => {
    expect(creditsCount(card, 2500, 2600)).toBe(CREDITS_COUNT_S);
    expect(creditsCount(card, 2503.5, 2600)).toBe(7);
    expect(creditsCount(card, 2510, 2600)).toBe(0);
    expect(creditsCount(card, 2530, 2600)).toBe(0);
    // At double speed, twice the media seconds.
    expect(creditsCount(card, 2510, 2600, 2)).toBe(5);
  });

  it('never counts past the real end', () => {
    expect(creditsCount({ ...card, at: 2595 }, 2595, 2600)).toBe(5);
  });
});
