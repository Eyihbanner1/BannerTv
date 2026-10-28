/** One backdrop in the hero. A new one fades in over the one before. */
export interface Layer {
  /** Each change of backdrop is a new layer, even back to an earlier one. */
  id: number;
  src: string;
  /** The addon's own address, tried if the sized one fails. */
  retrySrc: string | undefined;
  /** Decoding, fading in or on show, or fading out (the next one failed). */
  state: 'loading' | 'shown' | 'gone';
}

export interface Backdrops {
  /** The backdrop asked for last, and the id its layer got. */
  src: string | undefined;
  wanted: number;
  layers: readonly Layer[];
}

export type BackdropAction =
  | { type: 'want'; src: string | undefined; retrySrc: string | undefined }
  | { type: 'shown' | 'failed'; id: number }
  | { type: 'settled' };

/** The hero's first backdrop, still loading. */
export function firstBackdrops(src: string | undefined, retrySrc: string | undefined): Backdrops {
  return { src, wanted: 0, layers: src ? [{ id: 0, src, retrySrc, state: 'loading' }] : [] };
}

/**
 * Every change to the layers goes through here, in the order it happened. A
 * fade that ends just as the title changes can then never undo the change.
 */
export function backdrops(state: Backdrops, action: BackdropAction): Backdrops {
  switch (action.type) {
    case 'want': {
      if (action.src === state.src) return state;
      const id = state.wanted + 1;
      // Keep only the last backdrop on show under the new one. Back to that
      // same backdrop before the new one is in: keep it, and nothing waits.
      const below = state.layers.filter((layer) => layer.state === 'shown').slice(-1);
      let layers: readonly Layer[] = [];
      if (action.src && below[0]?.src === action.src) layers = below;
      else if (action.src) {
        layers = below.concat({ id, src: action.src, retrySrc: action.retrySrc, state: 'loading' });
      }
      return { src: action.src, wanted: id, layers };
    }
    case 'shown':
      // A backdrop that was passed over while it decoded never shows.
      if (action.id !== state.wanted) return state;
      return {
        ...state,
        layers: state.layers.map((layer) =>
          layer.id === action.id ? { ...layer, state: 'shown' } : layer,
        ),
      };
    case 'failed':
      if (action.id !== state.wanted) return state;
      return {
        ...state,
        layers: state.layers
          .filter((layer) => layer.id !== action.id)
          .map((layer) => ({ ...layer, state: 'gone' })),
      };
    case 'settled': {
      // Drop what faded out, and whatever the top backdrop on show covers.
      const kept = state.layers.filter((layer) => layer.state !== 'gone');
      const top = kept.map((layer) => layer.state).lastIndexOf('shown');
      const layers = top > 0 ? kept.slice(top) : kept;
      return layers.length === state.layers.length ? state : { ...state, layers };
    }
  }
}
