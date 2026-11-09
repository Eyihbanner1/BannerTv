/**
 * Workers KV in memory for the tests: values with their metadata, read the ways the Worker
 * reads them. It also takes the entries of a `wrangler kv bulk put` file, as the publish
 * workflow uploads them, so a test can serve exactly what the publish script wrote.
 */
import type { KVNamespace } from '../worker';

/** One entry of a `wrangler kv bulk put` file. */
export interface BulkEntry {
  key: string;
  value: string;
  metadata?: unknown;
  base64?: boolean;
}

interface Stored {
  bytes: Uint8Array<ArrayBuffer>;
  metadata: unknown;
}

export interface TestKV extends KVNamespace {
  put(key: string, value: string | Uint8Array<ArrayBuffer>, options?: { metadata?: unknown }): void;
  bulkPut(entries: BulkEntry[]): void;
  delete(key: string): void;
  /** Every key read, in order. */
  readonly reads: string[];
  /** Every key written, in order, by put, bulkPut or delete. */
  readonly writes: string[];
  /** While true, every read fails, as KV does when it cannot be reached. */
  down: boolean;
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export function testKV(): TestKV {
  const store = new Map<string, Stored>();
  const reads: string[] = [];
  const writes: string[] = [];

  function read(key: string): Stored | undefined {
    reads.push(key);
    if (kv.down) throw new Error('KV is unavailable');
    return store.get(key);
  }

  function shaped(stored: Stored | undefined, type: 'text' | 'stream' | 'arrayBuffer') {
    if (!stored) return null;
    if (type === 'text') return new TextDecoder().decode(stored.bytes);
    // A copy, as KV hands each read its own buffer.
    if (type === 'arrayBuffer') return stored.bytes.slice().buffer;
    return new Response(stored.bytes).body;
  }

  const kv: TestKV = {
    reads,
    writes,
    down: false,
    async get(key: string, type: 'text' | 'arrayBuffer') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- one stub for both overloads
      return shaped(read(key), type) as any;
    },
    async getWithMetadata(key: string, type: 'text' | 'stream') {
      const stored = read(key);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- one stub for both overloads
      return { value: shaped(stored, type) as any, metadata: (stored?.metadata ?? null) as any };
    },
    put(key, value, options = {}) {
      writes.push(key);
      const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
      store.set(key, { bytes, metadata: options.metadata ?? null });
    },
    bulkPut(entries) {
      for (const entry of entries) {
        const value = entry.base64 ? fromBase64(entry.value) : entry.value;
        kv.put(entry.key, value, { metadata: entry.metadata });
      }
    },
    delete(key) {
      writes.push(key);
      store.delete(key);
    },
  };
  return kv;
}
