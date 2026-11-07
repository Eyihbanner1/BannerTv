import { describe, expect, it } from 'vitest';
import { drawsPanelBody } from './panel-body';

describe('a side panel body', () => {
  it('is built while the panel is open, on every platform', () => {
    for (const os of ['android', 'ios', 'web']) {
      expect(drawsPanelBody(true, false, os)).toBe(true);
      expect(drawsPanelBody(true, true, os)).toBe(true);
    }
  });

  it('is not built for a closed panel on Android, whose Modal draws nothing then', () => {
    expect(drawsPanelBody(false, false, 'android')).toBe(false);
    expect(drawsPanelBody(false, true, 'android')).toBe(false);
  });

  it('stays while iOS and the web fade a closing panel out, and goes once it has gone', () => {
    for (const os of ['ios', 'web']) {
      expect(drawsPanelBody(false, true, os)).toBe(true);
      expect(drawsPanelBody(false, false, os)).toBe(false);
    }
  });
});
