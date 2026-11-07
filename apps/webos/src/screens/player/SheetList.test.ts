import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { type SheetRow, SheetList } from './SheetList';

beforeAll(() => {
  // Pressable keeps its DOM work in layout effects, which a server render skips.
  const error = console.error.bind(console);
  vi.spyOn(console, 'error').mockImplementation((message: unknown, ...rest: unknown[]) => {
    if (String(message).indexOf('useLayoutEffect does nothing on the server') < 0) {
      error(message, ...rest);
    }
  });
});

interface Drawn {
  key: string;
  label: string;
  style: string;
  /** Which of selected, dim and tall the row is marked. */
  marks: string[];
  inside: string;
}

/** Each drawn row: its focus key, spoken label, place, marks and what it holds. */
function drawn(props: Parameters<typeof SheetList>[0]): Drawn[] {
  const html = renderToStaticMarkup(createElement(SheetList, props));
  const rows = html.split('<div role="button"').slice(1);
  return rows.map((row, index) => {
    const end = index === rows.length - 1 ? row.lastIndexOf('</div></div></div>') : row.length;
    const open = row.slice(0, row.indexOf('>'));
    const className = /class="([^"]*)"/.exec(open)?.[1] ?? '';
    return {
      key: /data-focus-key="([^"]*)"/.exec(open)?.[1] ?? '',
      label: /aria-label="([^"]*)"/.exec(open)?.[1] ?? '',
      style: /style="([^"]*)"/.exec(open)?.[1] ?? '',
      marks: ['selected', 'dim', 'tall'].filter((mark) => className.indexOf(mark) >= 0),
      inside: row
        .slice(row.indexOf('>') + 1, end)
        .replace(/ class="[^"]*"/g, '')
        .replace(/<\/div>$/, ''),
    };
  });
}

function rows(count: number): SheetRow[] {
  return Array.from({ length: count }, (_, index) => ({
    focusKey: `sheet-ep-${index}`,
    label: `Episode ${index + 1}`,
    detail: index % 3 === 0 ? `${index} min left` : undefined,
    selected: index === 4,
    dim: index === 9,
    progress: index === 2 ? 0.426 : undefined,
    onPress: () => undefined,
  }));
}

describe('a sheet list', () => {
  it('draws the rows near the view around the preferred one', () => {
    const list = drawn({
      focusKey: 'sheet-list',
      rows: rows(20),
      preferred: 'sheet-ep-8',
      remember: true,
      visible: 6,
    });
    // The preferred row sits one from the top: rows 7 to 12 in view, two more either side.
    expect(list.map((row) => row.key)).toEqual(
      [5, 6, 7, 8, 9, 10, 11, 12, 13, 14].map((index) => `sheet-ep-${index}`),
    );
    expect(list[0]).toEqual({
      key: 'sheet-ep-5',
      label: 'Episode 6',
      style: `top:${5 * 88}px`,
      marks: [],
      inside: '<span>Episode 6</span>',
    });
    expect(list[1]).toMatchObject({ key: 'sheet-ep-6', label: 'Episode 7, 6 min left' });
    expect(list[1]!.inside).toBe('<span>Episode 7</span><span>6 min left</span>');
    expect(list[4]!.marks).toEqual(['dim']);
  });

  it('marks, dims, fills and draws its own body, and keeps the preferred row drawn', () => {
    const list = drawn({
      focusKey: 'sheet-list',
      rows: [
        ...rows(12),
        {
          focusKey: 'sheet-version',
          label: 'Version',
          spoken: 'Version two, 4K',
          body: createElement('em', null, 'Two lines'),
          onPress: () => undefined,
        },
      ],
      preferred: 'sheet-version',
      remember: false,
      visible: 4,
      rowHeight: 120,
    });
    expect(list.map((row) => row.key)).toEqual(
      [7, 8, 9, 10, 11, 12].map((index) => (index === 12 ? 'sheet-version' : `sheet-ep-${index}`)),
    );
    expect(list[5]).toEqual({
      key: 'sheet-version',
      label: 'Version two, 4K',
      style: `top:${12 * 120}px;height:108px`,
      marks: ['tall'],
      inside: '<em>Two lines</em>',
    });
    expect(list[2]!.marks).toEqual(['dim']);

    const top = drawn({
      focusKey: 'sheet-list',
      rows: rows(12),
      preferred: 'sheet-ep-0',
      remember: true,
      visible: 6,
    });
    expect(top.map((row) => row.key)).toEqual(
      [0, 1, 2, 3, 4, 5, 6, 7].map((index) => `sheet-ep-${index}`),
    );
    expect(top[2]!.inside).toBe(
      '<span>Episode 3</span><span><span style="width:43%"></span></span>',
    );
    expect(top[4]!.marks).toEqual(['selected']);
    // Far from the view, the preferred row is still drawn, last.
    const far = drawn({
      focusKey: 'sheet-list',
      rows: rows(30),
      preferred: 'sheet-ep-25',
      remember: true,
      visible: 3,
    });
    expect(far.map((row) => row.key)).toEqual(
      [22, 23, 24, 25, 26, 27, 28].map((index) => `sheet-ep-${index}`),
    );
  });
});
