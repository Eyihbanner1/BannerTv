import type { SubtitleStyle } from '@tv/data/preferences';
import { describe, expect, it } from 'vitest';
import { subtitleLook } from './subtitle-look';

const PLAIN: SubtitleStyle = {
  size: 'medium',
  colour: 'white',
  background: 'outline',
  position: 'bottom',
};
/** A phone held sideways, as the player holds it: 1080 lines on the TV become 540 here. */
const SIDEWAYS = { width: 1170, height: 540 };

describe('the subtitle style on the phone', () => {
  it("scales the TV's sizes to the screen's shorter side", () => {
    expect(subtitleLook(PLAIN, SIDEWAYS, false).text.fontSize).toBe(26);
    expect(subtitleLook({ ...PLAIN, size: 'small' }, SIDEWAYS, false).text.fontSize).toBe(20);
    expect(subtitleLook({ ...PLAIN, size: 'huge' }, SIDEWAYS, false).text.fontSize).toBe(40);
    // Upright, as while the screen turns: the width is the shorter side.
    expect(subtitleLook(PLAIN, { width: 540, height: 1170 }, false).text.fontSize).toBe(26);
    expect(subtitleLook(PLAIN, SIDEWAYS, false).text.lineHeight).toBe(32.5);
    expect(subtitleLook(PLAIN, SIDEWAYS, false).cueGap).toBe(4);
  });

  it("draws the TV's colours", () => {
    expect(subtitleLook({ ...PLAIN, colour: 'yellow' }, SIDEWAYS, false).text.color).toBe(
      '#ffe45c',
    );
    expect(subtitleLook({ ...PLAIN, colour: 'cyan' }, SIDEWAYS, false).text.color).toBe('#6ae4ff');
    expect(subtitleLook({ ...PLAIN, colour: 'green' }, SIDEWAYS, false).text.color).toBe('#8cf59a');
  });

  it('edges the letters, or puts a box behind each line', () => {
    const outline = subtitleLook(PLAIN, SIDEWAYS, false);
    expect(outline.back).toBeNull();
    expect(outline.text.textShadowOffset).toEqual({ width: 0, height: 0 });
    expect(outline.text.textShadowRadius).toBeGreaterThan(0);

    const shadow = subtitleLook({ ...PLAIN, background: 'shadow' }, SIDEWAYS, false);
    expect(shadow.back).toBeNull();
    expect(shadow.text.textShadowOffset.width).toBeGreaterThan(0);

    const box = subtitleLook({ ...PLAIN, background: 'box' }, SIDEWAYS, false);
    expect(box.back).toBe('rgba(0,0,0,0.6)');
    expect(box.text.textShadowRadius).toBe(0);
    expect(subtitleLook({ ...PLAIN, background: 'solid' }, SIDEWAYS, false).back).toBe('#000000');
  });

  it('places the lines as the TV does, clear of the controls while they show', () => {
    expect(subtitleLook(PLAIN, SIDEWAYS, false).main).toEqual({ bottom: '6.7%' });
    expect(subtitleLook({ ...PLAIN, position: 'raised' }, SIDEWAYS, false).main).toEqual({
      bottom: '18.5%',
    });
    expect(subtitleLook(PLAIN, SIDEWAYS, true).main).toEqual({ bottom: '26%' });
    expect(subtitleLook({ ...PLAIN, position: 'raised' }, SIDEWAYS, true).main).toEqual({
      bottom: '26%',
    });

    const top = subtitleLook({ ...PLAIN, position: 'top' }, SIDEWAYS, false);
    expect(top.main).toEqual({ top: '5.9%' });
    expect(top.allAtTop).toBe(true);
    expect(subtitleLook({ ...PLAIN, position: 'top' }, SIDEWAYS, true).main).toEqual({
      top: '20%',
    });

    // Lines the file places at the top stay there, below the title while the controls show.
    expect(subtitleLook(PLAIN, SIDEWAYS, false).upper).toEqual({ top: '5.9%' });
    expect(subtitleLook(PLAIN, SIDEWAYS, true).upper).toEqual({ top: '20%' });
    expect(subtitleLook(PLAIN, SIDEWAYS, false).allAtTop).toBe(false);
  });
});
