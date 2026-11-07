import { HelperUnavailable } from '../../data/stream-helper';
import { requestHeadersFor } from '../request-headers';
import { type Engine, PlaybackError } from './types';

/** Asks the stream helper for a link that plays `url` with `headers` (data/helper.ts). */
export type HelperLink = (url: string, headers: Record<string, string>) => Promise<string>;

let helperLink: HelperLink = () => Promise.reject(new HelperUnavailable('unpaired'));

/** Where engines ask for helper links: set once at start, off Android. */
export function setHelperLink(link: HelperLink): void {
  helperLink = link;
}

/**
 * The engine, with streams whose addon asks for request headers sent through
 * the stream helper on the home network, which adds them. Off Android only:
 * the TV's own player and hls.js can't set them. Other streams play as they are.
 */
export function throughStreamHelper(
  engine: Engine,
  link: HelperLink = (url, headers) => helperLink(url, headers),
): Engine {
  return {
    get name() {
      return engine.name;
    },
    async load(url, startAt) {
      const headers = requestHeadersFor(url);
      if (!headers) return engine.load(url, startAt);
      let relayed: string;
      try {
        relayed = await link(url, headers);
      } catch (error) {
        const reason = error instanceof HelperUnavailable ? error.reason : 'unreachable';
        throw new PlaybackError(
          'network',
          'The stream helper is not available',
          `stream-helper-${reason}`,
        );
      }
      return engine.load(relayed, startAt);
    },
    isLive: () => engine.isLive(),
    liveWindow: () => engine.liveWindow(),
    audioTracks: () => engine.audioTracks(),
    selectAudio: (id) => engine.selectAudio(id),
    textTracks: () => engine.textTracks(),
    selectText: (id) => engine.selectText(id),
    ...(engine.seeked ? { seeked: () => engine.seeked?.() } : {}),
    destroy: () => engine.destroy(),
  };
}
