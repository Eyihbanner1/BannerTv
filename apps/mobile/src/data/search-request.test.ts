import { describe, expect, it, vi } from 'vitest';
import { requestSearch, takeSearchRequests } from './search-request';

describe('search requests', () => {
  it('keeps a term for Search until it opens, then hands it over once', () => {
    requestSearch('Tom Hanks');
    const apply = vi.fn();
    const stop = takeSearchRequests(apply);
    expect(apply).toHaveBeenCalledWith('Tom Hanks');
    stop();
    const later = vi.fn();
    takeSearchRequests(later)();
    expect(later).not.toHaveBeenCalled();
  });

  it('hands a term straight to a Search already open, and not after it stops', () => {
    const apply = vi.fn();
    const stop = takeSearchRequests(apply);
    requestSearch('Zendaya');
    expect(apply).toHaveBeenCalledWith('Zendaya');
    stop();
    requestSearch('Viola Davis');
    expect(apply).toHaveBeenCalledTimes(1);
    const next = vi.fn();
    takeSearchRequests(next)();
    expect(next).toHaveBeenCalledWith('Viola Davis');
  });
});
