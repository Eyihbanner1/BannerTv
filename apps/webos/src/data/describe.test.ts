import type { InstalledAddon } from '@bannertv/core';
import { parseManifest } from '@bannertv/protocol';
import i18next from 'i18next';
import { beforeAll, describe, expect, it } from 'vitest';
import en from '../i18n/en.json';
import { addonsDidntAnswer, healthLine } from './describe';

const t = i18next.getFixedT('en');

beforeAll(async () => {
  await i18next.init({
    resources: { en: { translation: en } },
    lng: 'en',
    interpolation: { escapeValue: false },
  });
});

function addon(name: string): InstalledAddon {
  return {
    transportUrl: `https://${name.toLowerCase()}.example/manifest.json`,
    manifest: parseManifest({
      id: `org.${name.toLowerCase()}`,
      version: '1.0.0',
      name,
      types: ['movie'],
      resources: ['stream'],
    }),
    official: false,
    fetchedAt: 0,
  };
}

describe('healthLine', () => {
  const at = (hours: number, minutes: number, day = 6) =>
    new Date(2026, 10, day, hours, minutes).getTime();

  it('says nothing of an addon that answers in good time or was never asked', () => {
    expect(healthLine(t, undefined)).toBeUndefined();
    expect(healthLine(t, { state: 'fine', since: at(14, 5) })).toBeUndefined();
  });

  it('says since when an addon has not answered, with the day once it is not today', () => {
    const failed = { state: 'failed' as const, since: at(14, 5) };
    expect(healthLine(t, failed, at(18, 30))).toBe('Not answering since 14:05');
    expect(healthLine(t, failed, at(9, 0, 7))).toBe('Not answering since 6 Nov, 14:05');
    expect(healthLine(t, { state: 'slow', since: at(14, 5) }, at(18, 30))).toBe('Slow to answer');
  });
});

describe('addonsDidntAnswer', () => {
  it('names the first addon that did not answer and counts the rest', () => {
    expect(addonsDidntAnswer(t, [])).toBeUndefined();
    expect(addonsDidntAnswer(t, [addon('Torrentio')])).toBe("Torrentio didn't answer.");
    expect(addonsDidntAnswer(t, [addon('Torrentio'), addon('Comet')])).toBe(
      "Torrentio and 1 more didn't answer.",
    );
    expect(addonsDidntAnswer(t, [addon('Torrentio'), addon('Comet'), addon('Orion')])).toBe(
      "Torrentio and 2 more didn't answer.",
    );
  });
});
