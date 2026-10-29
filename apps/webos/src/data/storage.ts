import { profileKeyValueStore } from '@bannertv/core';
import { createStorage } from '../platform/idb';
import { profilePrefix } from './profiles';

/** The app's one IndexedDB database: small values in `kv`, addon responses in `cache`. */
export const storage = createStorage();

/**
 * The key-value store as the profile in use sees it (ADR 0004): its reads and
 * writes wait until someone is chosen. TV-wide data (the addon collection,
 * the addons' record, the connection's limit) stays on `storage.kv`.
 */
export const profileKv = profileKeyValueStore(storage.kv, profilePrefix);
