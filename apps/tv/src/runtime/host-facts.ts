/**
 * What this app tells the shared code about the device, in place of the phone's answers. The
 * bridge (ADR 0005) is the phone app's (apps/mobile/src/player/phone-host.ts): Android's own
 * player under expo-video. Only the facts differ on a TV.
 */

export interface HostFacts {
  tv: boolean;
  fireTv: boolean;
  [key: string]: unknown;
}

/** The phone's host facts, retold for a TV: Amazon's devices are Fire TVs. */
export function tvHostFacts(phone: HostFacts): HostFacts {
  const manufacturer = typeof phone.manufacturer === 'string' ? phone.manufacturer : '';
  return { ...phone, tv: true, fireTv: /^amazon$/i.test(manufacturer.trim()) };
}

/**
 * What the TV can decode and pass on. Unknown (null) where Android has to be asked at run time,
 * so the shared stream ranking treats 4K, HDR and the newer codecs as "may play" instead of
 * ruling them out as the phone does; DTS and TrueHD stay off, as Android's player passes neither
 * through without a receiver check.
 */
export const TV_CAPABILITIES = {
  uhd: null,
  hdr10: null,
  dolbyVision: null,
  hevc: null,
  av1: null,
  dts: false,
  truehd: false,
} as const;
