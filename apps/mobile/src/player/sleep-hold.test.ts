import { describe, expect, it } from 'vitest';
import { sleepHold } from './sleep-hold';

describe('sleepHold', () => {
  it('pauses the video still playing as the timer runs out, in the player or the small window', () => {
    expect(sleepHold({ playing: true, stopped: false, unseen: false })).toBe('pause');
    expect(sleepHold({ playing: true, stopped: false, unseen: true })).toBe('pause');
  });

  it('pauses again a stream that starts under the dark screen, as on the TV', () => {
    expect(sleepHold({ playing: true, stopped: true, unseen: false })).toBe('pause');
  });

  it('takes Play in picture-in-picture, where the dark screen can’t show, as carrying on', () => {
    expect(sleepHold({ playing: true, stopped: true, unseen: true })).toBe('wake');
  });

  it('waits while nothing plays', () => {
    expect(sleepHold({ playing: false, stopped: true, unseen: true })).toBe('wait');
    expect(sleepHold({ playing: false, stopped: false, unseen: false })).toBe('wait');
  });
});
