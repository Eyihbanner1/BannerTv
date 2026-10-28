/**
 * Tests whether a link opens, before the user presses Play, by loading just
 * its metadata into one hidden video element. Most LG TVs have one video
 * decoder, so there is only ever one test at a time, and none while the
 * player is open (holdProbes).
 */

/** works: the TV read the file's metadata. failed: it refused the link. slow: no answer in time. */
export type ProbeResult = 'works' | 'failed' | 'slow';

export const PROBE_TIMEOUT_MS = 2000;

let element: HTMLVideoElement | null = null;
let current: { finish: (result: ProbeResult | 'cancelled') => void } | null = null;
let queue: Promise<unknown> = Promise.resolve();
// Bumped by cancelProbes, so tests queued before it never start.
let generation = 0;
// Holds from open players: Details can stay mounted under one, and must not test links meanwhile.
let holds = 0;

function video(): HTMLVideoElement {
  if (!element) {
    element = document.createElement('video');
    element.muted = true;
    element.preload = 'metadata';
    element.setAttribute('aria-hidden', 'true');
    // Kept in the page (a detached element may never load on some engines),
    // one pixel in the corner, under everything.
    element.style.cssText =
      'position:absolute;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none;z-index:-1';
    document.body.appendChild(element);
  }
  return element;
}

function release(target: HTMLVideoElement) {
  target.removeAttribute('src');
  target.load();
}

/** Tests one link. Resolves 'cancelled' if cancelProbes() ran first, or a player is open. */
export function probeStream(url: string): Promise<ProbeResult | 'cancelled'> {
  const asked = generation;
  const run = () =>
    new Promise<ProbeResult | 'cancelled'>((resolve) => {
      if (asked !== generation || holds > 0) {
        resolve('cancelled');
        return;
      }
      const target = video();
      let timer = 0;
      const finish = (result: ProbeResult | 'cancelled') => {
        if (current?.finish !== finish) return;
        current = null;
        clearTimeout(timer);
        target.removeEventListener('loadedmetadata', onLoaded);
        target.removeEventListener('error', onError);
        release(target);
        resolve(result);
      };
      const onLoaded = () => finish('works');
      const onError = () => finish('failed');
      current = { finish };
      target.addEventListener('loadedmetadata', onLoaded);
      target.addEventListener('error', onError);
      timer = window.setTimeout(() => finish('slow'), PROBE_TIMEOUT_MS);
      target.src = url;
      target.load();
    });
  const result = queue.then(run, run);
  queue = result;
  return result;
}

/** Stops the running test at once and releases the decoder. */
export function cancelProbes(): void {
  generation++;
  current?.finish('cancelled');
}

/**
 * Stops any test and refuses new ones until the returned function is called,
 * so the player keeps the TV's video decoder to itself while it is open.
 */
export function holdProbes(): () => void {
  holds++;
  cancelProbes();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holds--;
  };
}
