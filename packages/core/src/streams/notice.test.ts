import { parseStream } from '@bannertv/protocol';
import { describe, expect, it } from 'vitest';
import { describeStream } from './facts';
import { isNoticeStream, NOTICE_MAX, noticeText } from './notice';

function notice(raw: Record<string, unknown>): boolean {
  const stream = parseStream(raw)!;
  return isNoticeStream(stream, describeStream(stream));
}

function text(raw: Record<string, unknown>): string {
  return noticeText(parseStream(raw)!);
}

/** What the free Sports Streams link answers for every item since November 2026. */
const REINSTALL = {
  name: 'Please reinstall the addon',
  title:
    'We have updated our free addon to improve service quality.\nPlease visit sports.highfly.to/configure\nto get a new addon link.',
  url: 'https://sports.highfly.to/configure',
  behaviorHints: { notWebReady: true },
};

/** The one stream a Sports Streams link sent for WWE Raw, hours after the show. */
const UNAVAILABLE = {
  name: 'Sports Streams',
  description: 'Streams temporarily unavailable - try again shortly',
  url: 'https://premium.example.org/unavailable',
};

describe('isNoticeStream', () => {
  it('spots the messages Sports Streams sends instead of a stream', () => {
    expect(notice(REINSTALL)).toBe(true);
    expect(notice(UNAVAILABLE)).toBe(true);
    // The same words in the name, with no description.
    expect(
      notice({
        name: 'Streams temporarily unavailable - try again shortly',
        url: 'https://premium.example.org/x',
      }),
    ).toBe(true);
  });

  it('spots the wording other addons use', () => {
    for (const words of [
      'No streams found',
      'No links available for this match',
      'Link unavailable',
      'Source offline',
      'Streams are not available yet',
      'Service currently down',
      'Your subscription has expired',
      'Configure the addon to see streams',
      'Private manifest required',
      'Check back soon',
      'Streams coming soon',
      // Behind an emoji, a tag or quotes, after a comma or a dash.
      '⚠️ No streams found',
      '[!] No links available',
      '"No streams found"',
      'Sorry, no working links right now',
      'Sports Streams — No streams',
      // Comet and its kin.
      'Invalid debrid API key',
      'Obsolete config, please reconfigure the addon',
      'Scraping in progress, try again in a minute',
    ]) {
      expect(notice({ name: 'Addon', description: words, url: 'https://a.example/n' })).toBe(true);
    }
  });

  it("takes a link to the addon's settings page for a message, whatever it says", () => {
    expect(notice({ name: 'Addon', url: 'https://addon.example/abc123/configure' })).toBe(true);
    expect(notice({ url: 'https://addon.example/configure/?from=stream' })).toBe(true);
    expect(notice({ url: 'https://addon.example/configure-live/1' })).toBe(false);
    // Whatever it says about a video: no video lives on a settings page.
    expect(notice({ name: 'Addon\n1080p', url: 'https://addon.example/abc123/configure' })).toBe(
      true,
    );
  });

  it('never takes a stream that says anything about a video for a message', () => {
    // A resolution, a file type, a size or a cache mark is a video, whatever else it says.
    expect(notice({ ...UNAVAILABLE, name: 'Sports Streams\n1080p' })).toBe(false);
    expect(notice({ ...UNAVAILABLE, url: 'https://cdn.example.org/sorry.mp4' })).toBe(false);
    expect(notice({ ...UNAVAILABLE, url: 'https://cdn.example.org/live/index.m3u8' })).toBe(false);
    expect(notice({ ...UNAVAILABLE, behaviorHints: { videoSize: 4_000_000_000 } })).toBe(false);
    expect(notice({ ...UNAVAILABLE, behaviorHints: { filename: 'Raw.1746.720p.mkv' } })).toBe(
      false,
    );
    // A file name that says nothing about a video does not make the message one.
    expect(notice({ ...UNAVAILABLE, behaviorHints: { filename: 'unavailable' } })).toBe(true);
    // Torrentio's "subscription expired" film plays, and shows its message itself.
    expect(
      notice({
        name: '[RD error] Torrentio',
        description: 'Your subscription has expired',
        url: 'https://torrentio.example/videos/subscription_expired_v2.mp4',
      }),
    ).toBe(false);
  });

  it('leaves real streams alone', () => {
    expect(notice({ url: 'https://cdn.example.org/live/abc' })).toBe(false);
    expect(
      notice({
        name: 'Sports Streams',
        description: 'ESPN · English',
        url: 'https://cdn.example.org/a',
      }),
    ).toBe(false);
    expect(
      notice({
        name: 'Premium',
        description: 'Sky Sports Main Event',
        url: 'https://cdn.example.org/b',
      }),
    ).toBe(false);
    expect(notice({ name: 'No Limits TV', url: 'https://cdn.example.org/c' })).toBe(false);
    // "No other streams", "reinstall" or "coming soon" mid-sentence describe a real stream.
    expect(
      notice({
        name: 'Server 2',
        description: 'Backup link · no other streams use this server',
        url: 'https://cdn.example.org/e',
      }),
    ).toBe(false);
    expect(
      notice({
        name: 'Assista no Link 1 · Dublado',
        description: 'Reinstall VLC if it stutters',
        url: 'https://cdn.example.org/f',
      }),
    ).toBe(false);
    expect(
      notice({
        name: 'Highlights',
        description: 'Final coming soon after',
        url: 'https://cdn.example.org/g',
      }),
    ).toBe(false);
    // A tip further down a real stream's description is not its headline.
    expect(
      notice({
        name: 'Sports Streams',
        description: 'ESPN HD\nIf it stops, streams are not available on every network: try VLC.',
        url: 'https://cdn.example.org/d',
      }),
    ).toBe(false);
    // Links that open elsewhere are handled as such, never as messages.
    expect(notice({ name: 'No streams found', externalUrl: 'https://addon.example/x' })).toBe(
      false,
    );
  });
});

describe('noticeText', () => {
  it("reads the addon's message as sentences", () => {
    expect(text(REINSTALL)).toBe(
      'Please reinstall the addon. We have updated our free addon to improve service quality. Please visit sports.highfly.to to get a new addon link.',
    );
    expect(text(UNAVAILABLE)).toBe('Streams temporarily unavailable - try again shortly');
  });

  it("leaves out the addon's name tag, and uses the name when it is the message", () => {
    expect(
      text({ name: 'Sports Streams', description: 'No streams found', url: 'https://a.example/x' }),
    ).toBe('No streams found');
    expect(text({ name: 'No streams found\nTry later', url: 'https://a.example/x' })).toBe(
      'No streams found. Try later',
    );
    expect(text({ url: 'https://a.example/configure' })).toBe('');
    // A name tag alone is no message.
    expect(text({ name: 'Sports Streams', url: 'https://a.example/configure' })).toBe('');
  });

  it('shows only the host of a link, never its path, which can carry the viewer’s key', () => {
    const said = text({
      name: 'Addon',
      description:
        'Your link has expired.\nGet a new one at https://premium.example.org/SECRET-KEY/configure',
      url: 'https://premium.example.org/SECRET-KEY/stream',
    });
    expect(said).toBe('Your link has expired. Get a new one at premium.example.org');
    expect(said).not.toContain('SECRET');
    // Written without its scheme too.
    const bare = text({
      name: 'Addon',
      description: 'Link expired. Visit premium.example.org/SECRET-KEY/configure for a new one',
      url: 'https://premium.example.org/x',
    });
    expect(bare).toBe('Link expired. Visit premium.example.org for a new one');
    // A self-hosted addon's address, by IP or on this device.
    expect(
      text({
        name: 'Addon',
        description:
          'Link expired. Visit 192.168.1.20:7000/SECRET-KEY/configure or localhost:7000/SECRET-KEY',
        url: 'https://a.example/x',
      }),
    ).toBe('Link expired. Visit 192.168.1.20 or localhost');
    // Numbers that only look like one stay as they are.
    expect(
      text({
        name: 'Addon',
        description: 'No streams found. Rated 1.5/10, v2.0/beta',
        url: 'https://a.example/x',
      }),
    ).toBe('No streams found. Rated 1.5/10, v2.0/beta');
  });

  it('cuts a long message at a space', () => {
    const long = `No streams found. ${'Please wait while we look again for this match. '.repeat(8)}`;
    const said = text({ name: 'Addon', description: long, url: 'https://a.example/x' });
    expect(said.length).toBeLessThanOrEqual(NOTICE_MAX + 1);
    expect(said.endsWith('…')).toBe(true);
    expect(said.startsWith('No streams found. Please wait')).toBe(true);
  });
});
