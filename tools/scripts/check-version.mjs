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
