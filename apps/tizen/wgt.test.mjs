import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, describe, it } from 'node:test';
import { crc32, inflateRawSync } from 'node:zlib';
import {
  checkVersion,
  configXml,
  tizenIndexHtml,
  WEBAPIS_SCRIPT,
  wgtEntries,
  zip,
} from './wgt.mjs';

const template = readFileSync(resolve(import.meta.dirname, 'config.xml'), 'utf8');

/** Reads a zip back through its central directory, checking each file's CRC. */
function unzip(bytes) {
  const end = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(end >= 0, 'no end of central directory');
  const count = bytes.readUInt16LE(end + 10);
  let at = bytes.readUInt32LE(end + 16);
  const files = {};
  for (let i = 0; i < count; i++) {
    assert.equal(bytes.readUInt32LE(at), 0x02014b50);
    const method = bytes.readUInt16LE(at + 10);
    const crc = bytes.readUInt32LE(at + 16);
    const packed = bytes.readUInt32LE(at + 20);
    const size = bytes.readUInt32LE(at + 24);
    const nameLength = bytes.readUInt16LE(at + 28);
    const local = bytes.readUInt32LE(at + 42);
    const name = bytes.toString('utf8', at + 46, at + 46 + nameLength);
    assert.equal(bytes.readUInt32LE(local), 0x04034b50);
    const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
    const body = bytes.subarray(start, start + packed);
    const data = method === 8 ? inflateRawSync(body) : Buffer.from(body);
    assert.equal(data.length, size, `${name} size`);
    assert.equal(crc32(data), crc, `${name} CRC`);
    files[name] = data;
    at += 46 + nameLength;
  }
  return files;
}

const work = mkdtempSync(join(tmpdir(), 'bannertv-wgt-'));
after(() => rmSync(work, { recursive: true, force: true }));

/** A web build as apps/webos/dist has it. */
function fakeBuild() {
  const dist = join(work, 'dist');
  mkdirSync(join(dist, 'assets'), { recursive: true });
  writeFileSync(
    join(dist, 'index.html'),
    '<!doctype html><html><head><script id="bannertv-shell" type="application/json">{}</script>' +
      '<script defer src="./loader.js"></script></head><body></body></html>',
  );
  writeFileSync(join(dist, 'loader.js'), 'console.log("loader")');
  writeFileSync(join(dist, 'assets', 'index-abc.js'), 'x'.repeat(5000));
  for (const lgOnly of ['appinfo.json', 'icon_80.png', 'icon_130.png', 'splash_1920x1080.png']) {
    writeFileSync(join(dist, lgOnly), 'lg');
  }
  return dist;
}

describe('the version', () => {
  it("takes Tizen's three numbers, and refuses what Tizen would", () => {
    assert.equal(checkVersion('0.1.0'), '0.1.0');
    assert.equal(checkVersion('255.255.65535'), '255.255.65535');
    assert.throws(() => checkVersion('0.256.0'));
    assert.throws(() => checkVersion('0.1.65536'));
    assert.throws(() => checkVersion('0.1'));
    assert.throws(() => checkVersion('v0.1.0'));
  });

  it('goes into config.xml', () => {
    const xml = configXml(template, '0.1.42');
    assert.match(xml, /<widget [^>]*version="0\.1\.42"/);
    assert.doesNotMatch(xml, /\{\{version\}\}/);
  });
});

describe('config.xml', () => {
  it('keeps the application id the TV stores the app under', () => {
    assert.match(template, /<tizen:application id="BannerTv01\.BannerTV" package="BannerTv01"/);
    // Tizen's rule: a package of exactly ten letters and digits.
    assert.match(/package="([^"]+)"/.exec(template)[1], /^[0-9A-Za-z]{10}$/);
  });

  it('asks only for public privileges, which a sideload certificate covers', () => {
    const privileges = [...template.matchAll(/<tizen:privilege name="([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(privileges, [
      'http://tizen.org/privilege/internet',
      'http://tizen.org/privilege/tv.inputdevice',
      'http://tizen.org/privilege/application.launch',
      'http://developer.samsung.com/privilege/productinfo',
    ]);
  });
});

describe('index.html', () => {
  it("runs Samsung's script before the loader", () => {
    const html = tizenIndexHtml('<head><script defer src="./loader.js"></script></head>');
    assert.ok(html.indexOf(WEBAPIS_SCRIPT) < html.indexOf('./loader.js'));
  });

  it('refuses a page that is not the web build', () => {
    assert.throws(() => tizenIndexHtml('<head><script src="./main.js"></script></head>'));
  });
});

describe('the .wgt', () => {
  it('holds the web build without the LG files, with config.xml and the icon', () => {
    const dist = fakeBuild();
    const icon = Buffer.from('png');
    const files = unzip(zip(wgtEntries({ dist, template, icon, version: '0.1.3' })));
    assert.deepEqual(Object.keys(files).sort(), [
      'assets/index-abc.js',
      'config.xml',
      'icon.png',
      'index.html',
      'loader.js',
    ]);
    assert.match(files['config.xml'].toString(), /version="0\.1\.3"/);
    assert.ok(files['index.html'].toString().includes(WEBAPIS_SCRIPT));
    assert.equal(files['assets/index-abc.js'].toString(), 'x'.repeat(5000));
    assert.deepEqual(files['icon.png'], icon);
  });

  it('comes out the same from the same files', () => {
    const dist = fakeBuild();
    const build = () =>
      zip(wgtEntries({ dist, template, icon: Buffer.from('png'), version: '0.1.0' }));
    assert.deepEqual(build(), build());
  });

  it('says so when there is no build', () => {
    const empty = join(work, 'empty');
    mkdirSync(empty, { recursive: true });
    assert.throws(
      () => wgtEntries({ dist: empty, template, icon: Buffer.from(''), version: '0.1.0' }),
      /pnpm build/,
    );
  });
});
