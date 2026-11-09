/**
 * A small .ipk for the tests, laid out as ares-package 3 writes one: an ar archive of
 * debian-binary, control.tar.gz (one file, control) and data.tar.gz (the app under
 * usr/palm/applications/<id>/ and its packageinfo.json). Options make the odd ones a reader
 * must still take, and the broken ones it must refuse.
 */
import { gzipSync } from 'node:zlib';

/** A PNG signature and a few bytes: enough for a reader that checks the signature. */
export const ICON = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('icon 130 px'),
]);

function octal(value, length) {
  return `${value.toString(8).padStart(length - 1, '0')}\0`;
}

/** One 512-byte tar header, with its checksum. */
function header(name, size, type, { ustar = true } = {}) {
  const block = Buffer.alloc(512);
  block.write(name.slice(0, 100), 0, 'utf8');
  block.write(octal(0o644, 8), 100);
  block.write(octal(0, 8), 108);
  block.write(octal(0, 8), 116);
  block.write(octal(size, 12), 124);
  block.write(octal(1794252057, 12), 136);
  block.fill(' ', 148, 156);
  block.write(type, 156);
  if (ustar) block.write('ustar\u000000', 257, 'latin1');
  let sum = 0;
  for (const byte of block) sum += byte;
  block.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 'latin1');
  return block;
}

const pad = (bytes) => Buffer.concat([bytes, Buffer.alloc((512 - (bytes.length % 512)) % 512)]);

/**
 * A tar archive of the files given ({path: bytes}, a directory as a path ending in "/"). A path
 * over 100 bytes gets a GNU long-name entry before it, as GNU tar writes one.
 */
export function tar(files, { prefix = '' } = {}) {
  const blocks = [];
  for (const [path, bytes] of Object.entries(files)) {
    const name = `${prefix}${path}`;
    if (path.endsWith('/')) {
      blocks.push(header(name, 0, '5'));
      continue;
    }
    if (Buffer.byteLength(name) > 100) {
      const long = Buffer.from(`${name}\0`);
      blocks.push(header('././@LongLink', long.length, 'L'), pad(long));
    }
    blocks.push(header(name, bytes.length, '0'), pad(bytes));
  }
  return Buffer.concat([...blocks, Buffer.alloc(1024)]);
}

/** An ar archive, names padded with spaces as ares-package writes them, or ended by "/". */
export function ar(members, { gnu = false } = {}) {
  const parts = [Buffer.from('!<arch>\n')];
  for (const [name, bytes] of Object.entries(members)) {
    const field = (value, length) => String(value).padEnd(length, ' ');
    parts.push(
      Buffer.from(
        `${field(gnu ? `${name}/` : name, 16)}${field(1794252057, 12)}${field(0, 6)}${field(0, 6)}${field(100644, 8)}${field(bytes.length, 10)}\`\n`,
        'latin1',
      ),
      bytes,
    );
    if (bytes.length % 2 === 1) parts.push(Buffer.from('\n'));
  }
  return Buffer.concat(parts);
}

/** The control file ares-package writes. */
export function control({ id, version }) {
  return [
    `Package: ${id}`,
    `Version: ${version}`,
    'Section: misc',
    'Priority: optional',
    'Architecture: all',
    'Installed-Size: 3155697',
    'Maintainer: N/A <nobody@example.com>',
    'Description: This is a webOS application.',
    ' A continued line.',
    'webOS-Package-Format-Version: 2',
    'webOS-Packager-Version: x.y.x',
    '',
  ].join('\n');
}

export function makeIpk(options = {}) {
  const {
    id = 'com.bannertv.app',
    version = '0.1.1',
    controlVersion = version,
    appinfo: extra = {},
    icon = ICON,
    // Bytes that differ between builds, as the bundle does.
    bundle = Buffer.from(`bundle of ${version}`),
    prefix = '',
    gnu = false,
    longPath = false,
  } = options;
  const appinfo = {
    id,
    version,
    vendor: 'BannerTV',
    type: 'web',
    main: 'index.html',
    title: 'BannerTV',
    icon: 'icon_80.png',
    largeIcon: 'icon_130.png',
    ...extra,
  };
  const dir = `usr/palm/applications/${id}/`;
  const data = {
    'usr/': null,
    'usr/palm/': null,
    'usr/palm/applications/': null,
    [dir]: null,
    [`${dir}appinfo.json`]: Buffer.from(JSON.stringify(appinfo, null, 2)),
    [`${dir}icon_80.png`]: ICON.subarray(0, 9),
    [`${dir}index.html`]: Buffer.from('<!doctype html>'),
    [`${dir}assets/index.js`]: bundle,
    [`usr/palm/packages/${id}/packageinfo.json`]: Buffer.from(JSON.stringify({ id, version })),
  };
  if (icon !== null) data[`${dir}${appinfo.largeIcon}`] = icon;
  if (longPath) data[`${dir}assets/${'a-long-name-'.repeat(10)}.js`] = Buffer.from('long');
  for (const path of Object.keys(data)) if (data[path] === null) data[path] = Buffer.alloc(0);
  return ar(
    {
      'debian-binary': Buffer.from('2.0\n'),
      'control.tar.gz': gzipSync(
        tar({ control: Buffer.from(control({ id, version: controlVersion })) }, { prefix }),
      ),
      'data.tar.gz': gzipSync(tar(data, { prefix })),
    },
    { gnu },
  );
}
