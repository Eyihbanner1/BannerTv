import { describe, expect, it } from 'vitest';
import {
  acceptsMultipart,
  assetKey,
  chooseBoundary,
  directiveKey,
  directiveTime,
  directiveWins,
  historyKey,
  indexKey,
  manifestKey,
  multipartBody,
  readContentType,
  readIndex,
  readSigned,
  readUpdateRequest,
  signatureHeader,
} from './protocol';
import { readDictionary, readMultipart } from './test/multipart';

const FINGERPRINT = '0123456789abcdef0123456789abcdef01234567';
const ID = '1b4e28ba-2fa1-41d2-883f-0016d3cca427';
const SIG = 'c2lnbmF0dXJl+/AB==';

/** The headers expo-updates 58 sends on Android, with BannerTV's channel and code signing. */
function clientHeaders(change: Record<string, string | null> = {}): Headers {
  const headers = new Headers({
    accept: 'multipart/mixed,application/expo+json,application/json',
    'expo-platform': 'android',
    'expo-protocol-version': '1',
    'expo-api-version': '1',
    'expo-updates-environment': 'BARE',
    'expo-json-error': 'true',
    'eas-client-id': 'a-per-install-id',
    'expo-runtime-version': FINGERPRINT,
    'expo-channel-name': 'main',
    'expo-expect-signature': 'sig, keyid="main", alg="rsa-v1_5-sha256"',
  });
  for (const [name, value] of Object.entries(change)) {
    if (value === null) headers.delete(name);
    else headers.set(name, value);
  }
  return headers;
}

describe('reading a request', () => {
  it('reads what expo-updates sends', () => {
    expect(readUpdateRequest(clientHeaders())).toEqual({
      platform: 'android',
      runtimeVersion: FINGERPRINT,
      channel: 'main',
      expectSignature: true,
    });
  });

  it('takes a hand-set runtime version and other channels', () => {
    expect(
      readUpdateRequest(
        clientHeaders({ 'expo-runtime-version': '1.2.0', 'expo-channel-name': 'pr-12' }),
      ),
    ).toMatchObject({ runtimeVersion: '1.2.0', channel: 'pr-12' });
  });

  it('wants no signature from a client that does not ask for one', () => {
    expect(readUpdateRequest(clientHeaders({ 'expo-expect-signature': null }))).toMatchObject({
      expectSignature: false,
    });
  });

  it.each([
    ['expo-protocol-version', 400],
    ['expo-platform', 400],
    ['expo-runtime-version', 400],
    ['expo-channel-name', 400],
  ])('refuses a request without %s', (header, status) => {
    expect(readUpdateRequest(clientHeaders({ [header]: null }))).toEqual({ status, error: header });
  });

  it('refuses another protocol version as not acceptable', () => {
    expect(readUpdateRequest(clientHeaders({ 'expo-protocol-version': '0' }))).toEqual({
      status: 406,
      error: 'protocol',
    });
  });

  it('refuses a platform expo-updates does not have', () => {
    expect(readUpdateRequest(clientHeaders({ 'expo-platform': 'web' }))).toEqual({
      status: 400,
      error: 'expo-platform',
    });
  });

  it.each(['main:android', 'a b', '', '-1', 'x'.repeat(129)])(
    'refuses the runtime version %j, which could not be a key',
    (runtimeVersion) => {
      expect(readUpdateRequest(clientHeaders({ 'expo-runtime-version': runtimeVersion }))).toEqual({
        status: 400,
        error: 'expo-runtime-version',
      });
    },
  );

  it.each(['Main', 'main:x', '', 'a'.repeat(33)])('refuses the channel %j', (channel) => {
    expect(readUpdateRequest(clientHeaders({ 'expo-channel-name': channel }))).toEqual({
      status: 400,
      error: 'expo-channel-name',
    });
  });

  it('refuses a client that takes only JSON, which cannot carry a directive', () => {
    expect(readUpdateRequest(clientHeaders({ accept: 'application/expo+json' }))).toEqual({
      status: 406,
      error: 'accept',
    });
  });
});

describe('accept', () => {
  it.each([
    [null, true],
    ['', true],
    ['*/*', true],
    ['multipart/*', true],
    ['application/json;q=0.9, multipart/mixed', true],
    ['MULTIPART/MIXED', true],
    ['multipart/mixed;q=0, application/json', false],
    ['application/json', false],
  ])('%j takes multipart: %s', (accept, takes) => {
    expect(acceptsMultipart(accept)).toBe(takes);
  });
});

describe('keys', () => {
  it('names each record by what it is for', () => {
    expect(assetKey('abc')).toBe('asset:abc');
    expect(manifestKey(ID)).toBe(`manifest:${ID}`);
    expect(indexKey('main', 'android', FINGERPRINT)).toBe(`index:main:android:${FINGERPRINT}`);
    expect(directiveKey('main', 'android', '1.0')).toBe('directive:main:android:1.0');
    expect(historyKey('test', 'ios', '1.0')).toBe('history:test:ios:1.0');
  });
});

describe('stored records', () => {
  it('reads an index', () => {
    const createdAt = '2026-11-09T12:00:00.000Z';
    expect(readIndex(JSON.stringify({ id: ID, createdAt }))).toEqual({ id: ID, createdAt });
  });

  it.each([null, 'not json', '{}', JSON.stringify({ id: 'x', createdAt: '2026-11-09' })])(
    'reads %j as no index',
    (text) => {
      expect(readIndex(text)).toBeUndefined();
    },
  );

  it('takes a signature only in a form the header can carry', () => {
    expect(readSigned({ sig: SIG, keyid: 'main' })).toEqual({ sig: SIG, keyid: 'main' });
    expect(readSigned({ sig: 'a"b', keyid: 'main' })).toBeUndefined();
    expect(readSigned({ sig: SIG, keyid: 'ma"in' })).toBeUndefined();
    expect(readSigned({ sig: SIG })).toBeUndefined();
    expect(readSigned(null)).toBeUndefined();
  });

  it('serves a content type only as the publish script writes them', () => {
    expect(readContentType({ contentType: 'image/png' })).toBe('image/png');
    expect(readContentType({ contentType: 'image/svg+xml' })).toBe('image/svg+xml');
    expect(readContentType({ contentType: 'text/html\r\nx-evil: 1' })).toBe(
      'application/octet-stream',
    );
    expect(readContentType(null)).toBe('application/octet-stream');
  });

  it('reads when a roll back was made', () => {
    const commitTime = '2026-11-09T12:00:00.000Z';
    const text = JSON.stringify({ type: 'rollBackToEmbedded', parameters: { commitTime } });
    expect(directiveTime(text)).toBe(Date.parse(commitTime));
    expect(directiveTime(JSON.stringify({ type: 'noUpdateAvailable' }))).toBeUndefined();
    expect(directiveTime('{')).toBeUndefined();
    expect(directiveTime(null)).toBeUndefined();
  });

  it('lets the newer of a roll back and an update win', () => {
    const index = { id: ID, createdAt: '2026-11-09T12:00:00.000Z' };
    const at = Date.parse(index.createdAt);
    expect(directiveWins(at + 1, index)).toBe(true);
    expect(directiveWins(at, index)).toBe(true);
    expect(directiveWins(at - 1, index)).toBe(false);
    expect(directiveWins(at, undefined)).toBe(true);
    expect(directiveWins(undefined, index)).toBe(false);
  });
});

describe('the signature header', () => {
  it('is a dictionary of strings expo-updates reads sig, keyid and alg from', () => {
    const header = signatureHeader({ sig: SIG, keyid: 'main' });
    expect(header).toBe(`sig="${SIG}", keyid="main", alg="rsa-v1_5-sha256"`);
    expect(readDictionary(header)).toEqual({ sig: SIG, keyid: 'main', alg: 'rsa-v1_5-sha256' });
  });
});

describe('the multipart body', () => {
  it('reads back to exactly the text each part was given', () => {
    // CRLFs, a boundary-like line and characters outside ASCII survive untouched.
    const manifest = '{"id":"x","note":"line\\r\\n--not-the-boundary\\u00e9"}\r\n--nope';
    const body = multipartBody(
      [{ name: 'manifest', body: manifest, signed: { sig: SIG, keyid: 'main' } }],
      'bannertv-b',
    );
    const parts = readMultipart(body, 'bannertv-b');
    expect(parts).toHaveLength(1);
    expect(parts[0]?.body).toBe(manifest);
    expect(parts[0]?.headers).toEqual({
      'content-disposition': 'form-data; name="manifest"',
      'content-type': 'application/json; charset=utf-8',
      'expo-signature': `sig="${SIG}", keyid="main", alg="rsa-v1_5-sha256"`,
    });
  });

  it('leaves the signature header off a part that has none', () => {
    const parts = readMultipart(
      multipartBody([{ name: 'directive', body: '{}' }], 'bannertv-b'),
      'bannertv-b',
    );
    expect(parts[0]?.headers['expo-signature']).toBeUndefined();
    expect(parts[0]?.headers['content-disposition']).toBe('form-data; name="directive"');
  });

  it('picks a boundary that no part contains', () => {
    const tries = ['taken', 'free'];
    const boundary = chooseBoundary(
      [{ name: 'manifest', body: 'x--bannertv-taken' }],
      () => tries.shift() ?? 'none',
    );
    expect(boundary).toBe('bannertv-free');
  });
});
