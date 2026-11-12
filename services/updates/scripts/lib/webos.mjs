/**
 * What the "Publish LG update" workflow uploads for the LG TV's Homebrew Channel repository,
 * worked out from files alone: the version a publish stamps into the app, the checks on the
 * .ipk the build made, the index Homebrew Channel reads, and the `wrangler kv bulk put` entries
 * that store it all. No network, no wrangler and Node's own modules only, so the jobs that hold
 * the Cloudflare token can run it from their own checkout with no install. The workflow reads
 * the store with wrangler, hands it in as files, and uploads what comes out. The Worker
 * (src/webos.ts) reads the same keys; the round-trip test checks the two agree.
 *
 * Homebrew Channel installs an .ipk only when the file it downloads has the SHA-256 the index
 * gives, and the index comes over HTTPS from our Worker: nothing of that is signed. In-app
 * updates are (apps/webos/src/shell): the same publish also signs the scripts of its build with
 * the LG update key, which only the Sign job holds, and the app's loader checks that signature
 * with the public key in its own index.html before it stores or runs anything.
 */
import { createHash, createPrivateKey, createPublicKey, randomUUID } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { asciiJson, MAX_VALUE_BYTES, signText, UPDATE_URL, verifyText } from './update.mjs';

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
  if (entry.update !== undefined && entry.update !== null)
    checkAppUpdate(entry.update, entry.version);
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

// In-app updates, as the app's loader takes them (apps/webos/src/shell/signed.ts reads them) and
// the Worker serves them (src/webos.ts).

export const UPDATE_TYPE = 'bannertv-lg-update';
export const BUILT_IN_TYPE = 'bannertv-lg-built-in';
export const PLATFORM = 'webos';
/** The repository secret that holds the private half of apps/webos/certs/lg-updates.pem. */
export const KEY_SECRET = 'LG_UPDATES_PRIVATE_KEY';
export const PUBLIC_KEY_PATH = 'apps/webos/certs/lg-updates.pem';
/** Where the loader asks, as apps/webos/build/shell.ts builds it into index.html. */
export const APP_BASE_URL = `${ORIGIN}/webos/`;

export const appKey = (runtime, channel = CHANNEL) => `webos/app/${channel}/${runtime}`;
export const appFileKey = (sha256) => `webos/file/${sha256}`;
export const appUrl = (runtime, { origin = ORIGIN, channel = CHANNEL } = {}) =>
  `${origin}/webos/update?channel=${channel}&runtime=${runtime}`;
export const appFileUrl = (sha256, origin = ORIGIN) => `${origin}/webos/file/${sha256}`;

/** What apps/webos/build/shell.ts names a runtime version. */
const RUNTIME = /^webos-\d{1,4}-[0-9a-f]{16}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const KEY_ID = /^lg-[0-9a-f]{16}$/;
// The loader's own limits (apps/webos/src/shell/signed.ts): it refuses anything past them.
const APP_FILE = /^(assets|vendor|data)\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.js$/;
const MAX_APP_FILES = 16;
const MAX_APP_FILE_BYTES = 16 * 1024 * 1024;
const MAX_APP_BYTES = 32 * 1024 * 1024;
const SHELL_CONFIG = /<script id="bannertv-shell" type="application\/json">([^<]*)<\/script>/;

/** An update's files, as the loader holds them: scripts by a plain path, each by SHA-256 and size. */
function checkAppFiles(files, what) {
  check(
    files !== null && typeof files === 'object' && !Array.isArray(files),
    `${what} names no files.`,
  );
  const paths = Object.keys(files);
  check(
    paths.length > 0 && paths.length <= MAX_APP_FILES,
    `${what} names ${paths.length} files, not 1 to ${MAX_APP_FILES}.`,
  );
  let total = 0;
  for (const path of paths) {
    check(
      APP_FILE.test(path) && !path.includes('..'),
      `${what} names ${path}, not a script it can carry.`,
    );
    const file = files[path];
    check(isSha256Hex(file?.sha256), `${what} gives ${path} no SHA-256.`);
    check(
      Number.isInteger(file.size) && file.size > 0 && file.size <= MAX_APP_FILE_BYTES,
      `${what} gives ${path} a size the TV refuses.`,
    );
    total += file.size;
  }
  check(total <= MAX_APP_BYTES, `${what}'s files come to ${total} bytes, more than the TV takes.`);
}

/** What a history entry, a signed folder or a plan says of the in-app update it carries. */
function checkAppUpdate(update, version) {
  const what = `The in-app update of ${version}`;
  check(update !== null && typeof update === 'object', `${what} is not an object.`);
  check(update.kind === 'update' || update.kind === 'built-in', `${what} is neither kind.`);
  check(RUNTIME.test(update.runtime ?? ''), `${what} has no runtime version.`);
  check(KEY_ID.test(update.keyId ?? ''), `${what} names no key.`);
  check(
    typeof update.createdAt === 'string' && !Number.isNaN(Date.parse(update.createdAt)),
    `${what} has no time.`,
  );
  if (update.kind === 'built-in') return;
  check(UUID.test(update.id ?? ''), `${what} has no id.`);
  parseVersion(update.version, `${what}'s version`);
  check(update.commit === null || COMMIT.test(update.commit ?? ''), `${what} has no commit.`);
  checkAppFiles(update.files, what);
  check(
    typeof update.launch === 'string' &&
      update.launch.startsWith('assets/') &&
      update.files[update.launch],
    `${what} launches ${update.launch}, not a script it names in assets/.`,
  );
}

/** Every script an update names, read by its path and held to its SHA-256 and size. */
export function checkUpdateFiles(files, readFile) {
  for (const [path, file] of Object.entries(files)) {
    let bytes;
    try {
      bytes = readFile(path, file);
    } catch {
      throw new Error(`${path} is not in the build.`);
    }
    check(
      bytes.length === file.size && sha256Hex(bytes) === file.sha256,
      `${path} is not the file the shell config names.`,
    );
  }
}

/** The shell config a built index.html carries (apps/webos/build/shell.ts writes it). */
export function readShellConfig(html) {
  const text = SHELL_CONFIG.exec(html)?.[1];
  check(text !== undefined, 'index.html carries no shell config: was it built with the loader?');
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('The shell config in index.html is not JSON.');
  }
}

/** The LG update key's public half, from apps/webos/certs/lg-updates.pem. */
export function readLgPublicKey(pem) {
  let key;
  try {
    key = createPublicKey(pem);
  } catch {
    throw new Error(`${PUBLIC_KEY_PATH} is not a PEM public key.`);
  }
  check(
    key.asymmetricKeyType === 'rsa',
    `${PUBLIC_KEY_PATH} must be an RSA key (rsa-v1_5-sha256).`,
  );
  return key;
}

/** The key's id as the build names it (apps/webos/build/shell.ts): 16 hex digits of the SPKI's SHA-256. */
export function lgKeyId(publicKey) {
  return `lg-${sha256Hex(publicKey.export({ type: 'spki', format: 'der' })).slice(0, 16)}`;
}

/** The private key from the secret, checked against the committed public key. */
export function readLgSigningKey(pem, publicKey) {
  let key;
  try {
    key = createPrivateKey(pem);
  } catch {
    // The message could quote the key, so it is not passed on.
    throw new Error(`${KEY_SECRET} is not a PEM private key.`);
  }
  check(key.asymmetricKeyType === 'rsa', `${KEY_SECRET} must be an RSA key (rsa-v1_5-sha256).`);
  const der = (k) => k.export({ type: 'spki', format: 'der' });
  check(
    der(createPublicKey(key)).equals(der(publicKey)),
    `${KEY_SECRET} does not belong to ${PUBLIC_KEY_PATH}: TVs would refuse every update.`,
  );
  return key;
}

/**
 * What Build says the in-app update in its bundle is, from index.html's shell config, with every
 * script it names checked against the file in the build folder. `updates` is null when the build
 * takes none (no key committed, or LG_UPDATES_IN_BUILD off), and then nothing is signed.
 */
export function describeUpdate({ html, readFile, version, commit }) {
  const config = readShellConfig(html);
  check(config.contract === 1, `The shell config is contract ${config.contract}, not 1.`);
  check(RUNTIME.test(config.runtime ?? ''), `The shell config has no runtime version.`);
  check(
    config.build?.version === version && config.build.commit === commit,
    `The build is ${config.build?.version} of ${config.build?.commit}, not ${version} of ${commit}: was the version stamped before the build?`,
  );
  check(
    typeof config.build.builtAt === 'string' && !Number.isNaN(Date.parse(config.build.builtAt)),
    'The shell config has no build time.',
  );
  checkAppFiles(config.files, 'The build');
  check(
    typeof config.launch === 'string' &&
      config.launch.startsWith('assets/') &&
      config.files[config.launch],
    `The build launches ${config.launch}, not a script it names in assets/.`,
  );
  checkUpdateFiles(config.files, readFile);
  const updates = config.updates;
  if (updates !== null) {
    check(updates?.channel === CHANNEL, `The build follows ${updates?.channel}, not ${CHANNEL}.`);
    check(updates.url === APP_BASE_URL, `The build asks ${updates.url}, not ${APP_BASE_URL}.`);
    check(KEY_ID.test(updates.keyId ?? ''), 'The build names no update key.');
  }
  return {
    runtime: config.runtime,
    version,
    commit,
    builtAt: config.build.builtAt,
    launch: config.launch,
    files: config.files,
    updates: updates === null ? null : { channel: updates.channel, keyId: updates.keyId },
  };
}

/** A manifest's text as signed: ASCII only, so its bytes are the same wherever it is read. */
export function appManifestText(update, channel = CHANNEL) {
  return asciiJson({
    type: UPDATE_TYPE,
    id: update.id,
    createdAt: update.createdAt,
    channel,
    platform: PLATFORM,
    runtime: update.runtime,
    version: update.version,
    commit: update.commit,
    launch: update.launch,
    files: update.files,
  });
}

/** A directive's text: TVs on this runtime go back to their own .ipk's code. */
export function directiveText(update, channel = CHANNEL) {
  return asciiJson({
    type: BUILT_IN_TYPE,
    createdAt: update.createdAt,
    channel,
    platform: PLATFORM,
    runtime: update.runtime,
  });
}

const textOf = (update) =>
  update.kind === 'update' ? appManifestText(update) : directiveText(update);

/** The Worker's answer, exactly as it serves it: the signed text, its signature and the key's id. */
function answerText(update, privateKey) {
  const text = textOf(update);
  const field = update.kind === 'update' ? 'manifest' : 'directive';
  return JSON.stringify({ [field]: text, sig: signText(text, privateKey), keyid: update.keyId });
}

/**
 * Signs the update Build described, in Sign (the one job with the key). Its time is now, after
 * the build, so TVs on an earlier .ipk of the same runtime take it; a TV on this very .ipk sees
 * its own files and takes nothing.
 */
export function signUpdate({ description, privateKey, publicKey, now, id = randomUUID() }) {
  check(description.updates, 'This build takes no in-app updates, so there is nothing to sign.');
  const keyId = lgKeyId(publicKey);
  check(
    description.updates.keyId === keyId,
    `The build carries the key ${description.updates.keyId}, but ${PUBLIC_KEY_PATH} is ${keyId}.`,
  );
  const createdAt = now.toISOString();
  check(
    Date.parse(createdAt) > Date.parse(description.builtAt),
    `The build says it was made at ${description.builtAt}, after now (${createdAt}).`,
  );
  const update = {
    kind: 'update',
    runtime: description.runtime,
    keyId,
    id,
    createdAt,
    version: description.version,
    commit: description.commit,
    launch: description.launch,
    files: description.files,
  };
  checkAppUpdate(update, description.version);
  return { off: false, update, body: answerText(update, privateKey) };
}

/** Why a run signs nothing, for the summary. */
export const signedOff = (reason) => ({ off: true, reason });

/**
 * What a roll back sends TVs that run in-app updates, signed in Sign: the build before the
 * current one again, with a new id and time so TVs take it, when it was an update of the same
 * runtime whose scripts are still stored; otherwise a directive that sends TVs on the current
 * runtime back to their own .ipk's code. Nothing when the current build took no in-app update.
 */
export function signRollback({ history, stored, privateKey, publicKey, now, id = randomUUID() }) {
  const previous = checkRollback({ history, stored });
  const current = history.publishes[0].update;
  if (!current) {
    return signedOff(
      `${history.publishes[0].version} went out through Homebrew Channel only, so there is no in-app update to undo.`,
    );
  }
  const keyId = lgKeyId(publicKey);
  const createdAt = now.toISOString();
  const back = previous.update;
  const again =
    back?.kind === 'update' &&
    back.runtime === current.runtime &&
    Object.values(back.files).every((file) => stored.has(appFileKey(file.sha256)));
  const update = again
    ? { ...back, keyId, id, createdAt }
    : { kind: 'built-in', runtime: current.runtime, keyId, createdAt };
  checkAppUpdate(update, previous.version);
  return { off: false, update, body: answerText(update, privateKey) };
}

/**
 * A signed folder from Sign, checked in Upload as data: its signature against the committed
 * public key, and its text against what it says it is.
 */
export function checkSigned(signed, publicKey) {
  check(signed !== null && typeof signed === 'object', 'Sign wrote no signed.json.');
  if (signed.off) return null;
  const { update, body } = signed;
  checkAppUpdate(update, update?.version ?? 'this run');
  check(
    update.keyId === lgKeyId(publicKey),
    `Sign used the key ${update.keyId}, not ${PUBLIC_KEY_PATH}'s.`,
  );
  let answer;
  try {
    answer = JSON.parse(body);
  } catch {
    throw new Error('The signed answer is not JSON.');
  }
  const field = update.kind === 'update' ? 'manifest' : 'directive';
  check(
    answer?.[field] === textOf(update) && answer.keyid === update.keyId,
    'The signed answer is not the update Sign says it signed.',
  );
  check(
    typeof answer.sig === 'string' && verifyText(answer[field], answer.sig, publicKey),
    `The signed answer does not verify with ${PUBLIC_KEY_PATH}.`,
  );
  return { update, body };
}

/**
 * The upload entries of an in-app update: its scripts not stored already, from the files Build
 * handed on (by SHA-256), and the answer itself, which goes after the history.
 */
function appParts({ signed, appFiles, stored, channel }) {
  const files = Object.values(signed.update.kind === 'update' ? signed.update.files : {});
  const content = [];
  let skipped = 0;
  for (const file of files) {
    const key = appFileKey(file.sha256);
    if (stored.has(key)) {
      skipped++;
      continue;
    }
    const bytes = appFiles?.(file.sha256);
    check(bytes, `Build handed on no script with SHA-256 ${file.sha256}.`);
    check(
      bytes.length === file.size && sha256Hex(bytes) === file.sha256,
      `The script ${file.sha256} Build handed on is not the one the update names.`,
    );
    content.push({ key, value: bytes.toString('base64'), base64: true });
  }
  return {
    content,
    skipped,
    app: { key: appKey(signed.update.runtime, channel), value: signed.body },
  };
}

/** Whether the Worker serves the answer a run uploaded, byte for byte. */
export const servesApp = (served, app) => served === app.value;

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

/** What the summary says of a run's in-app update. */
function appSummary(signed, app, parts) {
  if (!app) return { off: true, reason: signed?.reason ?? 'Nothing was signed.' };
  const { update } = app;
  return {
    off: false,
    kind: update.kind,
    runtime: update.runtime,
    id: update.id ?? null,
    version: update.version ?? null,
    createdAt: update.createdAt,
    url: appUrl(update.runtime),
    files: update.kind === 'update' ? Object.values(update.files).map((file) => file.sha256) : [],
    uploaded: parts.content.length,
  };
}

/**
 * A publish of the .ipk the build job made: the .ipk and its icon (unless stored already) and the
 * in-app update's scripts to upload first, then the history with this build at its head, then the
 * in-app update's signed answer, then the index, last, so neither the app nor Homebrew Channel is
 * offered a build before its files are there. `signed` is what Sign wrote (none, or off, when the
 * build takes no in-app updates), `publicKey` the committed LG key, and `appFiles` gives the
 * scripts Build handed on by their SHA-256.
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
    signed,
    publicKey,
    appFiles,
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
  const app = signed === undefined ? null : checkSigned(signed, publicKey);
  if (app) {
    check(
      app.update.kind === 'update' &&
        app.update.version === version &&
        app.update.commit === commit,
      `Sign signed ${app.update.version ?? 'a directive'} of ${app.update.commit}, not ${version} of ${commit}.`,
    );
    entry.update = app.update;
  }
  const parts = app ? appParts({ signed: app, appFiles, stored, channel }) : null;
  const files = [
    {
      key: ipkKey(sha256),
      value: ipkBytes.toString('base64'),
      base64: true,
      metadata: { version, commit },
    },
    { key: iconKey(iconSha256), value: icon.bytes.toString('base64'), base64: true },
  ];
  const content = [...files.filter((file) => !stored.has(file.key)), ...(parts?.content ?? [])];
  const next = {
    highest: version,
    publishes: [entry, ...history.publishes].slice(0, HISTORY_LENGTH),
  };
  const all = files.length + (parts ? parts.content.length + parts.skipped : 0);
  return {
    action: 'publish',
    channel,
    entry,
    previous: history.publishes[0] ?? null,
    content,
    ...pointer(channel, next, entry, { origin }),
    app: parts?.app ?? null,
    inApp: appSummary(signed, app, parts),
    files: { uploaded: content.length, skipped: all - content.length },
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
  const {
    history,
    historyNow,
    stored = new Set(),
    now,
    origin = ORIGIN,
    channel = CHANNEL,
    signed,
    publicKey,
  } = options;
  if (historyNow !== undefined) checkUnchanged(history, historyNow);
  const previous = checkRollback({ history, stored });
  const entry = { ...previous, restoredAt: now.toISOString() };
  const app = signed === undefined ? null : checkSigned(signed, publicKey);
  if (app) {
    const current = history.publishes[0].update;
    check(
      current && app.update.runtime === current.runtime,
      `Sign signed a roll back for ${app.update.runtime}, not the runtime of ${history.publishes[0].version}.`,
    );
    check(
      app.update.kind === 'built-in' || app.update.version === previous.version,
      `Sign signed ${app.update.version}, not ${previous.version}, the build gone back to.`,
    );
    entry.update = app.update;
  }
  // The scripts of an update offered again are stored already: Sign checked them all.
  const parts = app ? appParts({ signed: app, stored, channel }) : null;
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
    app: parts?.app ?? null,
    inApp: appSummary(signed, app, parts),
    files: { uploaded: 0, skipped: parts?.skipped ?? 0 },
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

function inAppLine(inApp) {
  if (!inApp) return '-';
  if (inApp.off) return `none: ${inApp.reason}`;
  if (inApp.kind === 'built-in')
    return `back to each TV's own .ipk, runtime ${code(inApp.runtime)}`;
  return `${code(inApp.version)}, runtime ${code(inApp.runtime)}, id ${code(inApp.id)}, ${inApp.uploaded} of ${inApp.files.length} scripts uploaded`;
}

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
    ['In-app update', inAppLine(summary.inApp)],
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
    const inApp = summary.inApp;
    if (inApp && !inApp.off) {
      lines.push(
        '',
        inApp.kind === 'update'
          ? `**Without Homebrew Channel.** A TV running a BannerTV that takes in-app updates (runtime ${code(inApp.runtime)}) downloads ${code(inApp.version)} by itself within a minute of starting, or every three hours, or when Settings opens, and starts it on Settings, after a minute off screen, or the next time BannerTV starts. Settings says when it is downloading and starting.`
          : `**Without Homebrew Channel.** A TV running an in-app update of runtime ${code(inApp.runtime)} goes back to the code of the .ipk installed on it, on Settings, after a minute off screen, or the next time BannerTV starts. A TV that installed the undone .ipk itself runs it until Update is pressed in Homebrew Channel.`,
      );
    }
  }
  return `${lines.join('\n')}\n`;
}
