import { describe, expect, it } from 'vitest';
import { updatesChannel } from './updates';

describe('which phone builds follow main’s updates', () => {
  it('an APK of main, from a run of CI started by hand on main', () => {
    expect(updatesChannel({ GITHUB_ACTIONS: 'true', GITHUB_REF: 'refs/heads/main' })).toBe('main');
  });

  it('not a pull request’s APK, from the phone-apk or full-ci label', () => {
    expect(updatesChannel({ GITHUB_ACTIONS: 'true', GITHUB_REF: 'refs/pull/53/merge' })).toBeNull();
  });

  it('not the combined test build, or a run by hand on another branch', () => {
    for (const ref of ['refs/heads/test/all-together', 'refs/heads/main-next', 'refs/tags/main']) {
      expect(updatesChannel({ GITHUB_ACTIONS: 'true', GITHUB_REF: ref })).toBeNull();
    }
  });

  it('not a build on a computer, whatever it was given', () => {
    expect(updatesChannel({})).toBeNull();
    expect(updatesChannel({ GITHUB_REF: 'refs/heads/main' })).toBeNull();
  });
});
