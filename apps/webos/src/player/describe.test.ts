import { assessStream, describeStream, type StreamEntry } from '@bannertv/core';
import { parseStream } from '@bannertv/protocol';
import i18next from 'i18next';
import { beforeAll, describe, expect, it } from 'vitest';
import en from '../i18n/en.json';
import { problemText, streamRowText } from './describe';

const t = i18next.getFixedT('en');

beforeAll(async () => {
  await i18next.init({
    resources: { en: { translation: en } },
    lng: 'en',
    interpolation: { escapeValue: false },
  });
});

describe('problemText for a message from an addon', () => {
  const text = 'Streams temporarily unavailable - try again shortly';

  it("gives the addon's words, then what to do", () => {
    expect(
      problemText(t, { problem: { kind: 'addon-notice', addon: 'Sports Streams', text } }),
    ).toEqual({
      title: 'No stream could play',
      lines: [
        'Sports Streams says: “Streams temporarily unavailable - try again shortly”',
        "That's a message from the addon, not a video. Try again later, or check the addon's settings in Addons.",
      ],
    });
    expect(problemText(t, { problem: { kind: 'addon-notice', addon: '', text } }).lines[0]).toBe(
      'Your addon says: “Streams temporarily unavailable - try again shortly”',
    );
  });

  it("adds the addon's words after another reason", () => {
    expect(
      problemText(t, {
        problem: { kind: 'tried', tried: 1, last: 'network' },
        noticeToo: { addon: 'Sports Streams', text },
      }),
    ).toEqual({
      title: "This stream won't play",
      lines: [
        'The stream stopped loading. Its source may be busy or offline.',
        'Sports Streams also said: “Streams temporarily unavailable - try again shortly”',
      ],
    });
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

  it('says to switch a stream addon on, not to add one, when they are all off', () => {
    expect(problemText(t, { problem: { kind: 'stream-addons-off' } })).toEqual({
      title: 'No stream could play',
      lines: ['Your stream addons are all switched off. Switch one on in Addons, then try again.'],
    });
    expect(
      problemText(t, { problem: { kind: 'no-addon-for-title', someOff: true } }).lines,
    ).toEqual([
      'None of your addons finds streams for this kind of title.',
      "Some of your stream addons are switched off, so they weren't asked. You can switch them on in Addons.",
    ]);
    expect(
      problemText(t, { problem: { kind: 'no-addon-for-title', someOff: false } }).lines,
    ).toEqual(['None of your addons finds streams for this kind of title.']);
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

describe('streamRowText for a message from an addon', () => {
  it('shows the whole message, and says it is not a video', () => {
    const stream = parseStream({
      name: 'Please reinstall the addon',
      title:
        'We have updated our free addon to improve service quality.\nPlease visit sports.highfly.to/configure\nto get a new addon link.',
      url: 'https://sports.highfly.to/configure',
      behaviorHints: { notWebReady: true },
    })!;
    const facts = describeStream(stream);
    const entry: StreamEntry = {
      stream,
      addonId: 'community.sports.fly',
      addonRank: 0,
      rank: 0,
      facts,
      assessment: assessStream(stream, facts, {
        webOS: null,
        uhd: null,
        hdr10: null,
        dolbyVision: null,
        hevc: null,
        av1: null,
        dts: null,
        truehd: null,
      }),
    };
    expect(streamRowText(t, entry, { heavy: false })).toEqual({
      title:
        'Please reinstall the addon. We have updated our free addon to improve service quality. Please visit sports.highfly.to to get a new addon link.',
      badges: [],
      playable: false,
      note: 'A message from the addon, not a video.',
      notes: ['A message from the addon, not a video.'],
    });
  });
});
