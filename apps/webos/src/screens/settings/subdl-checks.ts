import type { SubdlNotice } from './subdl-status';

/** "Check again" is offered at most this often. */
export const CHECK_AGAIN_MS = 10_000;

export interface SubdlChecksOptions {
  /** Asks SubDL about a key; never rejects (subdl.checkKey). */
  checkKey: (key: string) => Promise<'works' | 'refused' | 'unreachable'>;
  /** Saves a key typed, pasted or sent (saveSubdlKey): 'bad' when it cannot be one. */
  save: (text: string) => 'saved' | 'bad';
  /** The key saved now, if any. */
  saved: () => string | undefined;
  /** What SubDL said of a key, kept if it is still the one saved (setSubdlKeyState). */
  setState: (key: string, state: 'works' | 'refused') => void;
  /** Removes the key saved (removeSubdlKey). */
  remove: () => void;
  now?: () => number;
}

export interface SubdlChecks {
  /**
   * Sets who is told what the status line should say: the screen, while it is
   * open. A check that ends after it has closed keeps SubDL's answer, unsaid.
   */
  onNotice(handler: (notice: SubdlNotice) => void): () => void;
  /** Save: 'busy' while a check runs, when nothing changes. */
  save(text: string): 'saved' | 'bad' | 'busy';
  /**
   * A key from the phone, opened: saved and checked as Save does, at once or
   * as soon as the check under way ends, so it is never lost on the way.
   */
  receive(key: string): void;
  checkAgain(): void;
  /** Remove key: any key from the phone still waiting goes too, as the viewer asked. */
  remove(): void;
  /** Something came from the phone that did not open. */
  failed(): void;
}

/**
 * The SubDL screen's saving and checking: one check at a time, so SubDL is
 * never asked twice at once. Keys from the phone that come during a check
 * wait their turn, in the order they came.
 */
export function createSubdlChecks(options: SubdlChecksOptions): SubdlChecks {
  const { checkKey, save, saved, setState, remove, now = Date.now } = options;
  let checking = false;
  let lastCheck: number | undefined;
  const waiting: string[] = [];
  let listener: ((notice: SubdlNotice) => void) | undefined;
  const notify = (notice: SubdlNotice) => listener?.(notice);

  async function check(key: string, fromPhone: boolean) {
    if (checking) return;
    checking = true;
    lastCheck = now();
    notify(fromPhone ? 'phoneChecking' : 'checking');
    const answer = await checkKey(key);
    checking = false;
    if (answer !== 'unreachable') setState(key, answer);
    // A key removed while it was checked stays removed, and says so.
    if (saved() === key) notify(answer);
    const next = waiting.shift();
    if (next !== undefined) apply(next);
  }

  function apply(key: string) {
    const saving = save(key);
    const current = saved();
    if (saving === 'saved' && current) {
      void check(current, true);
      return;
    }
    // Never so for a key that opened, which looked like one; but say so rather than nothing.
    if (saving === 'bad') notify('phoneFailed');
    const next = waiting.shift();
    if (next !== undefined) apply(next);
  }

  return {
    onNotice(next) {
      listener = next;
      return () => {
        if (listener === next) listener = undefined;
      };
    },
    save(text) {
      if (checking) return 'busy';
      if (save(text) === 'bad') {
        notify('badFormat');
        return 'bad';
      }
      const key = saved();
      if (key) void check(key, false);
      return 'saved';
    },
    receive(key) {
      if (checking) waiting.push(key);
      else apply(key);
    },
    checkAgain() {
      const key = saved();
      if (!key || (lastCheck !== undefined && now() - lastCheck < CHECK_AGAIN_MS)) return;
      void check(key, false);
    },
    remove() {
      waiting.length = 0;
      remove();
      notify('removed');
    },
    failed: () => notify('phoneFailed'),
  };
}
