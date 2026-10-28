import { afterEach, describe, expect, it, vi } from 'vitest';
import { LunaError, lunaCall, lunaFailed } from './webos';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('lunaFailed', () => {
  it('goes by returnValue when the answer has one', () => {
    expect(lunaFailed({ returnValue: true, errorCode: 0, errorText: 'No Error' })).toBe(false);
    expect(lunaFailed({ returnValue: false })).toBe(true);
    expect(lunaFailed({ returnValue: false, errorCode: -1, errorText: 'Unknown method' })).toBe(
      true,
    );
  });

  it('without returnValue, fails only on an errorCode other than 0', () => {
    expect(lunaFailed({ errorCode: -1, errorText: 'Invalid mediaId' })).toBe(true);
    expect(lunaFailed({ errorCode: 'ERR_PARAMS' })).toBe(true);
    // The media service's answer to setSubtitleEnable on webOS 22.
    expect(lunaFailed({ errorCode: 0, errorText: 'No Error' })).toBe(false);
    expect(lunaFailed({ errorCode: '0' })).toBe(false);
  });

  it('takes "No Error" at its word, whatever returnValue says', () => {
    // How the media service could answer unsubscribe on webOS 22, which logged "No Error" as a failure.
    expect(lunaFailed({ returnValue: false, errorCode: 0, errorText: 'No Error' })).toBe(false);
    expect(lunaFailed({ returnValue: false, errorText: 'No Error' })).toBe(false);
    expect(lunaFailed({ returnValue: false, errorText: 'Invalid mediaId' })).toBe(true);
  });

  it('takes an empty answer as success', () => {
    expect(lunaFailed({})).toBe(false);
  });
});

describe('lunaCall', () => {
  /** A service bridge that answers every call at once with `answer`. */
  function answerWith(answer: Record<string, unknown>) {
    vi.stubGlobal('window', {
      PalmServiceBridge: class {
        onservicecallback: ((message: string) => void) | null = null;
        call() {
          this.onservicecallback?.(JSON.stringify(answer));
        }
        cancel() {}
      },
    });
  }

  it('resolves with an answer of errorCode 0 and "No Error"', async () => {
    answerWith({ errorCode: 0, errorText: 'No Error' });
    await expect(lunaCall('luna://com.webos.media/setSubtitleEnable')).resolves.toEqual({
      errorCode: 0,
      errorText: 'No Error',
    });
  });

  it('rejects with the errorText of a failed answer', async () => {
    answerWith({ returnValue: false, errorCode: -1, errorText: 'Invalid mediaId' });
    const call = lunaCall('luna://com.webos.media/selectTrack');
    await expect(call).rejects.toBeInstanceOf(LunaError);
    await expect(call).rejects.toThrow('luna://com.webos.media/selectTrack: Invalid mediaId');
  });
});
