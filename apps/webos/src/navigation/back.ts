/**
 * The Back key stack. With `disableBackHistoryAPI: true` in appinfo.json the
 * app gets key 461 itself and decides what Back means.
 *
 * Handlers sit in layers: an open overlay answers before the screen, and the
 * screen before the router. Inside a layer the newest handler answers first.
 * A handler returns true when it dealt with the key.
 */
export type BackLayer = 'router' | 'screen' | 'overlay';
export type BackHandler = () => boolean;

const LAYER_ORDER: Record<BackLayer, number> = { router: 0, screen: 1, overlay: 2 };

interface Entry {
  layer: BackLayer;
  handler: BackHandler;
  seq: number;
}

export function createBackStack() {
  let entries: Entry[] = [];
  let seq = 0;

  return {
    push(layer: BackLayer, handler: BackHandler): () => void {
      const entry = { layer, handler, seq: seq++ };
      entries = [...entries, entry].sort(
        (a, b) => LAYER_ORDER[a.layer] - LAYER_ORDER[b.layer] || a.seq - b.seq,
      );
      return () => {
        entries = entries.filter((e) => e !== entry);
      };
    },
    /** Offers Back to each handler, top first. Returns whether one took it. */
    handle(): boolean {
      for (let i = entries.length - 1; i >= 0; i--) {
        if (entries[i]!.handler()) return true;
      }
      return false;
    },
  };
}

export const backStack = createBackStack();
