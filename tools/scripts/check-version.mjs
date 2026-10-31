#!/usr/bin/env node
// The app version lives in two places that must agree: appinfo.json (what the
// TV and LG Seller Lounge read) and the app's package.json. On a tag build the
// tag must be v plus that version. LG accepts strictly major.minor.patch.
import { readFileSync } from 'node:fs';

const appinfo = JSON.parse(readFileSync('apps/webos/webos-meta/appinfo.json', 'utf8'));
const pkg = JSON.parse(readFileSync('apps/webos/package.json', 'utf8'));
const problems = [];

if (!/^\d+\.\d+\.\d+$/.test(appinfo.version)) {
  problems.push(`appinfo.json version "${appinfo.version}" must be major.minor.patch`);
} else {
  // Android's versionCode is major*1000000 + minor*1000 + patch, so a part of 1000 would collide.
  const [, minor, patch] = appinfo.version.split('.').map(Number);
  if (minor >= 1000 || patch >= 1000) {
    problems.push(`appinfo.json version ${appinfo.version} needs minor and patch below 1000`);
  }
}
if (pkg.version !== appinfo.version) {
  problems.push(`apps/webos/package.json is ${pkg.version} but appinfo.json is ${appinfo.version}`);
}
if (
  process.env.GITHUB_REF_TYPE === 'tag' &&
  process.env.GITHUB_REF_NAME !== `v${appinfo.version}`
) {
  problems.push(
    `tag ${process.env.GITHUB_REF_NAME} does not match appinfo.json v${appinfo.version}`,
  );
}

if (problems.length > 0) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`✓ version ${appinfo.version}`);
