import type { MetaPreview } from '@bannertv/protocol';
import type { Query } from '../query';
import { createStore, type Store } from '../store';

export type PagerStatus = 'loading' | 'ready' | 'error' | 'done';

export interface PagerState {
  /** Every page so far, in order, each title once. */
  items: readonly MetaPreview[];
  /**
   * loading: a page is on its way. ready: more can be loaded. error: the last
   * page failed (earlier pages stay). done: the catalog has nothing more.
   */
  status: PagerStatus;
  error?: Error;
}

/**
 * Follows its page queries only while something subscribes to it, so a
 * screen that stops reading it (or React's StrictMode remount) leaves nothing
 * behind and keeps nothing alive.
 */
export interface CatalogPager extends Pick<Store<PagerState>, 'get' | 'subscribe'> {
  /** Loads the first page, then the next one each call, unless a page is loading or none is left. */
  loadMore(): void;
  /** Asks for the failed page again. */
  retry(): void;
}

interface Page {
  query: Query<MetaPreview[]>;
  /** How many titles there were before this page. */
  before: number;
  unsubscribe?: () => void;
}

function sameItems(a: readonly MetaPreview[], b: readonly MetaPreview[]): boolean {
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

/**
 * Pages through a catalog the way stremio-core does: the next page is asked
 * for with `skip` set to the number of titles so far. The catalog is done when
 * it cannot page, or when a page adds no new title (some addons ignore skip
 * and send the first page again).
 */
export function createCatalogPager(options: {
  /** The query for the page that starts after `skip` titles. */
  page: (skip: number) => Query<MetaPreview[]>;
  pageable: boolean;
}): CatalogPager {
  const pages: Page[] = [];
  const state = createStore<PagerState>({ items: [], status: 'loading' });
  let listeners = 0;

  function update() {
    if (pages.length === 0) return;
    const items: MetaPreview[] = [];
    const seen = new Set<string>();
    for (const page of pages) {
      for (const item of page.query.get().data ?? []) {
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        items.push(item);
      }
    }
    const last = pages[pages.length - 1]!;
    const page = last.query.get();
    let status: PagerStatus;
    if (page.status === 'idle' || page.status === 'loading') status = 'loading';
    else if (page.status === 'error') status = 'error';
    else if (!options.pageable || items.length <= last.before) status = 'done';
    else status = 'ready';
    const previous = state.get();
    const next: PagerState = {
      items: sameItems(previous.items, items) ? previous.items : items,
      status,
    };
    if (page.status === 'error') next.error = page.error;
    if (
      next.items !== previous.items ||
      next.status !== previous.status ||
      next.error !== previous.error
    ) {
      state.set(next);
    }
  }

  function addPage() {
    const before = state.get().items.length;
    const query = options.page(before);
    const page: Page = { query, before };
    if (listeners > 0) page.unsubscribe = query.subscribe(update);
    pages.push(page);
    query.load();
    update();
  }

  return {
    get: state.get,
    subscribe(listener) {
      const stop = state.subscribe(listener);
      if (listeners++ === 0) {
        for (const page of pages) page.unsubscribe = page.query.subscribe(update);
        update();
      }
      return () => {
        stop();
        if (--listeners > 0) return;
        for (const page of pages) {
          page.unsubscribe?.();
          page.unsubscribe = undefined;
        }
      };
    },
    loadMore() {
      if (pages.length === 0 || state.get().status === 'ready') addPage();
    },
    retry() {
      if (state.get().status === 'error') pages[pages.length - 1]!.query.retry();
    },
  };
}
