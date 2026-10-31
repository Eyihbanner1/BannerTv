import type { LiveItem } from './items';

/** One value a store holds, as the account's document keeps it. */
export interface PartItem {
  /** The document value. */
  v: unknown;
  /**
   * The value's own time, where the store keeps one: My List's addedAt,
   * progress's updatedAt. Left out for a register (a setting, an addon, a
   * profile's name), which the engine stamps when it changes.
   */
  t?: number;
  /**
   * Brought in by Trakt, or counted as Trakt's: never an edit, never sent,
   * and the engine changes it only for a newer account item.
   */
  trakt?: boolean;
}

/** What the account changes in a store: only these keys, all of them the part's own. */
export interface PartChange {
  /** Values to write, each with its time. */
  set: Map<string, LiveItem>;
  /** Keys to take away. */
  remove: string[];
  /**
   * Set when joining with Use makes the screen match the account: what goes
   * is set aside rather than removed, so nothing should be removed anywhere
   * else on its account (Trakt's list keeps its titles).
   */
  reset?: boolean;
}

/**
 * How a store takes part in one of the account's documents (ADR 0006,
 * decision 3). The engine watches the store through it: a snapshot once the
 * store has loaded, another at every change, and what differs is an edit.
 * Changes the engine makes come back through `adopt` and are not edits.
 *
 * The core has parts for its own stores (`./parts.ts`); the app writes
 * the ones for profiles, preferences and Sports settings, which live there.
 */
export interface SyncPart {
  /** The document it takes part in: `profiles`, `addons` or `p/<id>/settings|list|watch`. */
  readonly document: string;
  /**
   * The keys it owns in that document. One ending in `/` owns every key
   * under it (`track/`), any other names one key (`order`), and `''` owns
   * them all. Parts of one document never own the same key.
   */
  readonly prefixes: readonly string[];
  /** Resolves once the store has read what was saved, or found it missing or unreadable. */
  load(): Promise<void>;
  /** What the store holds now, by document key. Called often: keep it cheap. */
  snapshot(): Map<string, PartItem>;
  /**
   * The part of a value that is compared to tell an edit, so values that
   * only ride along (artwork, a manifest, a card's description) are not
   * edits. Defaults to the whole value.
   */
  compare?(key: string, value: unknown): unknown;
  /** Tells `listener` of every change to the store. */
  subscribe(listener: () => void): () => void;
  /**
   * Writes the account's values into the store, saves it and tells its
   * subscribers. Keys it is not told about stay as they are.
   */
  adopt(change: PartChange): Promise<void>;
  /**
   * Marks the items under `keys` as Trakt's, for data saved before this
   * build whose times are whole seconds (ADR 0006, decision 4). Only parts
   * whose items have their own times need it.
   */
  markTrakt?(keys: readonly string[]): Promise<void>;
  /**
   * Whether the store holds data of the person's own, which makes joining an
   * account ask whether to bring it: more than Main, a renamed Main or one
   * with a PIN, My List or Continue Watching items not from Trakt, or addons
   * other than the defaults.
   */
  ownData?(): boolean;
  /**
   * Keys of values a new screen starts with that this one no longer holds,
   * such as a default addon removed. Creating the account sends them as
   * removals, so a screen that joins later does not bring them back.
   */
  removedDefaults?(): string[];
}

/** Whether `key` is one of the part's own. */
export function partOwns(part: Pick<SyncPart, 'prefixes'>, key: string): boolean {
  for (const prefix of part.prefixes) {
    if (prefix === '') return true;
    if (prefix.charAt(prefix.length - 1) === '/' ? key.indexOf(prefix) === 0 : key === prefix) {
      return true;
    }
  }
  return false;
}
