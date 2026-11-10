import { parseStream } from '@bannertv/protocol';
import { describe, expect, it } from 'vitest';
import { assessStream } from './assess';
import { explainProblem, type PlayAttempt, type ProblemInput } from './explain';
import { describeStream } from './facts';
import type { StreamEntry, TvCapabilities } from './types';

const LG: TvCapabilities = {
  webOS: 22,
  uhd: true,
  hdr10: true,
  dolbyVision: false,
  hevc: true,
  av1: true,
  dts: false,
  truehd: false,
};

const TORRENTIO = { manifest: { name: 'Torrentio' } };
const OTHER = { manifest: { name: 'Other streams' } };

function entry(raw: Record<string, unknown>, addonRank = 0, rank = 0): StreamEntry {
  const stream = parseStream(raw)!;
  const facts = describeStream(stream);
  return {
    stream,
    addonId: `addon-${addonRank}`,
    addonRank,
    rank,
    facts,
    assessment: assessStream(stream, facts, LG),
  };
}

const torrent = (addonRank = 0, rank = 0) =>
  entry(
    { name: 'Torrentio\n1080p', title: 'Film.1080p.WEB-DL', infoHash: 'a'.repeat(40) },
    addonRank,
    rank,
  );
const link = (title: string, rank = 0) =>
  entry({ name: 'Addon\n1080p', title, url: `https://cdn.example.org/${rank}.mkv` }, 0, rank);
const headerLink = (rank = 0) =>
  entry(
    {
      name: 'Sport\n720p',
      title: 'Match',
      url: `https://live.example.org/${rank}.m3u8`,
      behaviorHints: { proxyHeaders: { request: { Referer: 'https://site.example/' } } },
    },
    0,
    rank,
  );
const youtube = () => entry({ name: 'Trailer', ytId: 'abcdefghijk' });
const SPORTS = { manifest: { name: 'Sports Streams' } };
const notice = (addonRank = 0) =>
  entry(
    {
      name: 'Sports Streams',
      description: 'Streams temporarily unavailable - try again shortly',
      url: 'https://premium.example.org/KEY-123/unavailable',
    },
    addonRank,
  );

function input(overrides: Partial<ProblemInput>): ProblemInput {
  return {
    nothing: true,
    asked: [TORRENTIO],
    failedAddons: 0,
    entries: [],
    candidates: [],
    attempts: [],
    streamAddons: { on: true, off: false },
    ...overrides,
  };
}

function attempt(e: StreamEntry, kind = 'network', detail?: string): PlayAttempt {
  return { key: `${e.addonRank}:${e.addonId}#${e.rank}`, entry: e, kind, detail };
}

describe('explainProblem, when nothing could start', () => {
  it('says no stream addon is installed, or none finds this title', () => {
    const none = { on: false, off: false };
    expect(explainProblem(input({ asked: [], streamAddons: none })).problem).toEqual({
      kind: 'no-stream-addon',
    });
    expect(explainProblem(input({ asked: [] })).problem).toEqual({
      kind: 'no-addon-for-title',
      someOff: false,
    });
  });

  it('says the stream addons are switched off, rather than missing', () => {
    // Torrentio installed but switched off: the addon client asks no one.
    const off = { on: false, off: true };
    expect(explainProblem(input({ asked: [], streamAddons: off })).problem).toEqual({
      kind: 'stream-addons-off',
    });
    // One switched on finds nothing for this title, another is switched off.
    expect(
      explainProblem(input({ asked: [], streamAddons: { on: true, off: true } })).problem,
    ).toEqual({ kind: 'no-addon-for-title', someOff: true });
    // Once an addon was asked, the switches no longer explain anything.
    expect(explainProblem(input({ streamAddons: { on: true, off: true } })).problem).toEqual({
      kind: 'no-streams',
    });
  });

  it('tells addons that all failed from addons that sent nothing', () => {
    expect(explainProblem(input({ asked: [TORRENTIO, OTHER], failedAddons: 2 })).problem).toEqual({
      kind: 'addons-down',
      count: 2,
    });
    expect(explainProblem(input({ asked: [TORRENTIO, OTHER], failedAddons: 1 })).problem).toEqual({
      kind: 'no-streams',
    });
    expect(explainProblem(input({})).problem).toEqual({ kind: 'no-streams' });
  });

  it('names the addon that sent the torrents, and counts its own', () => {
    const entries = [torrent(0, 0), torrent(0, 1), torrent(0, 2), torrent(1, 0)];
    expect(explainProblem(input({ asked: [TORRENTIO, OTHER], entries })).problem).toEqual({
      kind: 'torrents',
      addon: 'Torrentio',
      count: 3,
    });
  });

  it('says header streams need the stream helper when they outnumber the rest', () => {
    const entries = [headerLink(0), headerLink(1), torrent(0, 2)];
    expect(explainProblem(input({ entries })).problem).toEqual({ kind: 'needs-helper', count: 2 });
  });

  it('says only browser or YouTube links came', () => {
    expect(explainProblem(input({ entries: [youtube()] })).problem).toEqual({
      kind: 'web-only',
      count: 1,
    });
  });

  it('says streams that play all failed a moment ago', () => {
    const entries = [link('Film.1080p.WEB-DL'), link('Film.720p.WEB-DL', 1)];
    expect(explainProblem(input({ entries })).problem).toEqual({
      kind: 'failed-recently',
      count: 2,
    });
  });
});

describe('explainProblem, after streams were tried', () => {
  const first = link('Film.1080p.WEB-DL', 0);
  const second = link('Film.720p.WEB-DL', 1);

  it('counts each stream tried once, and gives the last error', () => {
    const attempts = [
      attempt(first, 'network'),
      attempt(first, 'network'),
      attempt(second, 'format'),
    ];
    expect(explainProblem(input({ nothing: false, entries: [first, second], attempts }))).toEqual({
      problem: { kind: 'tried', tried: 2, last: 'format' },
    });
  });

  it('says the stream helper is not on when any stream needed it', () => {
    const attempts = [attempt(first), attempt(second, 'network', 'stream-helper-unreachable')];
    expect(explainProblem(input({ nothing: false, attempts })).problem).toEqual({
      kind: 'helper-off',
      tried: 2,
    });
  });

  it('says only uncached links were tried', () => {
    const uncached = (title: string, rank: number) =>
      entry(
        { name: '[RD download] Torrentio\n1080p', title, url: `https://cdn.example.org/${rank}` },
        0,
        rank,
      );
    const a = uncached('Film.1080p.WEB-DL', 0);
    const b = uncached('Film.720p.WEB-DL', 1);
    expect(a.facts.cached).toBe(false);
    const attempts = [attempt(a, 'clip'), attempt(b, 'network')];
    expect(explainProblem(input({ nothing: false, attempts })).problem).toEqual({
      kind: 'uncached',
      tried: 2,
    });
  });

  it('adds the torrents that a debrid service would play', () => {
    const entries = [first, torrent(0, 1), torrent(0, 2)];
    expect(
      explainProblem(input({ nothing: false, entries, attempts: [attempt(first)] })).torrentsToo,
    ).toEqual({ addon: 'Torrentio', count: 2 });
  });
});

describe('explainProblem, when an addon sent a message instead of a stream', () => {
  it('says what the addon said when that is all it sent', () => {
    expect(explainProblem(input({ asked: [SPORTS], entries: [notice()] }))).toEqual({
      problem: {
        kind: 'addon-notice',
        addon: 'Sports Streams',
        text: 'Streams temporarily unavailable - try again shortly',
      },
    });
    // Without a name, the words alone.
    expect(
      explainProblem(input({ asked: [{ manifest: { name: ' ' } }], entries: [notice()] })).problem,
    ).toEqual({
      kind: 'addon-notice',
      addon: '',
      text: 'Streams temporarily unavailable - try again shortly',
    });
  });

  it('never shows the link, which can carry the viewer’s key', () => {
    const explained = explainProblem(input({ asked: [SPORTS], entries: [notice()] }));
    expect(JSON.stringify(explained)).not.toContain('KEY-123');
  });

  it("adds the addon's words to another reason", () => {
    const tried = link('Film.1080p.mkv');
    expect(
      explainProblem(
        input({
          nothing: false,
          asked: [TORRENTIO, SPORTS],
          entries: [tried, notice(1)],
          attempts: [attempt(tried, 'network')],
        }),
      ),
    ).toEqual({
      problem: { kind: 'tried', tried: 1, last: 'network' },
      noticeToo: {
        addon: 'Sports Streams',
        text: 'Streams temporarily unavailable - try again shortly',
      },
    });
    // Torrents beside it still say to set up debrid, then what the other addon said.
    expect(
      explainProblem(input({ asked: [TORRENTIO, SPORTS], entries: [torrent(), notice(1)] })),
    ).toEqual({
      problem: { kind: 'torrents', addon: 'Torrentio', count: 1 },
      noticeToo: {
        addon: 'Sports Streams',
        text: 'Streams temporarily unavailable - try again shortly',
      },
    });
  });

  it('counts a message with no words as a web link', () => {
    const page = entry({ url: 'https://addon.example/abc/configure' });
    expect(page.assessment.action).toEqual({ kind: 'unavailable', reason: 'notice' });
    expect(explainProblem(input({ asked: [SPORTS], entries: [page] }))).toEqual({
      problem: { kind: 'web-only', count: 1 },
    });
  });
});
