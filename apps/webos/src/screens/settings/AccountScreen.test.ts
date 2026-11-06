import type { PauseReason } from '@bannertv/core';
import i18next from 'i18next';
import { beforeAll, describe, expect, it } from 'vitest';
import { asideDate, asideLines, asideRestarts } from '../../data/account-aside';
import en from '../../i18n/en.json';
import { statusLine } from './AccountScreen';

/** Every reason the engine can pause for: a new one fails the typecheck here until it is added. */
const REASONS: Record<PauseReason, true> = {
  offline: true,
  limit: true,
  'too-big': true,
  full: true,
  update: true,
  busy: true,
};

const t = i18next.getFixedT('en');

beforeAll(async () => {
  await i18next.init({
    resources: { en: { translation: en } },
    lng: 'en',
    interpolation: { escapeValue: false },
  });
});

describe('statusLine', () => {
  it('says what each pause means, in words', () => {
    for (const reason of Object.keys(REASONS) as PauseReason[]) {
      const line = statusLine(t, { state: 'paused', reason }, 0);
      expect(line, reason).toMatch(/^Paused: /);
    }
  });

  it('says a full account keeps some changes back, and that the rest still syncs', () => {
    expect(statusLine(t, { state: 'paused', reason: 'full' }, 0)).toBe(
      "Paused: the account is full, so some of this screen's changes aren't saved in it. Everything else still syncs.",
    );
  });

  it('counts the time since the last sync', () => {
    const now = 10 * 60 * 60 * 1000;
    expect(statusLine(t, { state: 'idle', lastSync: now - 30 * 1000 }, now)).toBe(
      'In sync just now',
    );
    expect(statusLine(t, { state: 'idle', lastSync: now - 2 * 60 * 1000 }, now)).toBe(
      'In sync 2 minutes ago',
    );
    expect(statusLine(t, { state: 'idle', lastSync: now - 3 * 60 * 60 * 1000 }, now)).toBe(
      'In sync 3 hours ago',
    );
  });
});

describe('the copy Use kept', () => {
  const copy = {
    profiles: [{ id: 'main' }, { id: 'guest4', name: 'Guest' }],
    list: 1,
    watching: 3,
    addons: ['Cinemeta', 'Torrentio'],
    until: Date.UTC(2026, 11, 6, 12),
  };

  it('says what it holds, a line each, leaving out what it has none of', () => {
    expect(asideLines(t, copy)).toEqual([
      'Profiles: Main, Guest',
      '1 title on My List',
      '3 films and episodes part way through',
      'Addons: Cinemeta, Torrentio',
    ]);
    expect(asideLines(t, { ...copy, profiles: [{ id: 'main' }], list: 0, addons: [] })).toEqual([
      'Profile: Main',
      '3 films and episodes part way through',
    ]);
    expect(asideDate(copy.until)).toBe('6 December 2026');
  });

  it('starts the app again only when a profile would come back on the list', () => {
    expect(asideRestarts(copy, [{ id: 'main' }])).toBe(true);
    expect(asideRestarts(copy, [{ id: 'main' }, { id: 'guest4' }])).toBe(false);
  });
});
