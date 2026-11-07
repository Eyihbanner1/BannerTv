import type { ContentType } from 'expo-video';

/** What OkHttp accepts in a header value: visible ASCII, space and tab. It throws on anything else. */
const SENDABLE = /^[\t\x20-\x7e]*$/;

export interface PhoneVideoSource {
  uri: string;
  contentType: ContentType;
  headers?: Record<string, string>;
}

/**
 * The source expo-video opens for a load command, with the addon's request
 * headers (ADR 0005, decision 8) on every request of the stream: expo-video
 * builds a new HTTP data source for each source, so none are left for the
 * next stream. The headers come already cleaned by the page; values OkHttp
 * would refuse are dropped here too, so one bad value can't stop the stream.
 *
 * expo-video takes the User-Agent from `headers["User-Agent"]`, spelled
 * exactly so, and otherwise sends its own. An addon's, whatever its case, is
 * passed under that spelling; without one, nothing is added and expo-video
 * sends the app's.
 */
export function videoSource(
  url: string,
  contentType: ContentType,
  asked: Readonly<Record<string, unknown>> | undefined,
): PhoneVideoSource {
  const source: PhoneVideoSource = { uri: url, contentType };
  if (!asked) return source;
  const headers: Record<string, string> = {};
  let count = 0;
  for (const name of Object.keys(asked)) {
    const value = asked[name];
    if (typeof value !== 'string' || !SENDABLE.test(value)) continue;
    headers[name.toLowerCase() === 'user-agent' ? 'User-Agent' : name] = value;
    count++;
  }
  if (count > 0) source.headers = headers;
  return source;
}
