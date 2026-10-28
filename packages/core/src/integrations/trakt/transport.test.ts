import { describe, expect, it } from 'vitest';
import { readTraktAnswer, TraktError } from './transport';

function kindOf(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    return error instanceof TraktError ? error.kind : 'not a TraktError';
  }
  return undefined;
}

describe('readTraktAnswer', () => {
  it("passes on Trakt's status, body and Retry-After", () => {
    expect(readTraktAnswer(200, { status: 201, data: { id: 3 } })).toEqual({
      status: 201,
      data: { id: 3 },
    });
    expect(readTraktAnswer(200, { status: 429, data: null, retryAfter: 2 })).toEqual({
      status: 429,
      data: null,
      retryAfter: 2,
    });
  });

  it('reads a missing body as null and drops an unusable Retry-After', () => {
    expect(readTraktAnswer(200, { status: 204 })).toEqual({ status: 204, data: null });
    expect(readTraktAnswer(200, { status: 429, data: null, retryAfter: '2' })).toEqual({
      status: 429,
      data: null,
    });
    expect(readTraktAnswer(200, { status: 429, data: null, retryAfter: -1 })).toEqual({
      status: 429,
      data: null,
    });
  });

  it("tells the service's own refusals from Trakt's answers", () => {
    expect(kindOf(() => readTraktAnswer(503, { error: 'unconfigured' }))).toBe('unavailable');
    expect(kindOf(() => readTraktAnswer(400, { error: 'path' }))).toBe('unavailable');
    expect(kindOf(() => readTraktAnswer(502, { error: 'upstream' }))).toBe('network');
    expect(kindOf(() => readTraktAnswer(500, null))).toBe('other');
  });

  it("refuses an answer without Trakt's status", () => {
    expect(kindOf(() => readTraktAnswer(200, null))).toBe('other');
    expect(kindOf(() => readTraktAnswer(200, { data: {} }))).toBe('other');
    expect(kindOf(() => readTraktAnswer(200, { status: '200', data: {} }))).toBe('other');
    expect(kindOf(() => readTraktAnswer(200, { status: 99, data: {} }))).toBe('other');
  });
});
