import { createPersisted, createStore, type KeyValueStore } from '@bannertv/core';

/**
 * The stream helper on the home network (docs/adr/0005-android-tv-app.md,
 * decision 13): BannerTV on an Android phone or box fetches add-on streams
 * that need request headers, which the LG's player can't send, and hands
 * them to the TV over Wi-Fi. This is the TV's side: pairing once with the
 * code the helper shows, then asking it for a link per stream.
 */

/** The port the helper listens on unless it was taken (apps/androidtv HelperServer.PORT). */
export const HELPER_PORT = 47020;

const STATUS_TIMEOUT_MS = 2500;
const REQUEST_TIMEOUT_MS = 5000;
/** Unpairing tells the helper, but never waits long for it. */
const FORGET_TIMEOUT_MS = 2000;
/** A reachability answer is trusted this long, so a stream list doesn't ask per stream. */
const REACHABLE_FOR_MS = 15000;

export interface HelperPairing {
  host: string;
  port: number;
  /** The long key the helper handed out for its pairing code. Never shown. */
  key: string;
}

export type PairResult = 'paired' | 'bad-address' | 'bad-code' | 'wrong-code' | 'unreachable';

/** The helper is off, out of reach, or forgot this TV. Carries no link. */
export class HelperUnavailable extends Error {
  constructor(readonly reason: 'unpaired' | 'unreachable' | 'refused') {
    super(`Stream helper ${reason}`);
    this.name = 'HelperUnavailable';
  }
}

/** Whether an IPv4 address is on a home network (10/8, 172.16/12, 192.168/16). */
function isHomeIpv4(host: string): boolean {
  const parts = host.split('.');
  if (parts.length !== 4) return false;
  const bytes = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : NaN));
  if (bytes.some((byte) => !(byte >= 0 && byte <= 255))) return false;
  const [a, b] = bytes as [number, number];
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

/**
 * The helper's address as typed on the TV: "192.168.1.42", or with a port,
 * "192.168.1.42:47021". Only home-network addresses: the TV never sends a
 * stream link anywhere else.
 */
export function parseHelperAddress(text: string): { host: string; port: number } | null {
  const match = /^\s*(\d{1,3}(?:\.\d{1,3}){3})(?::(\d{1,5}))?\s*$/.exec(text);
  if (!match || !isHomeIpv4(match[1]!)) return null;
  const port = match[2] === undefined ? HELPER_PORT : Number(match[2]);
  if (!(port >= 1 && port <= 65535)) return null;
  return { host: match[1]!, port };
}

/**
 * What a phone running the helper sends the TV through the pairing relay
 * (services/pair), so nobody types on the TV: the helper's address and the
 * code it shows now. The relay passes it on as it would an addon's address;
 * only the TV's Stream helper screen reads it. The TV still pairs itself, so
 * the key never leaves the home network.
 */
export function helperOffer(host: string, port: number, code: string): string {
  return `http://${host}:${port}/pair?code=${code}`;
}

/** The address and code in a phone's offer, or null for anything else (an addon's address, say). */
export function readHelperOffer(link: string): { address: string; code: string } | null {
  const match = /^http:\/\/(\d{1,3}(?:\.\d{1,3}){3}:\d{1,5})\/pair\?code=(\d{6})$/.exec(
    link.trim(),
  );
  if (!match || !parseHelperAddress(match[1]!)) return null;
  return { address: match[1]!, code: match[2]! };
}

/** How Settings shows the address: without the port when it is the usual one. */
export function formatHelperAddress(pairing: Pick<HelperPairing, 'host' | 'port'>): string {
  return pairing.port === HELPER_PORT ? pairing.host : `${pairing.host}:${pairing.port}`;
}

function readPairing(saved: unknown): HelperPairing | null {
  if (typeof saved !== 'object' || saved === null) return null;
  const { host, port, key } = saved as Record<string, unknown>;
  if (typeof host !== 'string' || !isHomeIpv4(host)) return null;
  if (typeof port !== 'number' || !(port >= 1 && port <= 65535)) return null;
  if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(key)) return null;
  return { host, port, key };
}

function form(fields: Record<string, string>): string {
  return Object.keys(fields)
    .map((name) => `${encodeURIComponent(name)}=${encodeURIComponent(fields[name]!)}`)
    .join('&');
}

export interface StreamHelperOptions {
  storage: KeyValueStore;
  fetch?: typeof fetch;
  now?: () => number;
}

export type Reachability = 'unknown' | 'checking' | 'on' | 'off';

export function createStreamHelper(options: StreamHelperOptions) {
  const doFetch = options.fetch ?? ((input, init) => fetch(input, init));
  const now = options.now ?? Date.now;
  const pairing = createPersisted<HelperPairing | null>({
    storage: options.storage,
    key: 'streamHelper',
    initial: null,
    read: readPairing,
  });
  const reachability = createStore<Reachability>('unknown');
  let checkedAt = -Infinity;
  let checking: Promise<boolean> | null = null;

  async function request(
    url: string,
    init: RequestInit,
    timeoutMs: number,
  ): Promise<Response | null> {
    const controller = typeof AbortController === 'undefined' ? null : new AbortController();
    const timer = setTimeout(() => controller?.abort(), timeoutMs);
    try {
      return await doFetch(url, { ...init, signal: controller?.signal, cache: 'no-store' });
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  const base = (to: Pick<HelperPairing, 'host' | 'port'>) => `http://${to.host}:${to.port}`;

  async function isHelper(to: Pick<HelperPairing, 'host' | 'port'>): Promise<boolean> {
    const response = await request(`${base(to)}/status`, { method: 'GET' }, STATUS_TIMEOUT_MS);
    if (!response?.ok) return false;
    try {
      const body = (await response.json()) as { helper?: unknown };
      return body.helper === 'bannertv';
    } catch {
      return false;
    }
  }

  function markReachable(on: boolean) {
    checkedAt = now();
    reachability.set(on ? 'on' : 'off');
  }

  return {
    load: pairing.load,
    get: pairing.get,
    subscribe: pairing.subscribe,
    reachability,

    /** Pairs with the helper at `address` using the code it shows. */
    async pair(address: string, code: string): Promise<PairResult> {
      const to = parseHelperAddress(address);
      if (!to) return 'bad-address';
      const digits = code.replace(/\s/g, '');
      if (!/^\d{6}$/.test(digits)) return 'bad-code';
      const response = await request(
        `${base(to)}/pair`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: form({ code: digits }),
        },
        REQUEST_TIMEOUT_MS,
      );
      if (!response) return 'unreachable';
      if (response.status === 403) return 'wrong-code';
      if (!response.ok) return 'unreachable';
      let key: unknown;
      try {
        key = ((await response.json()) as { key?: unknown }).key;
      } catch {
        return 'unreachable';
      }
      const paired = readPairing({ ...to, key });
      if (!paired) return 'unreachable';
      await pairing.update(() => paired);
      markReachable(true);
      return 'paired';
    },

    /**
     * Forgets the helper. Tells it first, so it stops honouring this TV's key;
     * if it is off or out of reach the TV forgets it anyway.
     */
    async unpair(): Promise<void> {
      await pairing.load();
      const to = pairing.get();
      if (to) {
        await request(
          `${base(to)}/forget`,
          { method: 'POST', headers: { Authorization: `Bearer ${to.key}` } },
          FORGET_TIMEOUT_MS,
        );
      }
      await pairing.update(() => null);
      checkedAt = -Infinity;
      reachability.set('unknown');
    },

    /** Whether the paired helper answers now. Asked again only every REACHABLE_FOR_MS. */
    async reachable(force = false): Promise<boolean> {
      await pairing.load();
      const to = pairing.get();
      if (!to) return false;
      if (!force && now() - checkedAt < REACHABLE_FOR_MS) return reachability.get() === 'on';
      if (!checking) {
        reachability.set('checking');
        checking = isHelper(to).then((on) => {
          checking = null;
          markReachable(on);
          return on;
        });
      }
      return checking;
    },

    /**
     * A link on the helper that plays `url` with `headers`. Throws
     * HelperUnavailable when there is no helper to ask.
     */
    async link(url: string, headers: Record<string, string>): Promise<string> {
      await pairing.load();
      const to = pairing.get();
      if (!to) throw new HelperUnavailable('unpaired');
      const fields: Record<string, string> = { url };
      for (const name of Object.keys(headers)) fields[`h.${name}`] = headers[name]!;
      const response = await request(
        `${base(to)}/links`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Authorization: `Bearer ${to.key}`,
          },
          body: form(fields),
        },
        REQUEST_TIMEOUT_MS,
      );
      if (!response) {
        markReachable(false);
        throw new HelperUnavailable('unreachable');
      }
      markReachable(true);
      if (!response.ok) throw new HelperUnavailable('refused');
      let path: unknown;
      try {
        path = ((await response.json()) as { link?: unknown }).link;
      } catch {
        throw new HelperUnavailable('refused');
      }
      if (typeof path !== 'string' || path.indexOf('/s/') !== 0) {
        throw new HelperUnavailable('refused');
      }
      return base(to) + path;
    },
  };
}

export type StreamHelper = ReturnType<typeof createStreamHelper>;
