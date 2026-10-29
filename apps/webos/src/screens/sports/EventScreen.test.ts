import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { TeamBadges } from './EventScreen';

vi.mock('../../data/addons', () => ({
  addonCollection: { get: () => ({ ready: true, addons: [] }), subscribe: () => () => undefined },
  addonClient: {},
}));

const ARSENAL = 'https://img.example.com/arsenal.png';
const BRIGHTON = 'https://img.example.com/brighton.png';

/** Each side's place, home first: the image it draws, or an empty string when it is left blank. */
function badges(event: { homeLogo?: string; awayLogo?: string }): string[] {
  const html = renderToStaticMarkup(createElement(TeamBadges, { event }));
  const slots: string[] = [];
  const slot = /<div[^>]*>(?:<img[^>]* src="([^"]*)"[^>]*>)?<\/div>/g;
  for (let found = slot.exec(html); found; found = slot.exec(html)) slots.push(found[1] ?? '');
  return slots;
}

describe('team badges on the event page', () => {
  it('draws the badges the addon sent, home first as in the name', () => {
    expect(badges({ homeLogo: ARSENAL, awayLogo: BRIGHTON })).toEqual([ARSENAL, BRIGHTON]);
  });

  it('keeps a badge on its own beside its team', () => {
    expect(badges({ awayLogo: BRIGHTON })).toEqual(['', BRIGHTON]);
    expect(badges({ homeLogo: ARSENAL })).toEqual([ARSENAL, '']);
  });

  it('draws nothing when the addon sent none', () => {
    expect(renderToStaticMarkup(createElement(TeamBadges, { event: {} }))).toBe('');
  });
});
