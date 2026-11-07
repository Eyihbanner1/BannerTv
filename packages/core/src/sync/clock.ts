/**
 * The account's clock (ADR 0006, decision 5). TV clocks are wrong until the
 * network sets them, and jump, so a signed-in screen keeps the server's time
 * as a skew from its own and stamps everything with it: screens with wrong
 * clocks still agree which change came last.
 */
export interface AccountClock {
  /** Account time in whole milliseconds: this screen's clock plus the skew. */
  now(): number;
  /** This screen's own clock, to time a request with. */
  local(): number;
  /**
   * The time for a change to a value with no time of its own: now, but at
   * least a millisecond after `previous`, the time of the value it replaces,
   * so a change made just after a remote one still wins.
   */
  stamp(previous?: number): number;
  /**
   * Learns the skew from an answer: `serverNow` is the server's time in it,
   * `sentAt` the local() time the request went out. Half the round trip is
   * added, since the server read its clock about halfway.
   */
  observe(serverNow: number, sentAt: number): void;
  /** Server time minus this screen's, in milliseconds. */
  skew(): number;
  /** Back to this screen's own clock, for a screen that leaves the account. */
  reset(): void;
}

export interface AccountClockOptions {
  /** This screen's clock. Defaults to Date.now. */
  now?: () => number;
  /** The skew saved last time (localStorage `bannertv.syncClock`), read once. */
  load?: () => unknown;
  /** Saves the skew whenever it changes. */
  save?: (skew: number) => void;
}

/** The skew that is kept at most: a TV years out is still put right, nonsense is not. */
const MAX_SKEW_MS = 100 * 365 * 24 * 60 * 60 * 1000;

function readSkew(value: unknown): number {
  const skew = typeof value === 'string' ? Number(value) : value;
  return typeof skew === 'number' && Number.isFinite(skew) && Math.abs(skew) <= MAX_SKEW_MS
    ? Math.round(skew)
    : 0;
}

export function createAccountClock(options: AccountClockOptions = {}): AccountClock {
  const { now: local = Date.now, save } = options;
  let skew = 0;
  try {
    skew = readSkew(options.load?.());
  } catch {
    // Unreadable: this screen's own clock until the server answers.
  }

  function keep(next: number) {
    if (next === skew) return;
    skew = next;
    try {
      save?.(skew);
    } catch {
      // Kept in memory; the next answer saves it again.
    }
  }

  const now = () => Math.round(local()) + skew;

  return {
    now,
    local: () => local(),
    stamp: (previous) =>
      previous === undefined || !Number.isFinite(previous) ? now() : Math.max(now(), previous + 1),
    observe(serverNow, sentAt) {
      if (typeof serverNow !== 'number' || !Number.isFinite(serverNow)) return;
      const received = local();
      // A clock that jumped during the request gives no round trip worth halving.
      const trip = received >= sentAt && received - sentAt < 60000 ? received - sentAt : 0;
      const next = Math.round(serverNow + trip / 2 - received);
      if (Math.abs(next) <= MAX_SKEW_MS) keep(next);
    },
    skew: () => skew,
    reset: () => keep(0),
  };
}
