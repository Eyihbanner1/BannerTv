import { describe, expect, it } from 'vitest';
import { errorAfterHlsRetry, errorKind, httpStatus, mayBeHls } from './errors';

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

  it('tries an unknown link as HLS only when no extractor knew it', () => {
    expect(
      mayBeHls(
        'A playback exception has occurred: Source error None of the available extractors (FlvExtractor, ...) could read the stream.',
      ),
    ).toBe(true);
    expect(mayBeHls('Response code: 403')).toBe(false);
    // A bad link or a damaged file is not fetched again as HLS.
    expect(mayBeHls('A playback exception has occurred: Source error Malformed URL')).toBe(false);
    expect(
      mayBeHls('Source error Searched too many bytes. {contentIsMalformed=true, dataType=1}'),
    ).toBe(false);
  });

  it('reports the HLS try’s own error, unless it too found no stream', () => {
    const noExtractor =
      'Source error None of the available extractors (...) could read the stream.';
    const notPlaylist =
      'Source error Input does not start with the #EXTM3U header. {contentIsMalformed=true, dataType=4}';
    // A web page is neither a file nor a playlist: the first answer says so.
    expect(errorAfterHlsRetry(noExtractor, notPlaylist)).toBe(noExtractor);
    // A playlist the server refused or that timed out is a network problem, not a format.
    expect(errorAfterHlsRetry(noExtractor, 'Source error Response code: 403')).toBe(
      'Source error Response code: 403',
    );
    expect(errorKind(errorAfterHlsRetry(noExtractor, 'Source error Response code: 403'))).toBe(
      'network',
    );
    // With no HLS try, the error as it came.
    expect(errorAfterHlsRetry(undefined, notPlaylist)).toBe(notPlaylist);
  });

  it('finds the HTTP status', () => {
    expect(httpStatus('Source error Response code: 403')).toBe(403);
    expect(httpStatus('Source error')).toBeUndefined();
  });
});
