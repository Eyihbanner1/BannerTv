import { describe, expect, it } from 'vitest';
import { EMAIL, HIDDEN, redact } from './redact';

/** Every secret in `text` is gone after redacting it, and what should stay stays. */
function check(text: string, gone: string[], kept: string[] = []): string {
  const out = redact(text);
  for (const secret of gone) expect(out, `${secret} in ${out}`).not.toContain(secret);
  for (const part of kept) expect(out, `${part} missing from ${out}`).toContain(part);
  // A second pass changes nothing more.
  expect(redact(out)).toBe(out);
  return out;
}

describe('redact: addresses', () => {
  it('keeps only the scheme and host of an addon address, whose path holds its keys', () => {
    expect(
      redact('https://torrentio.strem.fun/realdebrid=ABCDEFGHJKMNPQRSTUVWX2345678/manifest.json'),
    ).toBe('https://torrentio.strem.fun/…');
  });

  it('drops the query and fragment, where tokens go', () => {
    check(
      'GET https://api.real-debrid.com/rest/1.0/unrestrict/link?auth_token=QWERTYUIOP12345#frag failed',
      ['auth_token', 'QWERTYUIOP12345', 'unrestrict', 'frag'],
      ['GET https://api.real-debrid.com/… failed'],
    );
    check('https://api.themoviedb.org/3/movie/550?api_key=0123456789abcdef0123456789abcdef', [
      'api_key',
      '0123456789abcdef',
      '/3/movie',
    ]);
  });

  it('drops a user name and password before the host, and the port after it', () => {
    expect(redact('http://alice:hunter2@192.168.1.20:11470/hlsv2/abc/master.m3u8')).toBe(
      'http://192.168.1.20/…',
    );
    expect(redact('https://me%40example.com:p4ss@host.example')).toBe('https://host.example');
    expect(redact('http://[2001:db8::1]:8080/x')).toBe('http://[2001:db8::1]/…');
  });

  it('cuts the stremio:// install link, the Stremio server and a stream link alike', () => {
    expect(redact('stremio://addon.example.com/eyJwcm92aWRlcnMiOlsieXRzIl19/manifest.json')).toBe(
      'stremio://addon.example.com/…',
    );
    check(
      'Playback failed for http://127.0.0.1:11470/6f1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c/0',
      ['11470', '6f1a2b3c', '/0'],
      ['http://127.0.0.1/…'],
    );
    check(
      'source: https://cdn.debrid.example/d/AbCdEf/Big.Buck.Bunny.2008.1080p.BluRay.x264.mkv',
      ['Big.Buck.Bunny', 'AbCdEf', 'mkv'],
      ['https://cdn.debrid.example/…'],
    );
  });

  it('keeps the sentence around an address, and nothing of a bare host but the host', () => {
    expect(redact('Could not reach https://addon.example (offline).')).toBe(
      'Could not reach https://addon.example (offline).',
    );
    expect(redact('(see https://addon.example/a/b?c=d).')).toBe('(see https://addon.example/…).');
    expect(redact('https://addon.example/')).toBe('https://addon.example');
    expect(redact('file:///data/user/0/com.bannertv.phone/files/x')).toBe('file:///…');
  });

  it('runs a quoted address to its closing quote, so a title with spaces goes too', () => {
    expect(redact("Couldn't play 'https://cdn.example/Movie Name 2024.mkv'")).toBe(
      "Couldn't play 'https://cdn.example/…'",
    );
    expect(redact('{"url":"https://cdn.example/Film Name (2024)/Film.mkv","ok":false}')).toBe(
      '{"url":"https://cdn.example/…","ok":false}',
    );
    expect(redact('fetch(“https://x.example/a b?c=d”) failed')).toBe(
      'fetch(“https://x.example/…”) failed',
    );
    expect(redact('stream `http://h.example/a b`')).toBe('stream `http://h.example/…`');
  });

  it('cuts a stream link whose title has spaces and no quotes, up to its file ending', () => {
    check(
      'Source error: https://cdn.debrid.example/d/AbC/Big Buck Bunny (2008) 1080p.mkv not found',
      ['Big Buck', 'Bunny', '1080p', 'mkv', 'AbC'],
      ['Source error: https://cdn.debrid.example/… not found'],
    );
    check(
      'tried http://h.example/a b.m3u8?x=1, then /sub/Big Buck Bunny.en.srt',
      ['Bunny', 'srt', 'm3u8'],
      ['tried http://h.example/…'],
    );
    // A cut address followed by ordinary words keeps them.
    expect(redact('Could not reach https://addon.example/x in time')).toBe(
      'Could not reach https://addon.example/… in time',
    );
  });

  it('keeps a stack frame line and column after its address, and nothing in between', () => {
    expect(
      redact(
        'at fetchMeta (http://10.0.2.2:8081/index.bundle?platform=android&dev=true&minify=false:1234:56)',
      ),
    ).toBe('at fetchMeta (http://10.0.2.2/…:1234:56)');
  });

  it('cuts addresses in JSON, escaped JSON and percent-encoded form', () => {
    check(
      '{"transportUrl":"https://comet.elfhosted.com/eyJkZWJyaWRBcGlLZXkiOiJYWVoifQ/manifest.json","flags":{}}',
      ['eyJkZWJy', 'manifest.json'],
      ['"transportUrl":"https://comet.elfhosted.com/…"', '"flags":{}'],
    );
    check(
      String.raw`{"url":"https:\/\/addon.example\/secretpath\/manifest.json"}`,
      ['secretpath', 'manifest'],
      ['https://addon.example'],
    );
    check(
      'redirect=https%3A%2F%2Fuser%40mail.example%3Apw%40addon.example%2Fprivate%2Fid%3Fkey%3Dvalue',
      ['private', 'user', 'pw', 'value'],
      ['https://addon.example/…'],
    );
  });

  it('cuts every address in a stack trace', () => {
    const stack = [
      'TypeError: Network request failed',
      '    at anonymous (https://sports.example/abc123privateid/catalog/tv/live.json:1:2)',
      '    at onPress (address at index.android.bundle:1:1928372)',
      '    at tick (http://localhost:11470/hlsv2/9f8e7d6c5b4a39281706f5e4d3c2b1a0/stream.m3u8)',
    ].join('\n');
    const out = check(
      stack,
      ['abc123privateid', 'catalog', 'hlsv2', '9f8e7d6c5b4a', 'stream.m3u8', '11470'],
      [
        'TypeError: Network request failed',
        'https://sports.example/…:1:2)',
        'at onPress (address at index.android.bundle:1:1928372)',
        'http://localhost/…)',
      ],
    );
    expect(out.split('\n')).toHaveLength(4);
  });

  it('keeps only the scheme of a magnet link and a data: address', () => {
    expect(
      redact(
        'magnet:?xt=urn:btih:C9E15763F722F23E98A29DECDFAE341B98D53056&dn=Sintel.2010.1080p&tr=udp%3A%2F%2Ftracker.example%3A1337',
      ),
    ).toBe(`magnet:${HIDDEN}`);
    expect(redact('Loaded "magnet:?xt=urn:btih:abc&dn=Film" twice')).toBe(
      `Loaded "magnet:${HIDDEN}" twice`,
    );
    expect(redact('src=data:text/vtt;base64,V0VCVlRUCgoxCjAwOjAwLjAwMA==')).toBe(
      `src=data:${HIDDEN}`,
    );
    // Not an address: "data:" in a sentence.
    expect(redact('Invalid data: missing id')).toBe('Invalid data: missing id');
  });

  it('cuts the path after a host written without a scheme, and a path on its own', () => {
    check(
      'Failed to load torrentio.strem.fun/providers=yts|eztv|debridoptions=nocatalog/manifest.json',
      ['providers', 'yts', 'manifest'],
      ['torrentio.strem.fun/…'],
    );
    check(
      'HTTP 404 for /realdebrid=XYZ/stream/movie/tt0111161.json',
      ['realdebrid', 'XYZ', 'tt0111161'],
      ['HTTP 404 for /…'],
    );
    check(
      '    at anonymous (address at /data/user/0/com.bannertv.phone/files/.expo-internal/a1b2c3:1:2345)',
      ['data/user', 'expo-internal', 'a1b2c3'],
      ['(address at /…:1:2345)'],
    );
    // In quotes or brackets, as JSON and messages write a request's path.
    check("Failed '/realdebrid=XYZ/manifest.json'", ['XYZ', 'manifest'], ["Failed '/…'"]);
    check('{"path":"/sportsid-abc/live.json"}', ['sportsid', 'live.json'], ['{"path":"/…"}']);
    check('path [/sportsid-abc/live.json]', ['sportsid'], ['path [/…]']);
    // A screen's path stays.
    expect(redact('Opened /settings from /')).toBe('Opened /settings from /');
    expect(redact('{"screen":"/settings"}')).toBe('{"screen":"/settings"}');
  });
});

describe('redact: secrets', () => {
  it('hides email addresses, plain and percent-encoded', () => {
    expect(redact('Signed in as jane.doe+tv@example.co.uk.')).toBe(`Signed in as ${EMAIL}.`);
    expect(redact('mailto:someone@example.com')).toBe(`mailto:${EMAIL}`);
    expect(redact('login=jane%40example.org&x=1')).not.toContain('jane');
  });

  it('hides the value after a secret name in a query string or a log line', () => {
    check(
      'token=abc123&apikey=XYZ&api_key=k&realDebridToken=RD&pin=1234&next=1',
      ['abc123', 'XYZ', '=k&', 'RD&', '1234'],
      ['token=', 'apikey=', 'realDebridToken=', 'pin=', 'next=1'],
    );
    check('access_token: ya29.a0AfH6SMBx', ['ya29', 'a0AfH6']);
    check('X-Api-Key: sk_live_shortish', ['sk_live'], ['X-Api-Key: ']);
    check('Authorization: Bearer abc.def.ghi', ['abc.def', 'ghi']);
    expect(
      redact(
        'HTTP 401 from https://api.trakt.tv/sync/history (Authorization: Bearer 9f86d081884c7d659a2f)',
      ),
    ).toBe(`HTTP 401 from https://api.trakt.tv/… (Authorization: Bearer ${HIDDEN})`);
    check('Authorization: Basic dXNlcjpwYXNz', ['dXNlcjpwYXNz']);
    // Whatever the kind, and in small letters, which no other step would take for a key.
    check('Authorization: Token lowercaseonlysecret', ['lowercaseonlysecret'], ['Authorization']);
    check('{"authorization":"Token lowercaseonlysecret"}', ['lowercaseonlysecret']);
    check('Cookie: session=abc; rdprefs=lowercasevalue', ['abc', 'lowercasevalue'], ['Cookie: ']);
  });

  it('hides secrets in JSON written inside a JSON string, with its quotes escaped', () => {
    // A rejected object holding a response's body, as messageOf() writes it out.
    const blob = JSON.stringify({
      status: 400,
      body: JSON.stringify({ access_token: 'abc def', pin: '4821', apiKey: 'shortkey', ok: 1 }),
    });
    const out = check(blob, ['abc def', '4821', 'shortkey']);
    expect(out).toContain('"status":400');
    expect(out).toContain(String.raw`\"ok\":1`);
    check(String.raw`{\"pin\":4821,\"name\":\"Ada\"}`, ['4821'], ['Ada']);
    check(String.raw`"{\\\"token\\\":\\\"abc\\\"}"`, ['abc']);
  });

  it('hides secrets in JSON blobs, quoted values with spaces included', () => {
    const blob = JSON.stringify({
      trakt: { access_token: 'aaaa', refresh_token: 'bbbb', expires: 7776000 },
      tmdbKey: 'my tmdb key',
      debrid: { service: 'realdebrid', apiKey: 'short' },
      profile: { name: 'Ada', pin: { salt: 'c2FsdA', hash: 'aGFzaA' } },
      email: 'ada@example.com',
      accountCode: 'K7QM3XTPW9RDHE4A6BNC',
      status: 'idle',
    });
    const out = check(blob, [
      'aaaa',
      'bbbb',
      'my tmdb key',
      'short',
      'c2FsdA',
      'aGFzaA',
      'ada@example.com',
      'K7QM3XTP',
    ]);
    expect(out).toContain('"service":"realdebrid"');
    expect(out).toContain('"status":"idle"');
    expect(out).toContain('"name":"Ada"');
    expect(out).toContain(`"access_token":"${HIDDEN}"`);
    // A secret's object keeps its shape, with each value inside it hidden.
    expect(out).toContain(`"pin":{"salt":"${HIDDEN}","hash":"${HIDDEN}"}`);
  });

  it('hides a PIN however it is written, but keeps a status code', () => {
    check('pin: 4821', ['4821']);
    check('"pin":4821', ['4821']);
    check('Wrong PIN 4821 for Main', ['4821'], ['Wrong PIN', 'for Main']);
    check('The code is 482913', ['482913']);
    expect(redact('statusCode: 404')).toBe('statusCode: 404');
    expect(redact('{"code":500,"error":"Server"}')).toBe('{"code":500,"error":"Server"}');
  });

  it('hides the account code, as shown, typed or bare', () => {
    check('Code K7QM 3XTP W9RD HE4A 6BNC failed', ['K7QM', '6BNC'], ['Code ', ' failed']);
    check('join K7QM-3XTP-W9RD-HE4A-6BNC', ['K7QM', '6BNC']);
    check('join ABCDEFGHJKMNPQRSTUVW', ['ABCDEFGHJKMNPQRSTUVW']);
    // As typed on the keyboard, in small letters.
    check('join k7qm 3xtp w9rd he4a 6bnc', ['k7qm', '6bnc'], ['join ']);
    // Five plain four-letter words are words.
    expect(redact('when that went back here')).toBe('when that went back here');
  });

  it('hides tokens, keys and ids with no name beside them', () => {
    // A Trakt token (64 hex), a TMDB key (32 hex), a Real-Debrid token (52 capitals and digits).
    check(`Trakt said no to ${'a1'.repeat(32)}`, ['a1a1a1a1'], ['Trakt said no to ']);
    check('key 0123456789abcdef0123456789abcdef', ['0123456789abcdef']);
    check('rd ABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRST', ['ABCDEFGHIJ']);
    check('device 123e4567-e89b-12d3-a456-426614174000 gone', ['123e4567', '426614174000']);
    check(
      'jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
      ['eyJhbGci', 'eyJzdWIi', 'dozjgNry'],
    );
    check('base64 config eyJwcm92aWRlcnMiOlsieXRzIl19 rejected', ['eyJwcm92']);
    check('phone 447700900123', ['447700900123']);
    check('hash deadbeefdeadbeefdeadbeef', ['deadbeefdeadbeef']);
  });

  it('keeps ordinary words, names and numbers', () => {
    const plain = [
      "TypeError: Cannot read property 'title' of undefined",
      'Invariant Violation: ReactNativeFiberHostComponent is not a function',
      'Each child in a list should have a unique "key" prop.',
      'Invalid token',
      'at render (address at index.android.bundle:1:234567)',
      'Rendered more hooks than during the previous render.',
      'meta tt0111161 not found in Cinemeta',
    ];
    for (const line of plain) expect(redact(line)).toBe(line);
  });
});
