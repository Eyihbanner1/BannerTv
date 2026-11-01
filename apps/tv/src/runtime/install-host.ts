import { installPhoneHost } from '@phone/player/phone-host';
import { window } from '@phone/runtime/web-globals';
import { type HostFacts, TV_CAPABILITIES, tvHostFacts } from './host-facts';

/**
 * Imported first by src/boot.ts, before any shared module reads `window.BannerAndroid`. The
 * phone's bridge, with the device facts a TV gives instead of a phone's.
 */
installPhoneHost();
const bridge = window.BannerAndroid as
  { hostInfo: () => string; capabilities: () => string } | undefined;
if (bridge) {
  const phoneInfo = bridge.hostInfo;
  bridge.hostInfo = () => JSON.stringify(tvHostFacts(JSON.parse(phoneInfo()) as HostFacts));
  bridge.capabilities = () => JSON.stringify(TV_CAPABILITIES);
}
