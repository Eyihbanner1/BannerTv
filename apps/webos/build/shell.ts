import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { build, type Plugin } from 'vite';
import {
  CONFIG_ELEMENT_ID,
  type FileEntry,
  SHELL_CONTRACT,
  type ShellConfig,
} from '../src/shell/contract.ts';
import { APP_DB_VERSION } from '../src/shell/runtime-inputs.ts';

/** Where the updates Worker answers the LG app (services/updates, "In-app updates on the LG"). */
export const LG_UPDATES_URL = 'https://updates.bannertv.workers.dev/webos/';
/** The loader, beside index.html. */
export const LOADER_FILE = 'loader.js';
/** What index.html carries until the bundle is done and the config can be worked out. */
const CONFIG_PLACEHOLDER = '__BANNERTV_SHELL_CONFIG__';
/** The files an update can replace: the app's script and the scripts it loads by path. */
const UPDATABLE = /^(assets|vendor|data)\/[^/]+\.js$/;

export interface ShellOptions {
  /** The loader's entry, src/shell/main.ts. */
  entry: string;
  /** appinfo.json. */
  appinfoPath: string;
  /** The update key's public half (SPKI, PEM), when committed. */
  keyPath: string;
  /** LG_UPDATES_IN_BUILD (src/app/features.ts). */
  updatesInBuild: boolean;
  /** The environment the build runs in, for GITHUB_* (process.env). */
  env?: Record<string, string | undefined>;
  /** When the build ran; the machine's clock by default. */
  now?: () => Date;
}

export const sha256Hex = (bytes: string | Uint8Array): string =>
  createHash('sha256').update(bytes).digest('hex');

/** The public key's DER from its PEM text, or a clear error when it is not an SPKI public key. */
export function readPublicKey(pem: string): Buffer {
  const match = /-----BEGIN PUBLIC KEY-----([\s\S]+?)-----END PUBLIC KEY-----/.exec(pem);
  if (!match) throw new Error('certs/lg-updates.pem is not a PEM public key (BEGIN PUBLIC KEY).');
  return Buffer.from(match[1]!.replace(/\s+/g, ''), 'base64');
}

/** A key's fingerprint, which the Worker's answers name: the first 16 hex digits of its SHA-256. */
export const keyIdOf = (der: Uint8Array): string => `lg-${sha256Hex(der).slice(0, 16)}`;

/**
 * The channel this build follows: `main` for a build of main's own code on GitHub Actions,
 * otherwise null, and the build takes no updates. A pull request's .ipk, the combined test
 * build's and a laptop build run code main does not have yet; on main's channel, main's next
 * publish would replace it without a word. The same rule as the phone's
 * (apps/mobile/build/updates.js).
 */
export function updatesChannel(env: Record<string, string | undefined>): 'main' | null {
  return env.GITHUB_ACTIONS === 'true' && env.GITHUB_REF === 'refs/heads/main' ? 'main' : null;
}

/** The parts of appinfo.json an update cannot change: all but the version, which every publish stamps. */
function appinfoWithoutVersion(text: string): string {
  const rest = JSON.parse(text) as Record<string, unknown>;
  delete rest.version;
  return JSON.stringify(rest);
}

/**
 * The runtime version: a hash of everything an update cannot change, so an update only ever
 * reaches the .ipks it was built with. The shell contract, the loader, index.html around the
 * config, appinfo.json but its version, the app's database version and the update key.
 */
export function runtimeVersion(inputs: {
  loader: string;
  html: string;
  appinfo: string;
  key: Uint8Array | null;
}): string {
  const hash = sha256Hex(
    JSON.stringify({
      contract: SHELL_CONTRACT,
      loader: sha256Hex(inputs.loader),
      html: sha256Hex(inputs.html),
      appinfo: appinfoWithoutVersion(inputs.appinfo),
      db: APP_DB_VERSION,
      key: inputs.key ? sha256Hex(inputs.key) : null,
    }),
  );
  return `webos-${SHELL_CONTRACT}-${hash.slice(0, 16)}`;
}

/** JSON safe inside a <script> element: no `<` at all, so never `</script>` or `<!--`. */
export const scriptJson = (value: unknown): string =>
  JSON.stringify(value).replace(/</g, '\\u003c');

/**
 * The two script elements that start the app, in place of Vite's module script, which Vite puts
 * in the head. Deferred as the app's script was: the loader then runs once the page is parsed,
 * after the unsupported-TV check, with the body there to add the app's script to.
 */
export const SHELL_TAGS =
  `<script id="${CONFIG_ELEMENT_ID}" type="application/json">${CONFIG_PLACEHOLDER}</script>` +
  `<script defer src="./${LOADER_FILE}"></script>`;

/** index.html with the app's entry script swapped for the loader. */
export function toShellScripts(html: string): string {
  let swapped = 0;
  const out = html.replace(/<script\b[^>]*\btype="module"[^>]*><\/script>/g, () => {
    swapped++;
    return SHELL_TAGS;
  });
  if (swapped !== 1)
    throw new Error(`index.html has ${swapped} module scripts, not the one entry.`);
  return out;
}

/** The loader as one classic script, bundled from its entry alone. */
export async function buildLoader(entry: string): Promise<string> {
  const result = await build({
    configFile: false,
    logLevel: 'warn',
    root: resolve(entry, '..'),
    publicDir: false,
    build: {
      write: false,
      // As the app: webOS 5.0 runs Chromium 68 (docs/adr/0001-react-norigin-classic-bundle.md).
      target: 'es2017',
      minify: true,
      modulePreload: false,
      reportCompressedSize: false,
      rolldownOptions: {
        input: entry,
        output: { format: 'iife', entryFileNames: LOADER_FILE, codeSplitting: false },
      },
    },
  });
  const outputs = (Array.isArray(result) ? result : [result]) as Array<{
    output: Array<{ type: string; code?: string; moduleIds?: string[] }>;
  }>;
  const chunks = outputs.flatMap((out) => out.output).filter((item) => item.type === 'chunk');
  if (chunks.length !== 1) throw new Error(`The loader built as ${chunks.length} chunks, not one.`);
  const chunk = chunks[0]!;
  // The loader can never change over the air, so it takes nothing from the app: not React, not
  // @bannertv/core, nothing outside src/shell but the compiler's own helpers for older syntax.
  const shellDir = resolve(entry, '..');
  for (const id of chunk.moduleIds ?? []) {
    if (
      /@oxc-project[+/]runtime@[^/]+\/(node_modules\/@oxc-project\/runtime\/)?helpers\//.test(id)
    ) {
      continue;
    }
    const path = relative(shellDir, id.replace(/\?.*$/, ''));
    if (path.startsWith('..') || /node_modules/.test(id)) {
      throw new Error(`The loader takes ${id}, outside src/shell.`);
    }
  }
  return chunk.code!;
}

interface BundleItem {
  type: 'chunk' | 'asset';
  fileName: string;
  isEntry?: boolean;
  code?: string;
  source?: string | Uint8Array;
}

const bytesOf = (item: BundleItem): Uint8Array | string =>
  item.type === 'chunk' ? item.code! : item.source!;
const sizeOf = (bytes: Uint8Array | string) =>
  typeof bytes === 'string' ? Buffer.byteLength(bytes) : bytes.length;

/**
 * The ShellConfig for a finished bundle: the app's entry script and the scripts beside it that an
 * update can replace, each by its SHA-256, the runtime version, and this build's id.
 */
export function shellConfig(
  bundle: Record<string, BundleItem>,
  inputs: {
    loader: string;
    html: string;
    appinfo: string;
    key: Uint8Array | null;
    channel: string | null;
    builtAt: string;
    commit: string | null;
  },
): ShellConfig {
  const entries = Object.values(bundle).filter((item) => item.type === 'chunk' && item.isEntry);
  if (entries.length !== 1)
    throw new Error(`The build has ${entries.length} entry scripts, not one.`);
  const launch = entries[0]!.fileName;
  const files: Record<string, FileEntry> = {};
  for (const item of Object.values(bundle).sort((a, b) => a.fileName.localeCompare(b.fileName))) {
    if (!UPDATABLE.test(item.fileName)) continue;
    const bytes = bytesOf(item);
    files[item.fileName] = { sha256: sha256Hex(bytes), size: sizeOf(bytes) };
  }
  if (!files[launch]) throw new Error(`The entry script ${launch} is not under assets/.`);
  const runtime = runtimeVersion(inputs);
  const version = (JSON.parse(inputs.appinfo) as { version: string }).version;
  const id = sha256Hex(
    JSON.stringify({ runtime, version, commit: inputs.commit, builtAt: inputs.builtAt, files }),
  ).slice(0, 32);
  return {
    contract: SHELL_CONTRACT,
    runtime,
    build: { id, version, commit: inputs.commit, builtAt: inputs.builtAt },
    launch,
    files,
    updates:
      inputs.channel && inputs.key
        ? {
            channel: inputs.channel,
            url: LG_UPDATES_URL,
            key: Buffer.from(inputs.key).toString('base64'),
            keyId: keyIdOf(inputs.key),
          }
        : null,
  };
}

/** The ShellConfig a built index.html carries. */
export function readShellConfig(html: string): ShellConfig {
  const match = new RegExp(
    `<script id="${CONFIG_ELEMENT_ID}" type="application/json">([^<]*)</script>`,
  ).exec(html);
  if (!match) throw new Error('index.html carries no shell config.');
  return JSON.parse(match[1]!) as ShellConfig;
}

/**
 * Starts the app through the loader (src/shell): index.html runs loader.js, which reads the
 * ShellConfig beside it and starts the app's script from the .ipk or from a stored update.
 * Every asset is inlined into the app's script (vite.config.ts), so an update is scripts only.
 */
export function shell(options: ShellOptions): Plugin {
  const env = options.env ?? process.env;
  let loader: Promise<string> | undefined;
  let html = '';
  return {
    name: 'bannertv:shell',
    apply: 'build',
    buildStart() {
      loader = buildLoader(options.entry);
      // Unhandled until generateBundle awaits it.
      loader.catch(() => undefined);
    },
    transformIndexHtml: {
      order: 'post',
      handler: (page) => {
        html = toShellScripts(page);
        return html;
      },
    },
    generateBundle: {
      order: 'post',
      async handler(_output, bundle) {
        const code = await loader!;
        const key = existsSync(options.keyPath)
          ? readPublicKey(readFileSync(options.keyPath, 'utf8'))
          : null;
        const channel = options.updatesInBuild ? updatesChannel(env) : null;
        const page = bundle['index.html'] as BundleItem | undefined;
        if (!page || page.type !== 'asset') throw new Error('The build has no index.html.');
        const config = shellConfig(bundle as unknown as Record<string, BundleItem>, {
          loader: code,
          html,
          appinfo: readFileSync(options.appinfoPath, 'utf8'),
          key,
          channel,
          builtAt: (options.now ?? (() => new Date()))().toISOString(),
          commit: env.GITHUB_SHA && /^[0-9a-f]{40}$/.test(env.GITHUB_SHA) ? env.GITHUB_SHA : null,
        });
        const text = String(page.source);
        if (text.indexOf(CONFIG_PLACEHOLDER) === -1) {
          throw new Error('index.html lost the shell config placeholder.');
        }
        page.source = text.replace(CONFIG_PLACEHOLDER, () => scriptJson(config));
        this.emitFile({ type: 'asset', fileName: LOADER_FILE, source: code });
      },
    },
  };
}
