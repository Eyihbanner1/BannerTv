import type { Video } from '@bannertv/protocol';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { initI18n } from '../../i18n';
import { rememberFocus, rememberScroll } from '../../navigation/focus-memory';
import { EpisodeList } from './EpisodeList';

const watched = new Set<string>();
const seen = new Map<string, { position: number; duration: number; watched?: boolean }>();

vi.mock('../../data/library', () => ({
  watchedSet: {
    subscribe: () => () => undefined,
    version: () => 0,
    has: (id: string) => watched.has(id),
  },
}));
vi.mock('../../data/playback', () => ({ progress: { get: (id: string) => seen.get(id) } }));
// A server render wants a server snapshot of each store: read the stores directly.
vi.mock('react', async (importOriginal) => {
  const react = await importOriginal<typeof import('react')>();
  return { ...react, useSyncExternalStore: (_subscribe: unknown, get: () => unknown) => get() };
});

interface Drawn {
  key: string;
  label: string;
  top: string;
  texts: string[];
  image?: string;
  progress?: string;
  watched: boolean;
}

/** The text of each paragraph, in order. */
function lines(html: string): string[] {
  const found: string[] = [];
  const paragraph = /<p[^>]*>([^<]*)<\/p>/g;
  for (let match = paragraph.exec(html); match; match = paragraph.exec(html)) found.push(match[1]!);
  return found;
}

/** Each drawn episode: its focus key, spoken label, place, lines of text, picture and marks. */
function drawn(props: Parameters<typeof EpisodeList>[0]): Drawn[] {
  const html = renderToStaticMarkup(createElement(EpisodeList, props));
  const items = html.split('<div role="button"').slice(1);
  return items.map((item) => {
    const attribute = (name: string) => new RegExp(`${name}="([^"]*)"`).exec(item)?.[1];
    return {
      key: attribute('data-focus-key') ?? '',
      label: attribute('aria-label') ?? '',
      top: /style="top:([^"]*)"/.exec(item)?.[1] ?? '',
      texts: lines(item),
      image: /<img[^>]* src="([^"]*)"/.exec(item)?.[1],
      progress: /style="width:([^"]*)"/.exec(item)?.[1],
      watched: /<span[^>]*aria-hidden="true"/.test(item),
    };
  });
}

function season(count: number): Video[] {
  const videos: Video[] = [];
  for (let n = 1; n <= count; n++) {
    videos.push({
      id: `tt1:1:${n}`,
      title: n % 4 === 0 ? '' : `Episode name ${n}`,
      season: 1,
      episode: n,
      released: new Date(Date.UTC(2024, 0, n)).toISOString(),
      thumbnail: n % 3 === 0 ? undefined : `https://img.example.com/${n}.jpg`,
      overview: n % 2 === 0 ? `What happens in ${n}` : undefined,
    } as Video);
  }
  return videos;
}

afterAll(() => {
  vi.unstubAllEnvs();
});

beforeAll(() => {
  vi.stubEnv('TZ', 'UTC');
  initI18n();
  // Artwork and Pressable keep their DOM work in layout effects, which a server render skips.
  const error = console.error.bind(console);
  vi.spyOn(console, 'error').mockImplementation((message: unknown, ...rest: unknown[]) => {
    if (String(message).indexOf('useLayoutEffect does nothing on the server') < 0) {
      error(message, ...rest);
    }
  });
});

describe('the episode list', () => {
  it('draws the episodes near the view, with their names, dates and marks', () => {
    const videos = season(12);
    videos.push({
      id: 'tt1:1:13',
      title: 'Finale',
      season: 1,
      episode: 13,
      released: '2999-01-01T00:00:00.000Z',
    } as Video);
    watched.add('tt1:1:6');
    seen.set('tt1:1:7', { position: 600, duration: 2400 });
    seen.set('tt1:1:10', { position: 100, duration: 100, watched: true });
    // As focus leaves it on episode 8: the list starts where it was, not at startIndex.
    rememberFocus('ep-test', 'details-episodes-7');
    rememberScroll('ep-test', 6);
    const list = drawn({
      focusKey: 'details-episodes',
      memoryKey: 'ep-test',
      videos,
      onPress: () => undefined,
      // What the addon left out of episodes 8 and 9.
      extras: {
        8: { episode: 8, name: 'From TMDB', overview: 'Not used', stillPath: '/not-used.jpg' },
        9: { episode: 9, overview: 'TMDB says', stillPath: '/still.jpg' },
      },
    } as unknown as Parameters<typeof EpisodeList>[0]);

    // Two above the anchor, five in view and two below: indexes 4 to 12.
    const image = (n: number) => `https://img.example.com/${n}.jpg`;
    const row = (index: number, label: string, texts: string[], extra: Partial<Drawn> = {}) => ({
      key: `details-episodes-${index}`,
      label,
      top: `${index * 168}px`,
      texts,
      image: image(index + 1),
      progress: undefined,
      watched: false,
      ...extra,
    });
    expect(list).toEqual([
      row(4, '5. Episode name 5, 5 Jan 2024', ['5. Episode name 5', '5 Jan 2024']),
      row(
        5,
        '6. Episode name 6, 6 Jan 2024, watched',
        ['6. Episode name 6', '6 Jan 2024', 'What happens in 6'],
        { image: undefined, watched: true },
      ),
      row(6, '7. Episode name 7, 7 Jan 2024', ['7. Episode name 7', '7 Jan 2024'], {
        progress: '25%',
      }),
      row(7, '8. From TMDB, 8 Jan 2024', ['8. From TMDB', '8 Jan 2024', 'What happens in 8']),
      row(8, '9. Episode name 9, 9 Jan 2024', ['9. Episode name 9', '9 Jan 2024', 'TMDB says'], {
        image: 'https://image.tmdb.org/t/p/w300/still.jpg',
      }),
      row(
        9,
        '10. Episode name 10, 10 Jan 2024, watched',
        ['10. Episode name 10', '10 Jan 2024', 'What happens in 10'],
        { watched: true },
      ),
      row(10, '11. Episode name 11, 11 Jan 2024', ['11. Episode name 11', '11 Jan 2024']),
      row(11, 'Episode 12, 12 Jan 2024', ['Episode 12', '12 Jan 2024', 'What happens in 12'], {
        image: undefined,
      }),
      row(12, '13. Finale, Coming 1 Jan 2999', ['13. Finale', 'Coming 1 Jan 2999'], {
        image: undefined,
      }),
    ]);
    watched.clear();
    seen.clear();
  });

  it('with nothing remembered, starts with the episode to start at second from the top', () => {
    const list = drawn({
      focusKey: 'e',
      memoryKey: 'ep-start',
      videos: season(12),
      startIndex: 6,
      onPress: () => undefined,
    });
    // Anchored on episode 6 (index 5): two above it, five in view and two below.
    expect(list.map((item) => item.key)).toEqual([
      'e-3',
      'e-4',
      'e-5',
      'e-6',
      'e-7',
      'e-8',
      'e-9',
      'e-10',
      'e-11',
    ]);
  });

  it('starts at the top, and draws a short season whole', () => {
    watched.add('tt1:1:2');
    const list = drawn({
      focusKey: 'e',
      memoryKey: 'ep-short',
      videos: season(3),
      onPress: () => undefined,
    });
    expect(list.map((item) => [item.key, item.top, item.label, item.watched])).toEqual([
      ['e-0', '0', '1. Episode name 1, 1 Jan 2024', false],
      ['e-1', '168px', '2. Episode name 2, 2 Jan 2024, watched', true],
      ['e-2', '336px', '3. Episode name 3, 3 Jan 2024', false],
    ]);
    watched.clear();
  });
});
