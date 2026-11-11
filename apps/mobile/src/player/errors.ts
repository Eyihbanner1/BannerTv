/**
 * Sorts the error text expo-video passes up from Android's player (Media3's PlaybackException
 * message, then its cause's) into the kinds the shared session acts on. The TV's Android app reads
 * Media3's error codes instead (apps/androidtv PlayerErrors.kt); expo-video passes only the words.
 */
export type PhoneErrorKind = 'format' | 'network' | 'decode' | 'other';

const RULES: ReadonlyArray<readonly [PhoneErrorKind, RegExp]> = [
  ['decode', /decoder|mediacodec|codec|renderer|audiosink|audio track init/i],
  [
    'format',
    /extractor|unrecognizedinputformat|could read the stream|parserexception|malformed|unsupported|not supported|no suitable|exceeds_capabilities/i,
  ],
  [
    'network',
    /response code|httpdatasource|invalidresponsecode|unable to connect|timed? ?out|timeout|unknownhost|cleartext|socket|network|connection|ssl|certificate|source error|io error|file ?not ?found/i,
  ],
];

export function errorKind(message: string | undefined): PhoneErrorKind {
  const text = message ?? '';
  for (const [kind, pattern] of RULES) if (pattern.test(text)) return kind;
  return 'other';
}

/**
 * An unknown link that may be an HLS playlist without ".m3u8" in its address: no extractor
 * recognised it, Media3's words for ERROR_CODE_PARSING_CONTAINER_UNSUPPORTED, the one code the
 * TV app retries as HLS (PlayerErrors.mayBeHls). A bad link or a damaged file is not retried,
 * which would only fetch the link again.
 */
export function mayBeHls(message: string | undefined): boolean {
  return /could read the stream/i.test(message ?? '');
}

/**
 * Which error to report after an unknown link was tried as HLS too: the HLS attempt's own,
 * unless it also says the bytes are not a stream, when the first one describes the link better.
 * So a playlist that answers 403 or times out is a network problem, not a format.
 */
export function errorAfterHlsRetry(
  first: string | undefined,
  retry: string | undefined,
): string | undefined {
  return first !== undefined && errorKind(retry) === 'format' ? first : retry;
}

/** The HTTP status in Media3's message, when it gives one ("Response code: 403"). */
export function httpStatus(message: string | undefined): number | undefined {
  const match = /response code:?\s*(\d{3})/i.exec(message ?? '');
  return match ? Number(match[1]) : undefined;
}

/** The plain sentence for the diagnostics line; the screen shows its own words by kind. */
export function errorMessage(kind: PhoneErrorKind, status: number | undefined): string {
  switch (kind) {
    case 'network':
      return status ? `The stream's server answered ${status}` : 'The stream could not be reached';
    case 'format':
      return 'This phone cannot open this kind of file';
    case 'decode':
      return 'This phone cannot decode this video or its sound';
    default:
      return 'The stream stopped with an error';
  }
}
