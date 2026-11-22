// Turns the LG app's web build into a Samsung TV app: a .wgt, which is a zip
// of the web files with config.xml beside index.html (ADR 0009). Nothing here
// needs Tizen Studio. The .wgt is unsigned: Samsung TVs install only what a
// certificate made for that TV signed, so the tool that installs it signs it
// (docs/SAMSUNG_TV_SETUP.md).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { crc32, deflateRawSync } from 'node:zlib';

/** What only the LG reads: its app description, launcher icons and splash. */
export const WEBOS_ONLY = new Set([
  'appinfo.json',
  'icon_80.png',
  'icon_130.png',
  'splash_1920x1080.png',
]);

/** Samsung's product API (model, 4K panel, HDR), which the TV serves from this address. */
export const WEBAPIS_SCRIPT = '<script src="$WEBAPIS/webapis/webapis.js"></script>';

/** The loader index.html starts the app with (apps/webos/build/shell.ts). */
const LOADER_TAG = /<script\b[^>]*\bsrc="\.\/loader\.js"/;

/**
 * Tizen's version rule: three numbers, at most 255, 255 and 65535. A test build
 * can put a counter in the last, as the release workflow does.
 */
export function checkVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match || Number(match[1]) > 255 || Number(match[2]) > 255 || Number(match[3]) > 65535) {
    throw new Error(`"${version}" is no Tizen version: major.minor.patch, at most 255.255.65535`);
  }
  return version;
}

/** config.xml with the version in. */
export function configXml(template, version) {
  if (!template.includes('{{version}}'))
    throw new Error('config.xml has no {{version}} to fill in');
  return template.replace('{{version}}', checkVersion(version));
}

/**
 * index.html with Samsung's script before the loader, so `webapis` is there
 * when the app first asks (apps/webos/src/platform/tizen.ts). The build's own
 * index.html stays as it is: the LG and Android never see this.
 */
export function tizenIndexHtml(html) {
  const loader = LOADER_TAG.exec(html);
  if (!loader) throw new Error('index.html does not start ./loader.js: is this the web build?');
  return `${html.slice(0, loader.index)}${WEBAPIS_SCRIPT}\n    ${html.slice(loader.index)}`;
}

/** Every file under `dir`, as forward-slash paths relative to it, in a fixed order. */
export function listFiles(dir) {
  const walk = (folder) =>
    readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
      const path = join(folder, entry.name);
      return entry.isDirectory() ? walk(path) : [relative(dir, path).split(sep).join('/')];
    });
  return walk(dir).sort();
}

/**
 * The .wgt's files, as { path: bytes }: the web build without the LG's own
 * files, index.html with Samsung's script, config.xml and the icon.
 */
export function wgtEntries({ dist, template, icon, version }) {
  const files = listFiles(dist);
  if (!files.includes('index.html') || !files.includes('loader.js')) {
    throw new Error(`${dist} holds no web build: run pnpm build first`);
  }
  const entries = { 'config.xml': Buffer.from(configXml(template, version)), 'icon.png': icon };
  for (const path of files) {
    if (WEBOS_ONLY.has(path) || path === 'config.xml' || path === 'icon.png') continue;
    const bytes = readFileSync(join(dist, path));
    entries[path] =
      path === 'index.html' ? Buffer.from(tizenIndexHtml(bytes.toString('utf8'))) : bytes;
  }
  return entries;
}

/** 1 January 2020, as MS-DOS writes a time: every build of the same files gives the same .wgt. */
const DOS_TIME = 0;
const DOS_DATE = ((2020 - 1980) << 9) | (1 << 5) | 1;

/**
 * A zip of `entries` ({ path: bytes }), each deflated unless that would not
 * make it smaller. Paths are stored as given, in UTF-8.
 */
export function zip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [path, data] of Object.entries(entries)) {
    const name = Buffer.from(path, 'utf8');
    const deflated = deflateRawSync(data, { level: 9 });
    const stored = deflated.length >= data.length;
    const body = stored ? data : deflated;
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed: 2.0
    local.writeUInt16LE(0x0800, 6); // the name is UTF-8
    local.writeUInt16LE(stored ? 0 : 8, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE((3 << 8) | 20, 4); // made on Unix, zip 2.0
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(stored ? 0 : 8, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    // Extra field, comment, disk number and internal attributes stay 0.
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38); // a plain file, rw-r--r--
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + body.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  const count = Object.keys(entries).length;
  end.writeUInt16LE(count, 8);
  end.writeUInt16LE(count, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

/** The version the LG app is at, from its appinfo.json. */
export function appVersion(appinfoPath) {
  return JSON.parse(readFileSync(appinfoPath, 'utf8')).version;
}

/** Whether `path` is a folder. */
export function isFolder(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}
