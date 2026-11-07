import { assessStream, describeStream, otherLanguages, type StreamEntry } from '@bannertv/core';
import { parseStream } from '@bannertv/protocol';
import i18next from 'i18next';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { initI18n } from '../../i18n';
import { knownCapabilities } from '../../platform/capabilities';
import { streamRowText } from '../../player/describe';
import { StreamRow } from './StreamRow';

beforeAll(() => {
  initI18n();
  // Pressable keeps its DOM work in layout effects, which a server render skips.
  const error = console.error.bind(console);
  vi.spyOn(console, 'error').mockImplementation((message: unknown, ...rest: unknown[]) => {
    if (String(message).indexOf('useLayoutEffect does nothing on the server') < 0) {
      error(message, ...rest);
    }
  });
});

function stream(description: string, source: { url: string } | { infoHash: string }): StreamEntry {
  const parsed = parseStream({ ...source, name: 'Torrentio', description })!;
  const facts = describeStream(parsed);
  return {
    stream: parsed,
    addonId: 'torrentio',
    addonRank: 0,
    rank: 0,
    facts,
    assessment: assessStream(parsed, facts, knownCapabilities()),
  };
}

function row(entry: StreamEntry, options: { index?: number; heavy?: boolean; tested?: boolean }) {
  return renderToStaticMarkup(
    createElement(StreamRow, {
      t: i18next.t,
      index: options.index ?? 0,
      entry,
      addon: 'Torrentio',
      heavy: options.heavy ?? false,
      tested: options.tested ?? false,
      onRowFocus: () => undefined,
      onRowPress: () => undefined,
    }),
  );
}

const unescape = (text: string) =>
  text
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'");

describe('a row in All streams', () => {
  it('reads out the addon, the title, the badges and every note, and shows them', () => {
    const entry = stream('Film.2024.2160p.WEB-DL.DDP5.1.HDR.H265 [Spanish]', {
      url: 'https://media.example.com/film.2160p.mkv',
    });
    const text = streamRowText(i18next.t, entry, {
      heavy: true,
      languages: otherLanguages(entry.facts),
    });
    const html = row(entry, { index: 3, heavy: true });
    const label = unescape(/aria-label="([^"]*)"/.exec(html)![1]!);
    expect(label).toBe(
      ['Torrentio', text.title, text.badges.join(', '), ...text.notes].filter(Boolean).join('. '),
    );
    expect(html).toContain('data-focus-key="streams-item-3"');
    expect(html).toContain('style="top:504px"');
    expect(html).toContain('>Torrentio</div>');
    for (const badge of text.badges) expect(html).toContain(`>${badge}</span>`);
    expect(text.badges.length).toBeGreaterThan(0);
    expect(text.note).toBeDefined();
    expect(unescape(html)).toContain(`>${text.note}</p>`);
  });

  it('says a test play worked', () => {
    const entry = stream('Film 1080p', { url: 'https://media.example.com/film.1080p.mp4' });
    expect(row(entry, { tested: true })).toContain(`>${i18next.t('streams.tested')}</span>`);
    expect(row(entry, {})).not.toContain(`>${i18next.t('streams.tested')}</span>`);
    expect(row(entry, {})).toContain('style="top:0"');
  });

  it('dims a stream this TV cannot play and says why', () => {
    const entry = stream('Film.2024.1080p.WEB-DL', {
      infoHash: 'abcdef0123456789abcdef0123456789abcdef01',
    });
    const text = streamRowText(i18next.t, entry, { heavy: false });
    expect(text.playable).toBe(false);
    const html = row(entry, {});
    const className = /class="([^"]*)"/.exec(html)![1]!;
    expect(className.split(' ')).toHaveLength(2);
    expect(unescape(html)).toContain(`>${text.note}</p>`);
  });
});
