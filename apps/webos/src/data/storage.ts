import { createStorage } from '../platform/idb';

/** The app's one IndexedDB database: small values in `kv`, addon responses in `cache`. */
export const storage = createStorage();
