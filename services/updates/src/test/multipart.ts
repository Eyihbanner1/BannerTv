/**
 * Reads a multipart/mixed answer back the way expo-updates does (okhttp's MultipartReader): a
 * part's body is everything between the blank line after its headers and the CRLF before the
 * next delimiter. Strict on purpose: a stray byte there would break the client's signature
 * check, so here it fails a test.
 */
export interface ReadPart {
  headers: Record<string, string>;
  body: string;
}

export function boundaryOf(contentType: string | null): string {
  const match = /^multipart\/mixed;\s*boundary=([^;\s]+)$/.exec(contentType ?? '');
  if (!match?.[1]) throw new Error(`not multipart/mixed with a boundary: ${contentType}`);
  return match[1];
}

export function readMultipart(text: string, boundary: string): ReadPart[] {
  const open = `--${boundary}\r\n`;
  const between = `\r\n--${boundary}\r\n`;
  const close = `\r\n--${boundary}--\r\n`;
  if (!text.startsWith(open)) throw new Error('the body does not start with the boundary');
  if (!text.endsWith(close)) throw new Error('the body does not end with the closing boundary');
  const inner = text.slice(open.length, text.length - close.length);
  return inner.split(between).map((raw) => {
    const end = raw.indexOf('\r\n\r\n');
    if (end < 0) throw new Error('a part has no blank line after its headers');
    const headers: Record<string, string> = {};
    for (const line of raw.slice(0, end).split('\r\n')) {
      const colon = line.indexOf(':');
      if (colon < 1) throw new Error(`a header line without a name: ${line}`);
      headers[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim();
    }
    return { headers, body: raw.slice(end + 4) };
  });
}

/** The name in a part's content-disposition: form-data; name="...". */
export function partName(part: ReadPart): string | undefined {
  return /^form-data;\s*name="([^"]+)"$/.exec(part.headers['content-disposition'] ?? '')?.[1];
}

/** A structured-field dictionary of strings, as the expo-signature header is. */
export function readDictionary(header: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const member of header.split(',')) {
    const match = /^\s*([a-z*][a-z0-9_.*-]*)="([^"\\]*)"\s*$/.exec(member);
    if (!match?.[1]) throw new Error(`not a string member: ${member}`);
    out[match[1]] = match[2] ?? '';
  }
  return out;
}
