import { createStore } from '@bannertv/core';
import { describe, expect, it } from 'vitest';
import {
  ALERTS_ON_KEY,
  type AlertStorage,
  alertSwitchStore,
  MAX_SENT,
  readAlertProfiles,
  readSent,
  recordSent,
  SENT_KEEP_MS,
  type SentAlert,
  sentVideos,
} from './episode-alerts-store';

const DAY = 24 * 60 * 60 * 1000;

function memory(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial));
  const storage: AlertStorage = {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => {
      items.set(key, value);
    },
  };
  return { items, storage };
}

describe('readAlertProfiles', () => {
  it('reads the profiles with alerts on, once each, and nothing from damaged data', () => {
    expect(readAlertProfiles('["main","guest4","main"]')).toEqual(['main', 'guest4']);
    expect(readAlertProfiles('["main", 3, ""]')).toEqual(['main']);
    expect(readAlertProfiles('{"main":true}')).toEqual([]);
    expect(readAlertProfiles('not json')).toEqual([]);
    expect(readAlertProfiles(null)).toEqual([]);
  });
});

describe('alertSwitchStore', () => {
  it('is off for every profile until switched on, and on for that profile only', () => {
    const { items, storage } = memory();
    const profile = createStore<string | null>('main');
    const on = alertSwitchStore(storage, profile);
    expect(on.get()).toBe(false);
    on.set(true);
    expect(on.get()).toBe(true);
    expect(items.get(ALERTS_ON_KEY)).toBe('["main"]');
    // Another profile, after a switch started the app again, has its own.
    const guest = alertSwitchStore(storage, createStore<string | null>('guest4'));
    expect(guest.get()).toBe(false);
    expect(alertSwitchStore(storage, profile).get()).toBe(true);
  });

  it('switches off for the profile in use only', () => {
    const { items, storage } = memory({ [ALERTS_ON_KEY]: '["main","guest4"]' });
    const on = alertSwitchStore(storage, createStore<string | null>('guest4'));
    expect(on.get()).toBe(true);
    on.set(false);
    expect(on.get()).toBe(false);
    expect(items.get(ALERTS_ON_KEY)).toBe('["main"]');
  });

  it('does nothing before someone is chosen, then reads their switch and tells', () => {
    const { items, storage } = memory({ [ALERTS_ON_KEY]: '["guest4"]' });
    const profile = createStore<string | null>(null);
    const on = alertSwitchStore(storage, profile);
    on.set(true);
    expect(on.get()).toBe(false);
    expect(items.get(ALERTS_ON_KEY)).toBe('["guest4"]');
    let told = 0;
    const stop = on.subscribe(() => {
      told += 1;
    });
    profile.set('guest4');
    expect(told).toBe(1);
    expect(on.get()).toBe(true);
    on.set(false);
    expect(told).toBe(2);
    stop();
    profile.set('main');
    expect(told).toBe(2);
  });

  it('drops deleted profiles when it next saves', () => {
    const { items, storage } = memory({ [ALERTS_ON_KEY]: '["gone1","guest4"]' });
    const on = alertSwitchStore(storage, createStore<string | null>('main'), () => [
      'main',
      'guest4',
    ]);
    on.set(true);
    expect(items.get(ALERTS_ON_KEY)).toBe('["guest4","main"]');
  });

  it('keeps the choice for the run when the storage fails', () => {
    const storage: AlertStorage = {
      getItem: () => {
        throw new Error('no storage');
      },
      setItem: () => {
        throw new Error('no storage');
      },
    };
    const on = alertSwitchStore(storage, createStore<string | null>('main'));
    expect(on.get()).toBe(false);
    on.set(true);
    expect(on.get()).toBe(true);
  });
});

describe('the alerts sent', () => {
  const now = Date.parse('2026-11-09T12:00:00.000Z');
  const came: SentAlert = { key: 'series:tt1@2026-11-08', at: now - DAY, videos: ['tt1:1:1'] };
  const toCome: SentAlert = {
    key: 'series:tt1@2026-11-15',
    at: now + 6 * DAY,
    videos: ['tt1:1:2'],
  };

  it('reads what was kept, entry by entry', () => {
    const raw = JSON.stringify([came, { key: 3 }, { key: 'k', at: 'soon', videos: [] }, toCome]);
    expect(readSent(raw)).toEqual([came, toCome]);
    expect(readSent('nope')).toEqual([]);
    expect(readSent(null)).toEqual([]);
  });

  it('counts as sent only the episodes of alerts whose time has come', () => {
    expect(sentVideos([came, toCome], now)).toEqual(new Set(['tt1:1:1']));
  });

  it('remembers the alerts that came, and forgets one to come that was cancelled', () => {
    expect(recordSent([came, toCome], [], now)).toEqual([came]);
    const next: SentAlert = { key: 'series:tt2@2026-11-10', at: now + DAY, videos: ['tt2:1:1'] };
    expect(recordSent([came, toCome], [toCome, next], now)).toEqual([came, next, toCome]);
  });

  it('keeps one alert just due once, though the pass kept it scheduled', () => {
    const due: SentAlert = { key: 'series:tt3@2026-11-09', at: now - 1000, videos: ['tt3:1:1'] };
    expect(recordSent([due], [due], now)).toEqual([due]);
  });

  it('forgets alerts older than SENT_KEEP_MS, and keeps the latest MAX_SENT', () => {
    const old: SentAlert = { key: 'old', at: now - SENT_KEEP_MS, videos: ['x'] };
    expect(recordSent([old, came], [], now)).toEqual([came]);
    const many = Array.from({ length: MAX_SENT + 10 }, (_, index) => ({
      key: `k${index}`,
      at: now - (MAX_SENT + 10 - index) * 1000,
      videos: [`v${index}`],
    }));
    const kept = recordSent(many, [], now);
    expect(kept).toHaveLength(MAX_SENT);
    expect(kept[0]!.key).toBe('k10');
  });
});
