import { isAndroid } from '../platform/android';
import { requestHeaderRelayChanged, setRequestHeaderRelay } from '../platform/capabilities';
import { setHelperLink } from '../player/engines/helper';
import { storage } from './storage';
import { createStreamHelper } from './stream-helper';

/** This TV's pairing with a stream helper. TV-wide: every profile plays through it. */
export const streamHelper = createStreamHelper({ storage: storage.kv });

/**
 * Off Android, streams that need request headers count as playable while a
 * stream helper is paired. Android's own player sends the headers itself.
 */
export function startStreamHelper(): void {
  if (isAndroid()) return;
  setRequestHeaderRelay(() => streamHelper.get() !== null);
  // Stream lists made before a pairing (or before it was read at launch) assess their streams again.
  streamHelper.subscribe(requestHeaderRelayChanged);
  setHelperLink(streamHelper.link);
  void streamHelper.load();
}
