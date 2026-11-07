import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { Menu, type MenuOption } from './Menu';

// The overlay draws into the page's body, which a server render has none of.
vi.mock('./Overlay', () => ({
  Overlay: ({ children }: { children: ReactNode }) => createElement('div', null, children),
}));

interface Drawn {
  key: string;
  label: string;
  top: string;
  /** The text inside, piece by piece, and how many of the pieces are spans. */
  text: string[];
  spans: number;
  selected: boolean;
}

/** Each drawn option: its focus key, spoken label, place and what it says. */
function drawn(options: readonly MenuOption[], selected?: string): Drawn[] {
  const html = renderToStaticMarkup(
    createElement(Menu, {
      focusKey: 'genre-menu',
      title: 'Genre',
      options,
      selected,
      returnFocusKey: 'discover-genre',
      onSelect: () => undefined,
      onClose: () => undefined,
    }),
  );
  return html
    .split('<div role="button"')
    .slice(1)
    .map((item) => {
      const inside = item.slice(item.indexOf('>') + 1, item.indexOf('</div>'));
      const className = /class="([^"]*)"/.exec(item.slice(0, item.indexOf('>')))?.[1] ?? '';
      return {
        key: /data-focus-key="([^"]*)"/.exec(item)?.[1] ?? '',
        label: /aria-label="([^"]*)"/.exec(item)?.[1] ?? '',
        top: /style="top:([^"]*)"/.exec(item)?.[1] ?? '',
        text: inside.split(/<[^>]*>/).filter(Boolean),
        spans: inside.split('<span').length - 1,
        selected: className.indexOf('selected') >= 0,
      };
    });
}

const years = (count: number): MenuOption[] =>
  Array.from({ length: count }, (_, index) => ({
    value: `${2025 - index}`,
    label: `${2025 - index}`,
  }));

const keys = (from: number, count: number) =>
  Array.from({ length: count }, (_, n) => `genre-menu-${from + n}`);

describe('a menu', () => {
  it('draws every option of a short list, with details after the label', () => {
    const list = drawn(
      [
        { value: 'en', label: 'English' },
        { value: 'es', label: 'Spanish', detail: 'Spanish audio' },
        { value: 'fr', label: 'French' },
      ],
      'es',
    );
    const option = (index: number, label: string, text: string[], spans = 0) => ({
      key: `genre-menu-${index}`,
      label,
      top: index === 0 ? '0' : `${index * 88}px`,
      text,
      spans,
      selected: index === 1,
    });
    expect(list).toEqual([
      option(0, 'English', ['English']),
      option(1, 'Spanish, Spanish audio', ['Spanish', 'Spanish audio'], 2),
      option(2, 'French', ['French']),
    ]);
  });

  it('draws the options around the chosen one in a long list', () => {
    // The 40th chosen: it sits three from the top, with two more drawn either side.
    const list = drawn(years(120), '1986');
    expect(list.map((item) => item.key)).toEqual(keys(34, 13));
    expect(list[0]).toEqual({
      key: 'genre-menu-34',
      label: '1991',
      top: `${34 * 88}px`,
      text: ['1991'],
      spans: 0,
      selected: false,
    });
    expect(list.filter((item) => item.selected).map((item) => item.key)).toEqual(['genre-menu-39']);
    expect(list[12]!.top).toBe(`${46 * 88}px`);
  });

  it('goes no further than the end of the list', () => {
    const list = drawn(years(20), '2006');
    expect(list.map((item) => item.key)).toEqual(keys(9, 11));
  });

  it('starts at the top without a chosen option', () => {
    const list = drawn(years(30));
    expect(list.map((item) => item.key)).toEqual(keys(0, 11));
    expect(list.some((item) => item.selected)).toBe(false);
  });
});
