import { describe, expect, it } from 'vitest';
import { remoteKey } from './remote';

describe('remoteKey', () => {
  it('reads a press from its key up', () => {
    expect(remoteKey({ eventType: 'right', eventKeyAction: 1 })).toEqual({
      key: 'right',
      held: false,
    });
    expect(remoteKey({ eventType: 'right', eventKeyAction: 0 })).toBeNull();
  });

  it('repeats a held arrow on each of its key downs, and drops its key up', () => {
    expect(remoteKey({ eventType: 'longLeft', eventKeyAction: 0 })).toEqual({
      key: 'left',
      held: true,
    });
    expect(remoteKey({ eventType: 'longLeft', eventKeyAction: 1 })).toBeNull();
  });

  it('ignores keys the app has no use for', () => {
    expect(remoteKey({ eventType: 'channelUp', eventKeyAction: 1 })).toBeNull();
    expect(remoteKey({ eventType: 'focus', eventKeyAction: -1 })).toBeNull();
  });
});
