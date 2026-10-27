import type { MetaPreview } from '@bannertv/protocol';
import { describe, expect, it, vi } from 'vitest';
import { createQueryCache } from '../query';
import { CATALOG_POLICY } from './client';
import { createCatalogPager } from './pager';

async function flush() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

function titles(...ids: string[]): MetaPreview[] {
  return ids.map((id) => ({
    id,
    type: 'movie',
    name: id,
    posterShape: 'poster',
    genres: [],
    trailers: [],
  }));
}

function setup(pages: Record<number, () => Promise<MetaPreview[]>>, pageable = true) {
  const queries = createQueryCache();
  const fetchPage = vi.fn((skip: number) => {
    const answer = pages[skip];
    return answer ? answer() : Promise.resolve([]);
  });
  const pager = createCatalogPager({
    pageable,
    page: (skip) =>
      queries.query(`page:${skip}`, {
        policy: CATALOG_POLICY,
        persist: false,
        fetch: () => fetchPage(skip).then((value) => ({ value, hints: {} })),
      }),
  });
  // Screens subscribe before they load; the pager follows its pages only then.
  pager.subscribe(() => undefined);
  return { pager, fetchPage };
}

describe('createCatalogPager', () => {
  it('asks for the next page with skip set to the titles so far, and stops when one adds nothing', async () => {
    const { pager, fetchPage } = setup({
      0: () => Promise.resolve(titles('a', 'b', 'c')),
      3: () => Promise.resolve(titles('c', 'd')),
      4: () => Promise.resolve(titles('a', 'b')),
    });
    expect(pager.get()).toEqual({ items: [], status: 'loading' });

    pager.loadMore();
    pager.loadMore(); // ignored: the first page is still loading
    await flush();
    expect(pager.get().status).toBe('ready');
    expect(pager.get().items.map((i) => i.id)).toEqual(['a', 'b', 'c']);

    pager.loadMore();
    await flush();
    expect(pager.get().items.map((i) => i.id)).toEqual(['a', 'b', 'c', 'd']);

    pager.loadMore();
    await flush();
    expect(pager.get().status).toBe('done');
    pager.loadMore();
    await flush();
    expect(fetchPage.mock.calls.map(([skip]) => skip)).toEqual([0, 3, 4]);
  });

  it('is done after one page when the catalog cannot page', async () => {
    const { pager } = setup({ 0: () => Promise.resolve(titles('a')) }, false);
    pager.loadMore();
    await flush();
    expect(pager.get().status).toBe('done');
  });

  it('keeps earlier pages when a later one fails, and retries it', async () => {
    let fail = true;
    const { pager } = setup({
      0: () => Promise.resolve(titles('a', 'b')),
      2: () => (fail ? Promise.reject(new Error('offline')) : Promise.resolve(titles('c'))),
    });
    pager.loadMore();
    await flush();
    pager.loadMore();
    await flush();
    expect(pager.get().status).toBe('error');
    expect(pager.get().error?.message).toBe('offline');
    expect(pager.get().items).toHaveLength(2);

    fail = false;
    pager.retry();
    await flush();
    expect(pager.get().status).toBe('ready');
    expect(pager.get().items.map((i) => i.id)).toEqual(['a', 'b', 'c']);
  });

  it('follows its pages only while subscribed, and catches up when subscribed again', async () => {
    const queries = createQueryCache();
    const pager = createCatalogPager({
      pageable: true,
      page: (skip) =>
        queries.query(`page:${skip}`, {
          policy: CATALOG_POLICY,
          persist: false,
          fetch: () => Promise.resolve({ value: titles('a'), hints: {} }),
        }),
    });
    const listener = vi.fn();
    const stop = pager.subscribe(listener);
    stop();
    pager.loadMore();
    await flush();
    expect(listener).not.toHaveBeenCalled();
    expect(pager.get().status).toBe('loading');

    pager.subscribe(listener);
    expect(pager.get().status).toBe('ready');
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
