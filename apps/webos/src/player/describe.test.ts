import i18next from 'i18next';
import { beforeAll, describe, expect, it } from 'vitest';
import en from '../i18n/en.json';
import { problemText } from './describe';

const t = i18next.getFixedT('en');

beforeAll(async () => {
  await i18next.init({
    resources: { en: { translation: en } },
    lng: 'en',
    interpolation: { escapeValue: false },
  });
});

describe('problemText', () => {
  it('says what to set up when nothing could start', () => {
    expect(problemText(t, { problem: { kind: 'no-stream-addon' } })).toEqual({
      title: 'No stream could play',
      lines: ['You have no addon that finds streams yet. Add one in Addons.'],
    });
    expect(
      problemText(t, { problem: { kind: 'torrents', addon: 'Torrentio', count: 40 } }).lines,
    ).toEqual([
      "Torrentio sent 40 torrents, and BannerTV can't play torrents by itself. Set up a debrid service in the addon's settings, then try again.",
    ]);
    expect(problemText(t, { problem: { kind: 'torrents', addon: '', count: 1 } }).lines[0]).toBe(
      "Your addons sent 1 torrent, and BannerTV can't play torrents by itself. Set up a debrid service in the addon's settings, then try again.",
    );
  });

  it('keeps the old words for one stream that would not play', () => {
    expect(problemText(t, { problem: { kind: 'tried', tried: 1, last: 'format' } })).toEqual({
      title: "This stream won't play",
      lines: ["This TV can't play this stream's format."],
    });
  });

  it('says how many were tried before why the last one stopped', () => {
    expect(problemText(t, { problem: { kind: 'tried', tried: 4, last: 'network' } })).toEqual({
      title: 'No stream could play',
      lines: [
        'Tried 4 streams, and none of them played.',
        'The stream stopped loading. Its source may be busy or offline.',
      ],
    });
  });

  it("says the stream helper isn't on, and adds the torrents a debrid service would play", () => {
    expect(
      problemText(t, {
        problem: { kind: 'helper-off', tried: 1 },
        torrentsToo: { addon: 'Torrentio', count: 3 },
      }),
    ).toEqual({
      title: "This stream won't play",
      lines: [
        "Your stream helper isn't on. Open BannerTV on the Android phone or box, turn the helper on, and keep it on the same Wi-Fi.",
        'Torrentio also sent 3 torrents, which play once a debrid service is set up in its settings.',
      ],
    });
  });
});
