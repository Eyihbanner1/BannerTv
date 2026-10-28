import type { KeyValueStore } from '../storage';

/**
 * The key-value store as one profile sees it: every key gets the profile's
 * prefix. Reads and writes wait until `prefix` settles, which is when someone
 * has said who is watching, so nothing of the wrong person is read or
 * written. A prefix that fails to arrive fails each call, which the stores
 * treat as "nothing saved" without saving over anything.
 */
export function profileKeyValueStore(base: KeyValueStore, prefix: Promise<string>): KeyValueStore {
  return {
    get: (key) => prefix.then((p) => base.get(p + key)),
    set: (key, value) => prefix.then((p) => base.set(p + key, value)),
    delete: (key) => prefix.then((p) => (base.delete ? base.delete(p + key) : undefined)),
  };
}
