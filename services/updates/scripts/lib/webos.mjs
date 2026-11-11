/**
 * What the "Publish LG update" workflow uploads for the LG TV's Homebrew Channel repository,
 * worked out from files alone: the version a publish stamps into the app, the checks on the
 * .ipk the build made, the index Homebrew Channel reads, and the `wrangler kv bulk put` entries
 * that store it all. No network, no wrangler and Node's own modules only, so the jobs that hold
 * the Cloudflare token can run it from their own checkout with no install. The workflow reads
 * the store with wrangler, hands it in as files, and uploads what comes out. The Worker
 * (src/webos.ts) reads the same keys; the round-trip test checks the two agree.
 *
 * Nothing here signs. Homebrew Channel installs an .ipk only when the file it downloads has the
 * SHA-256 the index gives, and the index comes over HTTPS from our Worker. Signed in-app updates
 * are later work.
 */
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { MAX_VALUE_BYTES, UPDATE_URL } from './update.mjs';

/** Where the Worker answers: https://updates.bannertv.workers.dev. */
export const ORIGIN = new URL(UPDATE_URL).origin;
/** The one channel published to for now: builds of main. */
export const CHANNEL = 'main';
export const APP_ID = 'com.bannertv.app';
export const REPO_URL = `${ORIGIN}/webos/repo.json`;
/** How many publishes the history keeps, so rollback-previous can step back up to 19. */
export const HISTORY_LENGTH = 20;
/**
 * Minor and patch stay below 1000, as tools/scripts/check-version.mjs has it: Android's
 * versionCode is major*1000000 + minor*1000 + patch.
 */
export const PART_LIMIT = 1000;

// The KV keys, as src/webos.ts names them.
export const repoKey = (channel = CHANNEL) => `webos/repo/${channel}`;
export const historyKey = (channel = CHANNEL) => `webos/history/${channel}`;
export const ipkKey = (sha256) => `webos/ipk/${sha256}`;
export const iconKey = (sha256) => `webos/icon/${sha256}`;

/** Where the Worker serves an .ipk or icon, by its SHA-256: absolute, as Homebrew Channel wants. */
export const ipkUrl = (sha256, origin = ORIGIN) => `${origin}/webos/ipk/${sha256}.ipk`;
export const iconUrl = (sha256, origin = ORIGIN) => `${origin}/webos/icon/${sha256}.png`;

const SHA256_HEX = /^[0-9a-f]{64}$/;
/** As tools/scripts/check-version.mjs reads appinfo.json's version. */
const VERSION = /^\d+\.\d+\.\d+$/;
const COMMIT = /^[0-9a-f]{7,40}$/;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function check(condition, message) {
  if (!condition) throw new Error(message);
}

/** SHA-256 in lower-case hex, the form Homebrew Channel compares (exactly) with the file's. */
export function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export const isSha256Hex = (value) => typeof value === 'string' && SHA256_HEX.test(value);

/** A version's three numbers, checked by check-version.mjs's rules. */
export function parseVersion(text, what = 'The version') {
  check(
    typeof text === 'string' && VERSION.test(text),
    `${what} "${text}" is not major.minor.patch.`,
  );
  const parts = text.split('.').map(Number);
  check(
    parts[1] < PART_LIMIT && parts[2] < PART_LIMIT,
    `${what} ${text} needs minor and patch below ${PART_LIMIT} (tools/scripts/check-version.mjs).`,
  );
  return parts;
}

/** Below zero when a is the lower version, zero when they are the same, above zero otherwise. */
export function compareVersions(a, b) {
  const [x, y] = [parseVersion(a), parseVersion(b)];
  for (let i = 0; i < 3; i += 1) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

const maxVersion = (versions) =>
  versions.reduce((high, v) => (high === null || compareVersions(v, high) > 0 ? v : high), null);

function checkEntry(entry) {
  check(entry !== null && typeof entry === 'object', 'A history entry is not an object.');
  parseVersion(entry.version, 'A history entry’s version');
  check(isSha256Hex(entry.sha256), `History entry ${entry.version} has no .ipk SHA-256.`);
  check(isSha256Hex(entry.iconSha256), `History entry ${entry.version} has no icon SHA-256.`);
  check(
    Number.isInteger(entry.ipkSize) && entry.ipkSize > 0,
    `History entry ${entry.version} has no .ipk size.`,
  );
  check(
    typeof entry.title === 'string' && entry.title !== '',
    `History entry ${entry.version} has no title.`,
  );
  check(
    typeof entry.publishedAt === 'string' && !Number.isNaN(Date.parse(entry.publishedAt)),
    `History entry ${entry.version} has no publish time.`,
  );
}

/**
 * The stored history: the highest version ever published, which a roll back never lowers, and
 * the publishes still offered or gone back to, newest first. None is an empty history.
 */
export function readHistory(text) {
  if (text === undefined || text === null || text.trim() === '') {
    return { highest: null, publishes: [] };
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error('The stored LG history is not JSON.');
  }
  check(
    value !== null && typeof value === 'object' && Array.isArray(value.publishes),
    'The stored LG history has no list of publishes.',
  );
  value.publishes.forEach(checkEntry);
  if (value.highest !== null && value.highest !== undefined) {
    parseVersion(value.highest, 'The stored highest version');
  }
  // The highest kept, or the highest publish if that is higher: a version is never used twice.
  const highest = maxVersion(
    [value.highest, ...value.publishes.map((entry) => entry.version)].filter(Boolean),
  );
  return { highest, publishes: value.publishes };
}

/**
 * The version a publish stamps into its build: appinfo.json's major.minor, with a patch one
 * above both appinfo.json's patch and the highest patch any earlier publish used. So every
 * publish is higher than the last (webOS may refuse to install a lower version over a higher
 * one) and higher than the committed version a Developer Mode install from CI has. Refused,
 * before anything is built, when the patch would reach 1000 or appinfo.json's major.minor is
 * below what was published already.
 */
export function nextVersion({ committed, history }) {
  const [major, minor, patch] = parseVersion(
    committed,
    'apps/webos/webos-meta/appinfo.json’s version',
  );
  let next = patch + 1;
  if (history.highest !== null) {
    const [hMajor, hMinor, hPatch] = parseVersion(history.highest);
    const line = major - hMajor || minor - hMinor;
    check(
      line >= 0,
      `appinfo.json says ${committed}, but ${history.highest} was published already. Raise the version in apps/webos/webos-meta/appinfo.json and apps/webos/package.json to ${hMajor}.${hMinor}.0 or more on main, then publish.`,
    );
    if (line === 0) next = Math.max(patch, hPatch) + 1;
  }
  check(
    next < PART_LIMIT,
    `The next LG publish would be ${major}.${minor}.${next}, and the patch must stay below ${PART_LIMIT} (Android's versionCode, tools/scripts/check-version.mjs). Raise the minor version in apps/webos/webos-meta/appinfo.json and apps/webos/package.json on main (to ${major}.${minor + 1}.0), then publish.`,
  );
  return `${major}.${minor}.${next}`;
}

/**
 * appinfo.json and apps/webos/package.json with the version a publish chose, as the build job
 * writes them in its own checkout. The stamped version is in the published .ipk only, never
 * committed. It must keep the committed major.minor and be above the committed patch.
 */
export function stampVersion({ appinfoText, packageText, version }) {
  const appinfo = JSON.parse(appinfoText);
  const pkg = JSON.parse(packageText);
  check(appinfo.id === APP_ID, `appinfo.json is for ${appinfo.id}, not ${APP_ID}.`);
  check(
    pkg.version === appinfo.version,
    `apps/webos/package.json says ${pkg.version} but appinfo.json says ${appinfo.version}.`,
  );
  const [major, minor, patch] = parseVersion(appinfo.version, 'appinfo.json’s version');
  const [sMajor, sMinor, sPatch] = parseVersion(version, 'The version to stamp');
  check(
    sMajor === major && sMinor === minor && sPatch > patch,
    `${version} is not a publish of ${appinfo.version}: it must keep ${major}.${minor} and have a higher patch.`,
  );
  const write = (value) => `${JSON.stringify(value, null, 2)}\n`;
  return {
    appinfoText: write({ ...appinfo, version }),
    packageText: write({ ...pkg, version }),
  };
}

/** The members of an ar archive (an .ipk, as a .deb is one), by name. */
export function readAr(bytes) {
  check(
    bytes.length >= 8 && bytes.subarray(0, 8).toString('latin1') === '!<arch>\n',
    'is not an ar archive.',
  );
  const members = new Map();
  let offset = 8;
  while (offset < bytes.length) {
    check(offset + 60 <= bytes.length, 'is cut short.');
    const header = bytes.subarray(offset, offset + 60);
    check(header.subarray(58, 60).toString('latin1') === '`\n', 'has a broken member header.');
    // GNU ar ends a name with "/", BSD and ares-package pad it with spaces.
    const name = header.subarray(0, 16).toString('latin1').trimEnd().replace(/\/$/, '');
    const size = Number(header.subarray(48, 58).toString('latin1').trim());
    check(Number.isInteger(size) && size >= 0, `gives ${name} no size.`);
    const start = offset + 60;
    check(start + size <= bytes.length, 'is cut short.');
    members.set(name, bytes.subarray(start, start + size));
    // Each member starts on an even byte.
    offset = start + size + (size % 2);
  }
  return members;
}

/** The regular files of a tar archive, by path without a leading "./". */
export function readTar(bytes) {
  const files = new Map();
  let offset = 0;
  let longName;
  while (offset + 512 <= bytes.length) {
    const header = bytes.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const field = (start, length) => {
      const raw = header.subarray(start, start + length);
      const end = raw.indexOf(0);
      return raw.subarray(0, end === -1 ? length : end).toString('utf8');
    };
    const size = parseInt(field(124, 12).trim() || '0', 8);
    check(Number.isInteger(size) && size >= 0, 'has a tar entry with no size.');
    const type = field(156, 1) || '0';
    let name = field(0, 100);
    if (field(257, 5) === 'ustar' && field(345, 155) !== '') name = `${field(345, 155)}/${name}`;
    const start = offset + 512;
    check(start + size <= bytes.length, 'has a tar archive cut short.');
    const data = bytes.subarray(start, start + size);
    offset = start + Math.ceil(size / 512) * 512;
    // A GNU long name, or a pax path, is the name of the entry after it.
    if (type === 'L') {
      longName = data.toString('utf8').replace(/\0+$/, '');
      continue;
    }
    if (type === 'x') {
      const path = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(data.toString('utf8'));
      if (path) longName = path[1];
      continue;
    }
    if (longName !== undefined) [name, longName] = [longName, undefined];
    if (type === '0' || type === '7') files.set(name.replace(/^(\.\/|\/)+/, ''), data);
  }
  return files;
}

/** The fields of a Debian-style control file. */
export function readControl(text) {
  const fields = {};
  let last;
  for (const line of text.split('\n')) {
    if (/^\s/.test(line) && last) {
      fields[last] += `\n${line.trim()}`;
      continue;
    }
    const match = /^([A-Za-z0-9-]+):\s*(.*)$/.exec(line);
    if (match) [last, fields[match[1]]] = [match[1], match[2].trim()];
  }
  return fields;
}

function gunzip(bytes, name) {
  try {
    return gunzipSync(bytes);
  } catch {
    throw new Error(`has a ${name} that is not gzip.`);
  }
}

/**
 * What an .ipk says it is: its control file, the appinfo.json webOS reads the installed version
 * from, and its files by their path inside the app.
 */
export function readIpk(bytes) {
  const members = readAr(bytes);
  const control = members.get('control.tar.gz');
  const data = members.get('data.tar.gz');
  check(members.has('debian-binary') && control && data, 'is not an .ipk.');
  const controlFile = readTar(gunzip(control, 'control.tar.gz')).get('control');
  check(controlFile, 'has no control file.');
  const fields = readControl(controlFile.toString('utf8'));
  const appDir = `usr/palm/applications/${fields.Package}`;
  const files = readTar(gunzip(data, 'data.tar.gz'));
  const appinfoBytes = files.get(`${appDir}/appinfo.json`);
  check(appinfoBytes, `has no ${appDir}/appinfo.json.`);
  let appinfo;
  try {
    appinfo = JSON.parse(appinfoBytes.toString('utf8'));
  } catch {
    throw new Error(`has an ${appDir}/appinfo.json that is not JSON.`);
  }
  return { control: fields, appinfo, file: (name) => files.get(`${appDir}/${name}`) };
}

/**
 * The .ipk a publish built, checked against the version it was to carry: the control file
 * (what the installer reads) and appinfo.json (what webOS, and so Homebrew Channel, reports as
 * installed) must both say BannerTV at that version, or the TV would offer Update for ever.
 * Gives the title and the 130 px icon (appinfo.json's largeIcon) the index shows.
 */
export function checkIpk(bytes, { version, name = 'The .ipk' } = {}) {
  check(
    bytes.length <= MAX_VALUE_BYTES,
    `${name} is ${bytes.length} bytes, more than Workers KV keeps in one value.`,
  );
  let ipk;
  try {
    ipk = readIpk(bytes);
  } catch (error) {
    throw new Error(`${name} ${error instanceof Error ? error.message : String(error)}`, {
      cause: error,
    });
  }
  const { control, appinfo } = ipk;
  check(control.Package === APP_ID, `${name} is the package ${control.Package}, not ${APP_ID}.`);
  check(appinfo.id === APP_ID, `${name}’s appinfo.json is for ${appinfo.id}, not ${APP_ID}.`);
  check(
    control.Version === version && appinfo.version === version,
    `${name} is version ${appinfo.version} (control file ${control.Version}), not ${version}: was the version stamped before the build?`,
  );
  check(appinfo.type === 'web', `${name}’s appinfo.json gives the type ${appinfo.type}, not web.`);
  check(
    typeof appinfo.title === 'string' && appinfo.title !== '',
    `${name}’s appinfo.json has no title.`,
  );
  const iconName = appinfo.largeIcon;
  check(
    typeof iconName === 'string' && iconName.endsWith('.png'),
    `${name}’s appinfo.json names no PNG largeIcon.`,
  );
  const icon = ipk.file(iconName);
  check(
    icon && icon.length >= PNG.length && icon.subarray(0, PNG.length).equals(PNG),
    `${name} has no PNG ${iconName}.`,
  );
  check(icon.length <= MAX_VALUE_BYTES, `${iconName} is more than Workers KV keeps in one value.`);
  return { title: appinfo.title, icon: { name: iconName, bytes: icon } };
}

/**
 * What the build job says it made, for the upload job to check again: the version, commit and
 * SHA-256s of the .ipk and of its icon.
 */
export function describeBuild(bytes, { version, commit, ipkName }) {
  parseVersion(version);
  check(COMMIT.test(commit ?? ''), `"${commit}" is not a commit.`);
  const { icon } = checkIpk(bytes, { version, name: ipkName });
  return {
    version,
    commit,
    ipkName,
    sha256: sha256Hex(bytes),
    ipkSize: bytes.length,
    iconName: icon.name,
    iconSha256: sha256Hex(icon.bytes),
  };
}

/** The line Homebrew Channel shows on BannerTV's page, so the TV says which build it offers. */
export function describeEntry(entry) {
  const at = (iso) => `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
  const commit = entry.commit ? `, commit ${entry.commit.slice(0, 7)}` : '';
  const again = entry.restoredAt ? ` Offered again by a roll back on ${at(entry.restoredAt)}.` : '';
  return `BannerTV from main: version ${entry.version}${commit}, published ${at(entry.publishedAt)}.${again}`;
}

/**
 * The Homebrew Channel index for one build: a "packages" list of one entry, with its manifest
 * inline (webosbrew apps-repo's PackageInfo and PackageManifest), absolute URLs, and our own
 * fields beside them, which Homebrew Channel ignores.
 */
export function buildIndex(entry, { origin = ORIGIN, channel = CHANNEL } = {}) {
  checkEntry(entry);
  const iconUri = iconUrl(entry.iconSha256, origin);
  const description = describeEntry(entry);
  return {
    packages: [
      {
        id: APP_ID,
        title: entry.title,
        iconUri,
        shortDescription: description,
        manifest: {
          id: APP_ID,
          version: entry.version,
          type: 'web',
          title: entry.title,
          appDescription: description,
          iconUri,
          ipkUrl: ipkUrl(entry.sha256, origin),
          ipkHash: { sha256: entry.sha256 },
          ipkSize: entry.ipkSize,
          rootRequired: false,
        },
        channel,
        commit: entry.commit ?? null,
        publishedAt: entry.publishedAt,
        restoredAt: entry.restoredAt ?? null,
      },
    ],
  };
}

/** The index as the Worker serves it, byte for byte. */
export const indexText = (entry, options) =>
  `${JSON.stringify(buildIndex(entry, options), null, 2)}\n`;

/**
 * Refuses when the history changed since Read the store read it: the version was chosen from
 * that history, so another publish or roll back in between (or a run's Upload started again
 * later) could otherwise use a version twice or undo a newer publish.
 */
export function checkUnchanged(history, historyNow) {
  check(
    JSON.stringify(history) === JSON.stringify(historyNow),
    'The LG history in the store changed since Read the store read it: another publish or roll back ran since. Start this workflow again.',
  );
}

function pointer(channel, history, entry, options) {
  return {
    history: { key: historyKey(channel), value: JSON.stringify(history) },
    repo: { key: repoKey(channel), value: indexText(entry, { ...options, channel }) },
  };
}

/**
 * A publish of the .ipk the build job made: the .ipk and its icon (unless stored already) to
 * upload first, then the history with this build at its head, then the index, last, so the TV
 * is never offered a build before its files are there.
 */
export function planPublish(options) {
  const {
    ipkBytes,
    build,
    version,
    commit,
    history,
    historyNow,
    stored = new Set(),
    now,
    origin = ORIGIN,
    channel = CHANNEL,
  } = options;
  if (historyNow !== undefined) checkUnchanged(history, historyNow);
  parseVersion(version);
  check(COMMIT.test(commit ?? ''), `"${commit}" is not a commit.`);
  check(
    build?.version === version && build.commit === commit,
    `Build made ${build?.version} of ${build?.commit}, not ${version} of ${commit}.`,
  );
  check(
    history.highest === null || compareVersions(version, history.highest) > 0,
    `${version} is not above ${history.highest}, the highest version published: start this workflow again so that it chooses another.`,
  );
  const sha256 = sha256Hex(ipkBytes);
  check(sha256 === build.sha256, 'The .ipk is not the one Build made: its SHA-256 differs.');
  const { title, icon } = checkIpk(ipkBytes, { version, name: build.ipkName ?? 'The .ipk' });
  const iconSha256 = sha256Hex(icon.bytes);
  check(
    iconSha256 === build.iconSha256,
    'The icon is not the one Build found: its SHA-256 differs.',
  );

  const entry = {
    version,
    sha256,
    ipkSize: ipkBytes.length,
    iconSha256,
    title,
    commit,
    publishedAt: now.toISOString(),
  };
  const files = [
    {
      key: ipkKey(sha256),
      value: ipkBytes.toString('base64'),
      base64: true,
      metadata: { version, commit },
    },
    { key: iconKey(iconSha256), value: icon.bytes.toString('base64'), base64: true },
  ];
  const content = files.filter((file) => !stored.has(file.key));
  const next = {
    highest: version,
    publishes: [entry, ...history.publishes].slice(0, HISTORY_LENGTH),
  };
  return {
    action: 'publish',
    channel,
    entry,
    previous: history.publishes[0] ?? null,
    content,
    ...pointer(channel, next, entry, { origin }),
    files: { uploaded: content.length, skipped: files.length - content.length },
  };
}

/**
 * What rollback-previous goes back to: the build before the one offered now, whose .ipk and icon
 * must still be stored. Checked by Read the store, before anything else runs.
 */
export function checkRollback({ history, stored = new Set() }) {
  check(
    history.publishes.length > 0,
    'Nothing has been published to the LG repository yet, so there is nothing to roll back.',
  );
  check(
    history.publishes.length > 1,
    `Only ${history.publishes[0].version} is left in the LG history (the builds before it were rolled back already, or there were none), so there is nothing to go back to. Publish a fix instead.`,
  );
  const previous = history.publishes[1];
  check(
    stored.has(ipkKey(previous.sha256)) && stored.has(iconKey(previous.iconSha256)),
    `The .ipk or icon of ${previous.version} is no longer in the store, so it cannot be offered again. Publish a fix instead.`,
  );
  return previous;
}

/**
 * Offers the build before the current one again, with no build: the index points at its .ipk,
 * which is stored already, and the history drops the undone build, so a second roll back steps
 * back one more. The highest version stays, so the next publish is still above the undone one.
 * The TV gets the earlier build's own, lower version, which Homebrew Channel offers as an
 * Update all the same, since it differs from the one installed.
 */
export function planRollbackPrevious(options) {
  const { history, historyNow, stored, now, origin = ORIGIN, channel = CHANNEL } = options;
  if (historyNow !== undefined) checkUnchanged(history, historyNow);
  const previous = checkRollback({ history, stored });
  const entry = { ...previous, restoredAt: now.toISOString() };
  const next = {
    highest: history.highest,
    publishes: [entry, ...history.publishes.slice(2)],
  };
  return {
    action: 'rollback-previous',
    channel,
    entry,
    previous: history.publishes[0],
    content: [],
    ...pointer(channel, next, entry, { origin }),
    files: { uploaded: 0, skipped: 0 },
  };
}

/**
 * Whether an index served by the Worker offers the build a run uploaded: the check the workflow
 * repeats until KV has reached the Worker's location.
 */
export function offers(text, { version, sha256 }) {
  try {
    const entry = JSON.parse(text)?.packages?.find((item) => item?.id === APP_ID);
    return entry?.manifest?.version === version && entry?.manifest?.ipkHash?.sha256 === sha256;
  } catch {
    return false;
  }
}

/**
 * The stored history, checked against the key listing it was fetched by: when the listing names
 * the history but no history came, it was not read, and choosing a version as if nothing had been
 * published would use one again.
 */
export function readStoredHistory(text, { stored, channel = CHANNEL }) {
  const missing = text === undefined || text === null || text.trim() === '';
  check(
    !(missing && stored.has(historyKey(channel))),
    `The store has ${historyKey(channel)}, but it was not read. Start this workflow again.`,
  );
  return readHistory(text);
}

const code = (text) => `\`${text}\``;
const shortCommit = (commit) => (commit ? `, commit ${code(commit.slice(0, 7))}` : '');

/** The run's summary in Markdown, for the workflow's summary page, with what to do on the TV. */
export function runSummary(summary, { result }) {
  const done = result === 'success';
  const rollback = summary.action === 'rollback-previous';
  const before = summary.before;
  const rows = [
    ['Result', done ? 'done' : 'failed: see the steps above'],
    ['Action', summary.action],
    [rollback ? 'Version offered again' : 'Version', code(summary.version)],
    ['Commit', summary.commit ? code(summary.commit) : '-'],
    ['.ipk SHA-256', code(summary.sha256)],
    ['.ipk size', `${summary.ipkSize} bytes`],
    [
      'Offered before this run',
      before ? `${code(before.version)}${shortCommit(before.commit)}` : 'nothing',
    ],
    ['Files uploaded', `${summary.files.uploaded} (${summary.files.skipped} stored already)`],
    ['Repository', summary.repoUrl],
  ];
  const lines = ['| | |', '| --- | --- |', ...rows.map((row) => `| ${row.join(' | ')} |`)];
  if (done) {
    lines.push(
      '',
      `**On the TV.** Homebrew Channel never looks for updates by itself. Open it (close it first if it was open, so that it reads the repository again), choose BannerTV, check that its page offers version ${code(summary.version)}, and press **Update**. Installs over the top have kept BannerTV’s data on this TV so far.`,
      '',
      `The first time only, add the repository first: in Homebrew Channel, Settings, Repositories, Add repository, ${summary.repoUrl}, or the button in BannerTV's Settings that opens that dialog filled in.`,
    );
    if (rollback) {
      lines.push(
        '',
        `The build offered again keeps its own version, ${code(summary.version)}, lower than ${before ? code(before.version) : 'the one installed'}. Homebrew Channel offers Update all the same, as the two differ. If the TV refuses to put the lower version over the higher one, revert the change on main and publish instead: a publish always goes up.`,
      );
    }
  }
  return `${lines.join('\n')}\n`;
}
