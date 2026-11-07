import { describe, expect, it } from 'vitest';
import { asksForNotifications, helperView } from './stream-helper-view';

describe('helperView', () => {
  it('shows the address and code while on, without the usual port', () => {
    expect(
      helperView({ on: true, address: '192.168.1.42', port: 47020, code: '012345', paired: 1 }),
    ).toEqual({
      on: true,
      pairing: { address: '192.168.1.42', code: '012345' },
      noWifi: false,
      paired: 1,
    });
  });

  it('keeps a port the helper had to change', () => {
    const view = helperView({
      on: true,
      address: '10.0.0.7',
      port: 51234,
      code: '999999',
      paired: 0,
    });
    expect(view.pairing?.address).toBe('10.0.0.7:51234');
  });

  it('says to join the Wi-Fi when on with no home address', () => {
    expect(helperView({ on: true, address: null, port: 47020, code: '123456', paired: 2 })).toEqual(
      { on: true, pairing: null, noWifi: true, paired: 2 },
    );
  });

  it('shows nothing to type while off, but still how many TVs are paired', () => {
    expect(helperView({ on: false, address: null, paired: 3 })).toEqual({
      on: false,
      pairing: null,
      noWifi: false,
      paired: 3,
    });
    expect(helperView({ on: false, paired: -1 }).paired).toBe(0);
  });
});

describe('asksForNotifications', () => {
  it('asks from Android 13 on, and never off Android', () => {
    expect(asksForNotifications('android', 33)).toBe(true);
    expect(asksForNotifications('android', 36)).toBe(true);
    expect(asksForNotifications('android', 32)).toBe(false);
    expect(asksForNotifications('web', 'Chrome')).toBe(false);
    expect(asksForNotifications('ios', '18.0')).toBe(false);
  });
});
