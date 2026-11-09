const fs = require('node:fs');
const path = require('node:path');

/**
 * What decides whether a phone build takes over-the-air updates (app.config.ts). Kept in a small
 * CommonJS file because the app's TypeScript has no Node types for app.config.ts to read the
 * file system or the environment itself.
 */

/**
 * Where the public certificate that checks app updates' signatures lives, as app.config.ts names
 * it (relative to apps/mobile). Only the certificate is ever committed: its private key is the
 * GitHub Actions secret EXPO_UPDATES_PRIVATE_KEY, which only the publish workflow reads.
 */
const UPDATES_CERTIFICATE = './certs/certificate.pem';

/** Whether the certificate is there, so the APK can check updates' signatures. */
function hasUpdatesCertificate() {
  return fs.existsSync(path.join(__dirname, '..', UPDATES_CERTIFICATE));
}

/**
 * The update channel this build follows: `main` for a build of main's own code, otherwise null,
 * and the build takes no updates. A test APK from a pull request (the phone-apk or full-ci label)
 * or the combined test build runs code main does not have yet, and is installed to try exactly
 * that: on main's channel, main's next publish would replace it without a word, with the same
 * fingerprint and a newer date. CI builds an APK of main only in a run started by hand on main,
 * since pushes to main run the quick check alone.
 *
 * GitHub Actions sets GITHUB_REF in every step: CI's prebuild and Gradle steps (Gradle works the
 * runtime version out) and the publish workflow's, so an APK of main and the updates published
 * for it agree without ci.yml passing anything. The choice is part of the app config the
 * fingerprint hashes, so a build that takes no updates has a runtime version of its own too.
 * CI's comparison of a pull request with its base works both out in the same step, so the same
 * way, and still sees only native changes.
 *
 * @param {{ GITHUB_ACTIONS?: string; GITHUB_REF?: string }} [env]
 * @returns {'main' | null}
 */
function updatesChannel(env = process.env) {
  return env.GITHUB_ACTIONS === 'true' && env.GITHUB_REF === 'refs/heads/main' ? 'main' : null;
}

module.exports = { UPDATES_CERTIFICATE, hasUpdatesCertificate, updatesChannel };
