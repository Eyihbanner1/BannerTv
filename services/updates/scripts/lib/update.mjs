/**
 * What the publish workflow uploads, worked out from files alone: the manifest for an
 * `expo export`, signed with the code signing key, and the `wrangler kv bulk put` entries that
 * store it. No network, no wrangler: the workflow reads the current state with wrangler, hands
 * it in as files, and uploads what comes out. The Worker (src/protocol.ts) reads the same keys;
 * the round-trip test checks the two agree.
 *
 * Every update is signed (rsa-v1_5-sha256, over the exact UTF-8 bytes of the manifest text the
 * Worker serves). The phone app embeds the certificate and refuses anything unsigned or signed
 * by another key.
 */
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  createSign,
  createVerify,
  X509Certificate,
} from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isAbsolute, join, normalize } from 'node:path';

export const UPDATE_URL = 'https://updates.bannertv.workers.dev/expo/manifest';
export const KEY_ID = 'main';
/** How many publishes each runtime version's history keeps for rollback-previous. */
export const HISTORY_LENGTH = 20;
/** The largest value Workers KV keeps. */
export const MAX_VALUE_BYTES = 25 * 1024 * 1024;
/**
 * The most one bulk-put file holds. Wrangler sends a file's entries in one request (up to 1,000
 * of them), and the KV bulk API takes at most 100 MB a request; base64 adds a third.
 */
export const MAX_FILE_BYTES = 50 * 1000 * 1000;

// The KV keys, as src/protocol.ts names them.
const scope = (channel, platform, runtimeVersion) => `${channel}:${platform}:${runtimeVersion}`;
export const assetKey = (hash) => `asset:${hash}`;
export const manifestKey = (id) => `manifest:${id}`;
export const indexKey = (...s) => `index:${scope(...s)}`;
export const directiveKey = (...s) => `directive:${scope(...s)}`;
export const historyKey = (...s) => `history:${scope(...s)}`;

const RUNTIME_VERSION = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/;
const CHANNEL = /^[a-z0-9][a-z0-9-]{0,31}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const KEY_ID_FORM = /^[A-Za-z0-9._-]{1,64}$/;
/** Extended Key Usage: Code Signing. */
const CODE_SIGNING_USAGE = '1.3.6.1.5.5.7.3.3';
/** A file extension expo-updates can store an asset under: no dot, no separator. */
const EXTENSION = /^[A-Za-z0-9]{1,16}$/;

/** What `expo export` names an asset's type by its extension. Anything else is octet-stream. */
const CONTENT_TYPES = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  avif: 'image/avif',
  heic: 'image/heic',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  ttf: 'font/ttf',
  otf: 'font/otf',
  woff: 'font/woff',
  woff2: 'font/woff2',
  json: 'application/json',
  xml: 'application/xml',
  txt: 'text/plain',
  html: 'text/html',
  css: 'text/css',
  js: 'application/javascript',
  wasm: 'application/wasm',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
};

export function contentTypeFor(extension) {
  return CONTENT_TYPES[extension.toLowerCase()] ?? 'application/octet-stream';
}

/** SHA-256 in base64url without padding: the hash the client checks each file against. */
export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('base64url');
}

/**
 * MD5 in hex: an asset's key. Metro names each exported file by it, and the app's asset
 * registry looks files up by it, so a downloaded update finds its images under the same key.
 */
export function md5(bytes) {
  return createHash('md5').update(bytes).digest('hex');
}

/**
 * JSON with every character outside ASCII escaped: the same value, and the same bytes whatever
 * reads it, so nothing between the signature and the phone can change what was signed.
 */
export function asciiJson(value) {
  return JSON.stringify(value).replace(
    /[\u007f-￿]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
}

function check(condition, message) {
  if (!condition) throw new Error(message);
}

export function checkScope({ channel, platform, runtimeVersion }) {
  check(CHANNEL.test(channel ?? ''), `"${channel}" is not a channel (lower case, digits and -).`);
  check(platform === 'android' || platform === 'ios', `"${platform}" is not a platform.`);
  check(
    RUNTIME_VERSION.test(runtimeVersion ?? ''),
    `"${runtimeVersion}" is not a runtime version. expo-updates' runtimeversion:resolve gave none?`,
  );
}

/** The private key from its PEM text, checked against the certificate the app embeds. */
export function readSigningKey(pem, { certificate, now = new Date() } = {}) {
  let key;
  try {
    key = createPrivateKey(pem);
  } catch {
    // The message could quote the key, so it is not passed on.
    throw new Error('EXPO_UPDATES_PRIVATE_KEY is not a PEM private key.');
  }
  check(key.asymmetricKeyType === 'rsa', 'The code signing key must be RSA (rsa-v1_5-sha256).');
  if (certificate !== undefined) {
    let cert;
    try {
      cert = new X509Certificate(certificate);
    } catch {
      throw new Error('apps/mobile/certs/certificate.pem is not a PEM certificate.');
    }
    // Node names the extended key usages keyUsage. expo-updates refuses a certificate without
    // Code Signing among them, as `codesigning:generate` makes it.
    check(
      cert.keyUsage?.includes(CODE_SIGNING_USAGE),
      'apps/mobile/certs/certificate.pem is not for code signing: make it with npx expo-updates codesigning:generate.',
    );
    const der = (publicKey) => publicKey.export({ type: 'spki', format: 'der' });
    check(
      der(cert.publicKey).equals(der(createPublicKey(key))),
      'EXPO_UPDATES_PRIVATE_KEY does not belong to apps/mobile/certs/certificate.pem: phones would refuse every update.',
    );
    check(
      new Date(cert.validFrom) <= now && now <= new Date(cert.validTo),
      `apps/mobile/certs/certificate.pem is valid from ${cert.validFrom} to ${cert.validTo}: phones refuse updates outside that.`,
    );
  }
  return key;
}

/** An rsa-v1_5-sha256 signature over the text's UTF-8 bytes, in standard base64. */
export function signText(text, key) {
  return createSign('RSA-SHA256').update(text, 'utf8').sign(key, 'base64');
}

export function verifyText(text, signature, publicKey) {
  return createVerify('RSA-SHA256').update(text, 'utf8').verify(publicKey, signature, 'base64');
}

/** A path from metadata.json, read only from inside the export. */
function readInside(dir, path) {
  check(typeof path === 'string' && path !== '', 'metadata.json names a file without a path.');
  const relative = normalize(path);
  check(
    !isAbsolute(relative) && !relative.split(/[\\/]/).includes('..'),
    `metadata.json names ${path}, outside the export.`,
  );
  return readFileSync(join(dir, relative));
}

/**
 * The bundle and assets of one platform in an `expo export` folder, from its metadata.json:
 * `fileMetadata.<platform>.bundle` and `.assets` ([{path, ext}]).
 */
export function readExport(dir, platform) {
  let metadata;
  try {
    metadata = JSON.parse(readFileSync(join(dir, 'metadata.json'), 'utf8'));
  } catch {
    throw new Error(`${dir} has no readable metadata.json: run expo export first.`);
  }
  const files = metadata?.fileMetadata?.[platform];
  check(
    typeof files?.bundle === 'string' && Array.isArray(files.assets),
    `metadata.json has no ${platform} bundle: export with --platform ${platform}.`,
  );
  return {
    bundle: { path: files.bundle, bytes: readInside(dir, files.bundle) },
    assets: files.assets.map((asset) => {
      check(
        EXTENSION.test(asset?.ext ?? ''),
        `metadata.json gives ${asset?.path} the extension "${asset?.ext}".`,
      );
      return { path: asset.path, ext: asset.ext, bytes: readInside(dir, asset.path) };
    }),
  };
}

/** Where the Worker serves a file with this hash. */
export function assetUrl(updateUrl, hash) {
  return new URL(`/expo/assets/${hash}`, updateUrl).toString();
}

function describeFile(file, { launch, updateUrl, maxValueBytes }) {
  check(
    file.bytes.length <= maxValueBytes,
    `${file.path} is ${file.bytes.length} bytes, more than Workers KV keeps in one value.`,
  );
  const hash = sha256(file.bytes);
  return {
    hash,
    key: md5(file.bytes),
    contentType: launch ? 'application/javascript' : contentTypeFor(file.ext),
    // The spec has the client ignore the launch asset's extension; it is given anyway, as
    // Expo's own example server does, so the file has the name it would have from EAS.
    fileExtension: launch ? '.bundle' : `.${file.ext}`,
    url: assetUrl(updateUrl, hash),
  };
}

/** A manifest, its fields in the spec's order. */
export function buildManifest({ id, createdAt, runtimeVersion, launchAsset, assets, extra }) {
  check(UUID.test(id), `${id} is not an update id.`);
  return { id, createdAt, runtimeVersion, launchAsset, assets, metadata: {}, extra };
}

function signedEntry(key, text, signingKey, keyId) {
  return { key, value: text, metadata: { sig: signText(text, signingKey), keyid: keyId } };
}

/** The history kept for a runtime version, newest first; none is an empty list. */
export function readHistory(text) {
  if (text === undefined || text === null || text.trim() === '') return [];
  let list;
  try {
    list = JSON.parse(text);
  } catch {
    throw new Error('The stored history is not JSON.');
  }
  check(Array.isArray(list), 'The stored history is not a list.');
  for (const entry of list) {
    check(
      UUID.test(entry?.id ?? '') && typeof entry.createdAt === 'string',
      'A history entry has no id.',
    );
  }
  return list;
}

/** The keys a `wrangler kv key list` answer names. */
export function readKeyList(text) {
  if (text === undefined || text === null || text.trim() === '') return new Set();
  const list = JSON.parse(text);
  check(Array.isArray(list), 'The key list is not a list.');
  return new Set(list.map((item) => (typeof item === 'string' ? item : item?.name)));
}

function pointerEntries(scopeArgs, id, createdAt, history) {
  return [
    { key: indexKey(...scopeArgs), value: JSON.stringify({ id, createdAt }) },
    { key: historyKey(...scopeArgs), value: JSON.stringify(history.slice(0, HISTORY_LENGTH)) },
  ];
}

/**
 * A new update from an `expo export` folder. Files the store already has (`stored`, its keys)
 * are left out of the upload: their addresses are their hashes, so what is there is the same.
 */
export function planPublish(options) {
  const {
    exportDir,
    platform = 'android',
    channel,
    runtimeVersion,
    expoClient,
    commit,
    signingKey,
    keyId = KEY_ID,
    id,
    now,
    history = [],
    stored = new Set(),
    updateUrl = UPDATE_URL,
    maxValueBytes = MAX_VALUE_BYTES,
  } = options;
  checkScope({ channel, platform, runtimeVersion });
  check(KEY_ID_FORM.test(keyId), `"${keyId}" is not a key id.`);
  check(
    expoClient !== null && typeof expoClient === 'object' && !Array.isArray(expoClient),
    'The app config (expo config --type public --json) is not an object.',
  );
  const files = readExport(exportDir, platform);
  const describe = (file, launch) => describeFile(file, { launch, updateUrl, maxValueBytes });

  const launchAsset = describe(files.bundle, true);
  const assets = [];
  const seenKeys = new Set([launchAsset.key]);
  const upload = new Map([
    [launchAsset.hash, { file: files.bundle, type: launchAsset.contentType }],
  ]);
  for (const file of files.assets) {
    const asset = describe(file, false);
    // Two paths with the same bytes are one asset to the client, which keys them by hash.
    if (seenKeys.has(asset.key)) continue;
    seenKeys.add(asset.key);
    assets.push(asset);
    if (!upload.has(asset.hash)) upload.set(asset.hash, { file, type: asset.contentType });
  }

  const createdAt = now.toISOString();
  const manifest = buildManifest({
    id,
    createdAt,
    runtimeVersion,
    launchAsset,
    assets,
    extra: { expoClient },
  });
  const manifestText = asciiJson(manifest);

  const content = [];
  let skipped = 0;
  for (const [hash, { file, type }] of upload) {
    if (stored.has(assetKey(hash))) {
      skipped += 1;
      continue;
    }
    content.push({
      key: assetKey(hash),
      value: file.bytes.toString('base64'),
      base64: true,
      metadata: { contentType: type },
    });
  }
  content.push(signedEntry(manifestKey(id), manifestText, signingKey, keyId));

  const scopeArgs = [channel, platform, runtimeVersion];
  const entry = { id, createdAt, commit: commit ?? null };
  return {
    action: 'publish',
    id,
    createdAt,
    commit: entry.commit,
    channel,
    platform,
    runtimeVersion,
    manifestText,
    content,
    pointer: pointerEntries(scopeArgs, id, createdAt, [entry, ...history]),
    files: { uploaded: content.length - 1, skipped },
  };
}

/** The id rollback-previous goes back to: the update before the current one. */
export function previousId(history) {
  check(
    history.length >= 2,
    history.length === 0
      ? 'Nothing was published for this runtime version, so there is nothing to roll back.'
      : 'Only one update was published for this runtime version: roll back to the app’s own update instead.',
  );
  return history[1].id;
}

/**
 * Undoes the last publish: the update before it is published again under a new id and time,
 * because a phone takes only an update newer than the one it runs. Its files are already
 * stored. The history drops the undone update, so a second roll back steps back one more.
 */
export function planRollbackPrevious(options) {
  const {
    platform = 'android',
    channel,
    runtimeVersion,
    history,
    previousManifestText,
    signingKey,
    keyId = KEY_ID,
    id,
    now,
  } = options;
  checkScope({ channel, platform, runtimeVersion });
  previousId(history);
  const previous = history[1];
  let old;
  try {
    old = JSON.parse(previousManifestText);
  } catch {
    throw new Error(`The stored manifest ${previous.id} is not JSON.`);
  }
  check(old?.id === previous.id, `The manifest given is ${old?.id}, not ${previous.id}.`);
  check(
    old.runtimeVersion === runtimeVersion,
    `Manifest ${old.id} is for runtime version ${old.runtimeVersion}, not ${runtimeVersion}.`,
  );
  const createdAt = now.toISOString();
  const manifest = buildManifest({
    id,
    createdAt,
    runtimeVersion,
    launchAsset: old.launchAsset,
    assets: old.assets,
    extra: old.extra,
  });
  const manifestText = asciiJson(manifest);
  const entry = {
    id,
    createdAt,
    commit: previous.commit ?? null,
    republishOf: previous.republishOf ?? previous.id,
  };
  return {
    action: 'rollback-previous',
    id,
    createdAt,
    commit: entry.commit,
    channel,
    platform,
    runtimeVersion,
    republishOf: entry.republishOf,
    manifestText,
    content: [signedEntry(manifestKey(id), manifestText, signingKey, keyId)],
    pointer: pointerEntries([channel, platform, runtimeVersion], id, createdAt, [
      entry,
      ...history.slice(2),
    ]),
    files: { uploaded: 0, skipped: 0 },
  };
}

/**
 * Sends phones on this runtime version back to the update inside the app. It wins over the
 * current update because it is newer; the next publish wins over it the same way.
 */
export function planRollbackToEmbedded(options) {
  const {
    platform = 'android',
    channel,
    runtimeVersion,
    signingKey,
    keyId = KEY_ID,
    now,
  } = options;
  checkScope({ channel, platform, runtimeVersion });
  const commitTime = now.toISOString();
  const text = asciiJson({ type: 'rollBackToEmbedded', parameters: { commitTime } });
  return {
    action: 'rollback-to-embedded',
    createdAt: commitTime,
    channel,
    platform,
    runtimeVersion,
    directiveText: text,
    content: [],
    pointer: [
      signedEntry(directiveKey(channel, platform, runtimeVersion), text, signingKey, keyId),
    ],
    files: { uploaded: 0, skipped: 0 },
  };
}

/** Entries in files of at most `maxBytes` of JSON each, in order. */
export function chunkEntries(entries, maxBytes = MAX_FILE_BYTES) {
  const files = [];
  let current = [];
  let size = 2;
  for (const entry of entries) {
    const bytes = Buffer.byteLength(JSON.stringify(entry)) + 1;
    if (current.length > 0 && (size + bytes > maxBytes || current.length === 1000)) {
      files.push(current);
      current = [];
      size = 2;
    }
    current.push(entry);
    size += bytes;
  }
  if (current.length > 0) files.push(current);
  return files;
}
