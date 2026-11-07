import { installPhoneHost } from '../player/phone-host';

// Imported first by src/boot.ts, before any shared module reads `window.BannerAndroid`.
installPhoneHost();
