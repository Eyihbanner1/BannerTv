import { fromBase64Url, type SyncCrypto } from '@bannertv/core';
import { describe, expect, it, vi } from 'vitest';
import { createWebCrypto, type CryptoSource } from '../platform/web-crypto';
import { createPairing } from './pairing';
import {
  createPhoneKeyLink,
  newSealingKey,
  openPhoneKey,
  phoneKeyQrText,
  SEALING_KEY_BYTES,
} from './phone-key';

// Node's Web Crypto seals as the phone page does, and stands in for the TV's to open.
const node = globalThis.crypto as unknown as CryptoSource;
const tv = createWebCrypto(node);
const SERVICE = 'https://pair.example.com';
const CODE = 'K7P2QZ';
// Obviously fake keys: the shortest and the longest a SubDL key can be, and one between.
const FAKE_KEY = 'FAKE-SUBDL-KEY-0000';
const SHORT_FAKE_KEY = 'FAKE_000';
const LONG_FAKE_KEY = 'FAKE-SUBDL-KEY-'.padEnd(128, '0');

const encode = (text: string) => new TextEncoder().encode(text);

/** Base64url without padding, by another road than the core's. */
function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Seals `plain` as the phone page does: base64url of a 12-byte IV, then the ciphertext and tag. */
async function seal(
  k: Uint8Array,
  code: string,
  plain: Uint8Array,
  prefix = 'bannertv subdl-key v1 ',
): Promise<string> {
  const iv = node.getRandomValues(new Uint8Array(12));
  const key = await node.subtle.importKey('raw', new Uint8Array(k), 'AES-GCM', false, ['encrypt']);
  const sealed = new Uint8Array(
    await node.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: encode(prefix + code), tagLength: 128 },
      key,
      new Uint8Array(plain),
    ),
  );
  const all = new Uint8Array(iv.length + sealed.length);
  all.set(iv);
  all.set(sealed, iv.length);
  return base64Url(all);
}

/** The same sealed text with one bit changed at `at` (counted in bytes). */
function changed(sealed: string, at: number): string {
  const bytes = fromBase64Url(sealed)!;
  const index = at < 0 ? bytes.length + at : at;
  bytes[index] = bytes[index]! ^ 1;
  return base64Url(bytes);
}

const newK = () => node.getRandomValues(new Uint8Array(32));

describe('the sealing key and the QR code', () => {
  it('makes a new 32-byte key for each session, from the secure random source', () => {
    const random = vi.fn((length: number) => node.getRandomValues(new Uint8Array(length)));
    const crypto = { ...tv, random } as SyncCrypto;
    const first = newSealingKey(crypto);
    const second = newSealingKey(crypto);
    expect(random).toHaveBeenCalledWith(SEALING_KEY_BYTES);
    expect(first.length).toBe(32);
    expect(second.length).toBe(32);
    expect(Array.from(first)).not.toEqual(Array.from(second));
  });

  it('puts the key after the code, in the fragment only', () => {
    const k = newK();
    const pageUrl = `${SERVICE}/subdl#code=${CODE}`;
    const text = phoneKeyQrText(pageUrl, k);
    expect(text).toBe(`${pageUrl}&k=${base64Url(k)}`);
    const url = new URL(text);
    expect(url.pathname).toBe('/subdl');
    expect(url.search).toBe('');
    const fragment = new URLSearchParams(url.hash.slice(1));
    expect(fragment.get('code')).toBe(CODE);
    expect(fragment.get('k')).toHaveLength(43);
    expect(Array.from(fromBase64Url(fragment.get('k')!)!)).toEqual(Array.from(k));
  });
});

describe('openPhoneKey', () => {
  it('opens what the phone sealed for this session', async () => {
    const k = newK();
    for (const key of [FAKE_KEY, SHORT_FAKE_KEY, LONG_FAKE_KEY]) {
      expect(await openPhoneKey(tv, k, CODE, await seal(k, CODE, encode(key)))).toBe(key);
    }
  });

  it('refuses anything changed on the way', async () => {
    const k = newK();
    const sealed = await seal(k, CODE, encode(FAKE_KEY));
    // A bit of the IV, of the ciphertext, and of the tag.
    for (const at of [0, 11, 12, 20, -16, -1]) {
      expect(await openPhoneKey(tv, k, CODE, changed(sealed, at))).toBeNull();
    }
    expect(await openPhoneKey(tv, k, CODE, sealed.slice(0, -3))).toBeNull();
  });

  it('opens only with its own key and code', async () => {
    const k = newK();
    const sealed = await seal(k, CODE, encode(FAKE_KEY));
    expect(await openPhoneKey(tv, newK(), CODE, sealed)).toBeNull();
    expect(await openPhoneKey(tv, k, 'K7P3QZ', sealed)).toBeNull();
    const otherVersion = await seal(k, CODE, encode(FAKE_KEY), 'bannertv subdl-key v2 ');
    expect(await openPhoneKey(tv, k, CODE, otherVersion)).toBeNull();
    const forAddons = await seal(k, CODE, encode(FAKE_KEY), '');
    expect(await openPhoneKey(tv, k, CODE, forAddons)).toBeNull();
  });

  it('refuses what opens but is not a SubDL key', async () => {
    const k = newK();
    const notKeys = [
      encode('not a key at all'),
      encode(` ${FAKE_KEY} `),
      encode('FAKE-0'),
      encode('FAKE-ключ-0000'),
      encode(`${LONG_FAKE_KEY}0`),
      // Not UTF-8.
      Uint8Array.from([0xff, 0xfe, 0x46, 0x41, 0x4b, 0x45, 0x30, 0x30, 0x30, 0x30]),
      Uint8Array.from([0x46, 0x41, 0x4b, 0x45, 0xc0, 0xaf, 0x30, 0x30, 0x30, 0x30]),
    ];
    for (const plain of notKeys) {
      expect(await openPhoneKey(tv, k, CODE, await seal(k, CODE, plain))).toBeNull();
    }
  });

  it('refuses junk without trying to open it', async () => {
    const k = newK();
    const decrypt = vi.fn(tv.aesGcmDecrypt);
    const crypto = { ...tv, aesGcmDecrypt: decrypt } as SyncCrypto;
    const junk = ['', 'A', 'AAAAA', 'not base64url!', 'a+b/c=', 'A'.repeat(47), 'A'.repeat(209)];
    for (const sealed of junk) expect(await openPhoneKey(crypto, k, CODE, sealed)).toBeNull();
    expect(await openPhoneKey(crypto, k, CODE, 42 as unknown as string)).toBeNull();
    const sealed = await seal(k, CODE, encode(FAKE_KEY));
    expect(await openPhoneKey(crypto, k.slice(0, 16), CODE, sealed)).toBeNull();
    expect(decrypt).not.toHaveBeenCalled();
    // Base64url of the right length that was never sealed is tried, and refused.
    expect(await openPhoneKey(crypto, k, CODE, 'A'.repeat(64))).toBeNull();
    expect(decrypt).toHaveBeenCalledTimes(1);
  });

  it('never throws, whatever the crypto does', async () => {
    const k = newK();
    const sealed = await seal(k, CODE, encode(FAKE_KEY));
    const throws = {
      ...tv,
      aesGcmDecrypt: () => {
        throw new Error('no');
      },
    } as SyncCrypto;
    const rejects = { ...tv, aesGcmDecrypt: () => Promise.reject(new Error('no')) } as SyncCrypto;
    await expect(openPhoneKey(throws, k, CODE, sealed)).resolves.toBeNull();
    await expect(openPhoneKey(rejects, k, CODE, sealed)).resolves.toBeNull();
  });
});

/**
 * A relay that opens SubDL key sessions (or, `older`, only addon ones) and
 * hands over what was sent once. It records every request the TV made. It can
 * be down (every request fails) or let the session on screen run out.
 */
function keyRelay(options: { older?: boolean } = {}) {
  const requests: string[] = [];
  let sessions = 0;
  let code = '';
  let pending: string | undefined;
  let down = false;
  let gone = false;
  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input).slice(SERVICE.length);
    requests.push(`${path} ${String(init?.body)}`);
    if (down) throw new TypeError('Failed to fetch');
    if (path === '/api/sessions?for=subdl-key') {
      sessions++;
      code = `K7P${sessions + 1}QZ`;
      pending = undefined;
      gone = false;
      const session = { code, secret: `secret-${sessions}`, expiresIn: 600 };
      if (options.older) return reply({ ...session, pageUrl: `${SERVICE}/#code=${code}` }, 201);
      return reply(
        { ...session, pageUrl: `${SERVICE}/subdl#code=${code}`, kind: 'subdl-key' },
        201,
      );
    }
    if (gone) return reply({ error: 'expired' }, 404);
    if (path === `/api/sessions/${code}/collect` && pending !== undefined) {
      const sealed = pending;
      pending = undefined;
      return reply({ status: 'sent', sealed });
    }
    return reply({ status: 'waiting', expiresIn: 500 });
  });
  return {
    fetch: fetch as unknown as typeof globalThis.fetch,
    requests,
    send: (sealed: string) => void (pending = sealed),
    setDown: (value: boolean) => void (down = value),
    expire: () => void (gone = true),
  };
}

/** The code and K in a QR code's text, as the phone page reads them. */
function scan(qrText: string): { code: string; k: Uint8Array } {
  const fragment = new URLSearchParams(new URL(qrText).hash.slice(1));
  return { code: fragment.get('code')!, k: fromBase64Url(fragment.get('k')!)! };
}

function waitingText(link: ReturnType<typeof createPhoneKeyLink>): string {
  const state = link.get();
  if (state.status !== 'waiting') throw new Error(`Not waiting: ${state.status}`);
  return state.qrText;
}

describe('createPhoneKeyLink', () => {
  const linkTo = (
    relay: ReturnType<typeof keyRelay>,
    cryptoWorks: () => Promise<boolean> = () => Promise.resolve(true),
  ) =>
    createPhoneKeyLink(
      createPairing({ service: SERVICE, kind: 'subdl-key', fetch: relay.fetch, pollMs: 5 }),
      tv,
      cryptoWorks,
    );

  it('gives each session its own key, and opens what is sent with it', async () => {
    const relay = keyRelay();
    const link = linkTo(relay);
    const keys: (string | null)[] = [];
    link.onKey((key) => keys.push(key));
    link.start();
    await vi.waitFor(() => expect(link.get().status).toBe('waiting'));
    expect(link.get()).toMatchObject({ host: 'pair.example.com' });
    const first = scan(waitingText(link));
    expect(first.code).toBe('K7P2QZ');
    expect(first.k).toHaveLength(32);

    relay.send(await seal(first.k, first.code, encode(FAKE_KEY)));
    await vi.waitFor(() => expect(keys).toEqual([FAKE_KEY]));
    await vi.waitFor(() => expect(scan(waitingText(link)).code).toBe('K7P3QZ'));
    const second = scan(waitingText(link));
    expect(Array.from(second.k)).not.toEqual(Array.from(first.k));

    // Sealed with the last session's key, it does not open in this one.
    relay.send(await seal(first.k, second.code, encode(FAKE_KEY)));
    await vi.waitFor(() => expect(keys).toEqual([FAKE_KEY, null]));
    await vi.waitFor(() => expect(scan(waitingText(link)).code).toBe('K7P4QZ'));
    link.stop();

    // No key and no K ever went to the relay.
    const sent = relay.requests.join('\n');
    expect(sent).not.toContain(FAKE_KEY);
    expect(sent).not.toContain(base64Url(first.k));
    expect(sent).not.toContain(base64Url(second.k));
  });

  it('says when what came does not open, and a new code follows', async () => {
    const relay = keyRelay();
    const link = linkTo(relay);
    const keys: (string | null)[] = [];
    link.onKey((key) => keys.push(key));
    link.start();
    await vi.waitFor(() => expect(link.get().status).toBe('waiting'));
    const { code, k } = scan(waitingText(link));
    relay.send(changed(await seal(k, code, encode(FAKE_KEY)), -1));
    await vi.waitFor(() => expect(keys).toEqual([null]));
    await vi.waitFor(() => expect(scan(waitingText(link)).code).toBe('K7P3QZ'));
    link.stop();
  });

  it("says when the relay can't be reached, and trying again opens a code", async () => {
    const relay = keyRelay();
    relay.setDown(true);
    const link = linkTo(relay);
    link.start();
    await vi.waitFor(() => expect(link.get()).toEqual({ status: 'unavailable' }));
    relay.setDown(false);
    link.start();
    await vi.waitFor(() => expect(link.get().status).toBe('waiting'));
    const { code, k } = scan(waitingText(link));
    expect(code).toBe('K7P2QZ');
    expect(k).toHaveLength(32);
    link.stop();
  });

  it('says when the code has run out, and a new code comes with a new key', async () => {
    const relay = keyRelay();
    const link = linkTo(relay);
    const keys: (string | null)[] = [];
    link.onKey((key) => keys.push(key));
    link.start();
    await vi.waitFor(() => expect(link.get().status).toBe('waiting'));
    const first = scan(waitingText(link));
    relay.expire();
    await vi.waitFor(() => expect(link.get()).toEqual({ status: 'expired' }));
    // The relay is asked nothing more for that code.
    const asked = relay.requests.length;
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(relay.requests.length).toBe(asked);

    link.start();
    await vi.waitFor(() => expect(link.get().status).toBe('waiting'));
    const second = scan(waitingText(link));
    expect(second.code).toBe('K7P3QZ');
    expect(Array.from(second.k)).not.toEqual(Array.from(first.k));
    // And what is sealed with the new key opens.
    relay.send(await seal(second.k, second.code, encode(FAKE_KEY)));
    await vi.waitFor(() => expect(keys).toEqual([FAKE_KEY]));
    link.stop();
  });

  it("is off when the page's Web Crypto fails its self-test, and asks the relay nothing", async () => {
    const relay = keyRelay();
    const link = linkTo(relay, () => Promise.resolve(false));
    const listener = vi.fn();
    link.subscribe(listener);
    link.start();
    await vi.waitFor(() => expect(link.get()).toEqual({ status: 'off' }));
    expect(listener).toHaveBeenCalled();
    const broken = linkTo(relay, () => Promise.reject(new Error('no')));
    broken.start();
    await vi.waitFor(() => expect(broken.get()).toEqual({ status: 'off' }));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(relay.requests).toEqual([]);
  });

  it('stays opening while the self-test runs, and opens a code once it passes', async () => {
    const relay = keyRelay();
    let pass: (works: boolean) => void = () => undefined;
    const test = new Promise<boolean>((resolve) => {
      pass = resolve;
    });
    const link = linkTo(relay, () => test);
    link.start();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(link.get()).toEqual({ status: 'opening' });
    expect(relay.requests).toEqual([]);

    // Stopped before it answers, it opens nothing when it does.
    link.stop();
    pass(true);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(relay.requests).toEqual([]);
    expect(link.get()).toEqual({ status: 'opening' });

    // Started again, the test already passed, and a code opens.
    link.start();
    await vi.waitFor(() => expect(link.get().status).toBe('waiting'));
    expect(relay.requests.filter((request) => request.startsWith('/api/sessions?'))).toEqual([
      '/api/sessions?for=subdl-key undefined',
    ]);
    link.stop();
  });

  it('is off with an older relay, so the screen shows the SubDL page instead', async () => {
    const relay = keyRelay({ older: true });
    const link = linkTo(relay);
    link.start();
    await vi.waitFor(() => expect(link.get()).toEqual({ status: 'off' }));
    link.stop();
  });

  it('lets go of the key when it stops', async () => {
    const relay = keyRelay();
    const link = linkTo(relay);
    const listener = vi.fn();
    link.subscribe(listener);
    link.start();
    await vi.waitFor(() => expect(link.get().status).toBe('waiting'));
    link.stop();
    expect(link.get()).toEqual({ status: 'opening' });
    expect(listener).toHaveBeenCalled();
    const asked = relay.requests.length;
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(relay.requests.length).toBe(asked);
  });
});
