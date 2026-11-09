const fs = require('node:fs');
const path = require('node:path');

/**
 * Where the public certificate that checks app updates' signatures lives, as app.config.ts names
 * it (relative to apps/mobile). Only the certificate is ever committed: its private key is the
 * GitHub Actions secret EXPO_UPDATES_PRIVATE_KEY, which only the publish workflow reads. Kept in
 * a small CommonJS file because the app's TypeScript has no Node types for app.config.ts to ask
 * the file system itself.
 */
const UPDATES_CERTIFICATE = './certs/certificate.pem';

/** Whether the certificate is there, so the APK can check updates' signatures. */
function hasUpdatesCertificate() {
  return fs.existsSync(path.join(__dirname, '..', UPDATES_CERTIFICATE));
}

module.exports = { UPDATES_CERTIFICATE, hasUpdatesCertificate };
