import { describe, expect, it } from 'vitest';
import { asideProfileIds, describeAside } from './aside';
import type { SyncAside } from './local';

const COPY: SyncAside = {
  v: 1,
  at: 1000,
  until: 2000,
  documents: {
    profiles: [
      ['main', { v: 1, t: 0 }],
      ['main/name', { v: 'Eyi' }],
      ['kid001', { v: 1 }],
      ['kid001/name', { v: 'Ada' }],
      // A profile that came without a name never shows, as on the profiles list.
      ['nameless', { v: 1 }],
      ['NOT-AN-ID', { v: 1 }],
    ],
    'p/main/list': [
      ['tt1', { v: { type: 'movie' }, t: 5 }],
      ['tt2', { v: { type: 'movie' }, t: 6, trakt: true }],
    ],
    'p/kid001/list': [['tt3', { v: { type: 'series' }, t: 7 }]],
    'p/main/watch': [
      ['tt4', { v: { metaId: 'tt4', watched: false }, t: 8 }],
      ['tt5', { v: { metaId: 'tt5', watched: true }, t: 9 }],
      ['tt6', { v: { metaId: 'tt6', watched: false, continueRow: false }, t: 10 }],
      ['tt7', { v: { metaId: 'tt7', watched: false }, t: 11, trakt: true }],
    ],
    addons: [
      ['a/one', { v: { u: 'https://one.example/key/manifest.json', m: { name: ' Cinemeta ' } } }],
      ['a/two', { v: { u: 'https://two.example/manifest.json', m: {} } }],
      ['order', { v: ['one', 'two'] }],
    ],
  },
};

describe('describeAside', () => {
  it("says the copy's profiles, titles, videos part way and addons, and when it runs out", () => {
    expect(describeAside(COPY)).toEqual({
      profiles: [
        { id: 'main', name: 'Eyi' },
        { id: 'kid001', name: 'Ada' },
      ],
      list: 2,
      watching: 1,
      addons: ['Cinemeta'],
      until: 2000,
    });
  });

  it('names no addon by its address, and leaves Main nameless when the copy has no name for it', () => {
    const described = describeAside({ ...COPY, documents: { addons: COPY.documents.addons! } });
    expect(described.profiles).toEqual([{ id: 'main' }]);
    expect(JSON.stringify(described)).not.toContain('example');
  });
});

describe('asideProfileIds', () => {
  it('lists Main first and every profile that can name documents', () => {
    expect(asideProfileIds(COPY)).toEqual(['main', 'kid001', 'nameless']);
    expect(asideProfileIds({ ...COPY, documents: {} })).toEqual(['main']);
  });
});
