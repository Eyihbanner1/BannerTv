import { describe, expect, it } from 'vitest';
import { type BackdropAction, type Backdrops, backdrops, firstBackdrops } from './backdrops';

const A = 'https://images.metahub.space/background/medium/tt0807840/img';
const B = 'https://images.metahub.space/background/medium/tt1254207/img';

const run = (state: Backdrops, ...actions: BackdropAction[]) => actions.reduce(backdrops, state);
const want = (src: string | undefined): BackdropAction => ({
  type: 'want',
  src,
  retrySrc: undefined,
});
const shown = (id: number): BackdropAction => ({ type: 'shown', id });
const failed = (id: number): BackdropAction => ({ type: 'failed', id });
const settled: BackdropAction = { type: 'settled' };
/** Each layer as id, title and state, bottom first. */
const view = (state: Backdrops) =>
  state.layers.map((layer) => `${layer.id} ${/tt\d+/.exec(layer.src)?.[0]} ${layer.state}`);

describe('backdrops', () => {
  const onA = run(firstBackdrops(A, undefined), shown(0), settled);

  it('fades a new backdrop in over the one on show, then drops the old one', () => {
    const fading = run(onA, want(B), shown(1));
    expect(view(fading)).toEqual(['0 tt0807840 shown', '1 tt1254207 shown']);
    expect(view(run(fading, settled))).toEqual(['1 tt1254207 shown']);
  });

  it('keeps the backdrop on show when focus comes back before the new one is in', () => {
    const back = run(onA, want(B), want(A));
    expect(view(back)).toEqual(['0 tt0807840 shown']);
    // The passed-over backdrop finishing late changes nothing.
    expect(run(back, shown(1))).toBe(back);
    expect(run(back, failed(1))).toBe(back);
  });

  it('fades the old backdrop out when the new one fails, then shows nothing', () => {
    const gone = run(onA, want(B), failed(1));
    expect(view(gone)).toEqual(['0 tt0807840 gone']);
    expect(view(run(gone, settled))).toEqual([]);
  });

  it('keeps the new backdrop whichever comes first: the fade ending or the title changing', () => {
    const fading = run(onA, want(B), shown(1));
    const expected = ['1 tt1254207 shown', '2 tt0807840 loading'];
    expect(view(run(fading, settled, want(A)))).toEqual(expected);
    expect(view(run(fading, want(A), settled))).toEqual(expected);
  });

  it('clears the hero for a title with no backdrop', () => {
    expect(view(run(onA, want(undefined)))).toEqual([]);
  });
});
