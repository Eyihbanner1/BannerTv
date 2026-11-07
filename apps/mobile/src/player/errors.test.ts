import { describe, expect, it } from 'vitest';
import { errorKind, httpStatus, mayBeHls } from './errors';

describe('player error kinds', () => {
  it('reads Media3 messages as the TV reads its error codes', () => {
    expect(errorKind('Source error Response code: 404')).toBe('network');
    expect(errorKind('Source error Unable to connect to https://x')).toBe('network');
    expect(
      errorKind(
        'Source error None of the available extractors (MatroskaExtractor, ...) could read the stream.',
      ),
    ).toBe('format');
    expect(errorKind('Decoder init failed: c2.android.hevc.decoder, Format(1, null, ...)')).toBe(
      'decode',
    );
    expect(errorKind('Unexpected runtime error')).toBe('other');
    expect(errorKind(undefined)).toBe('other');
  });

  it('tries an unknown link as HLS only on a format error', () => {
    expect(mayBeHls('could read the stream')).toBe(true);
    expect(mayBeHls('Response code: 403')).toBe(false);
  });

  it('finds the HTTP status', () => {
    expect(httpStatus('Source error Response code: 403')).toBe(403);
    expect(httpStatus('Source error')).toBeUndefined();
  });
});
