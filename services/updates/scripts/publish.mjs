/**
 * Builds and signs what the "Publish phone update" workflow uploads to the update service's
 * Workers KV, as `wrangler kv bulk put` files. It reads and writes files only; the workflow
 * fetches the current state with wrangler first and uploads the files after.
 *
 *   node scripts/publish.mjs publish --export apps/mobile/dist/android \
 *     --expo-config config.json --commit <sha> --channel main --runtime-version <rv> --out <dir>
 *   node scripts/publish.mjs rollback-previous --previous <manifest file> ... --out <dir>
 *   node scripts/publish.mjs rollback-to-embedded --channel main --runtime-version <rv> --out <dir>
 *   node scripts/publish.mjs previous-id --history <file>      prints the id to fetch for the above
 *
 * Every action but previous-id signs, with the private key in EXPO_UPDATES_PRIVATE_KEY (or
 * --key-file, for trying it on a laptop). --certificate checks that key against the certificate
 * the app embeds. --history is the stored history (missing: none yet), --stored a `wrangler kv
 * key list --prefix asset:` answer, so files already uploaded are left out.
 *
 * Out comes, in --out (which must not exist yet): content-1.json and on (files and the manifest,
 * uploaded first), pointer.json (the index and history, or the directive, uploaded last, so no
 * phone is pointed at an update before it is all there), manifest.json or directive.json (the
 * signed text) and summary.json.
 */
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import {
  chunkEntries,
  planPublish,
  planRollbackPrevious,
  planRollbackToEmbedded,
  previousId,
  readHistory,
  readKeyList,
  readSigningKey,
  UPDATE_URL,
  verifyText,
} from './lib/update.mjs';

const ACTIONS = ['publish', 'rollback-previous', 'rollback-to-embedded', 'previous-id'];

function fail(message) {
  console.error(`::error::${message}`);
  process.exit(1);
}

const readText = (path) =>
  path === undefined || !existsSync(path) ? undefined : readFileSync(path, 'utf8');

function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      channel: { type: 'string' },
      platform: { type: 'string', default: 'android' },
      'runtime-version': { type: 'string' },
      export: { type: 'string' },
      'expo-config': { type: 'string' },
      commit: { type: 'string' },
      history: { type: 'string' },
      stored: { type: 'string' },
      previous: { type: 'string' },
      certificate: { type: 'string' },
      'key-file': { type: 'string' },
      'update-url': { type: 'string', default: UPDATE_URL },
      out: { type: 'string' },
    },
  });
  const action = positionals[0];
  if (!ACTIONS.includes(action) || positionals.length !== 1) {
    fail(`Say one of ${ACTIONS.join(', ')}.`);
  }
  const history = readHistory(readText(values.history));
  if (action === 'previous-id') {
    process.stdout.write(`${previousId(history)}\n`);
    return;
  }

  const pem = values['key-file']
    ? readFileSync(values['key-file'], 'utf8')
    : process.env.EXPO_UPDATES_PRIVATE_KEY;
  if (!pem?.trim())
    fail('Set EXPO_UPDATES_PRIVATE_KEY (or pass --key-file): every update is signed.');
  const certificate = values.certificate ? readFileSync(values.certificate, 'utf8') : undefined;
  const now = new Date();
  const signingKey = readSigningKey(pem, { certificate, now });

  if (!values.out) fail('Say where to write the files with --out.');
  if (existsSync(values.out)) fail(`${values.out} exists already: give a new folder.`);

  const common = {
    channel: values.channel,
    platform: values.platform,
    runtimeVersion: values['runtime-version'],
    signingKey,
    now,
  };
  let plan;
  if (action === 'publish') {
    if (!values.export || !values['expo-config']) fail('publish needs --export and --expo-config.');
    plan = planPublish({
      ...common,
      exportDir: values.export,
      expoClient: JSON.parse(readFileSync(values['expo-config'], 'utf8')),
      commit: values.commit,
      id: randomUUID(),
      history,
      stored: readKeyList(readText(values.stored)),
      updateUrl: values['update-url'],
    });
  } else if (action === 'rollback-previous') {
    if (!values.previous) fail('rollback-previous needs --previous.');
    const previousManifestText = readText(values.previous);
    if (previousManifestText === undefined) {
      fail(`${values.previous} is not there: the store has no manifest for the previous update.`);
    }
    plan = planRollbackPrevious({ ...common, history, previousManifestText, id: randomUUID() });
  } else {
    plan = planRollbackToEmbedded(common);
  }

  // The signature is checked once more before anything leaves: a key that signs wrongly is
  // found here, not on the phones.
  const signed = plan.manifestText ?? plan.directiveText;
  const entry = [...plan.content, ...plan.pointer].find((item) => item.value === signed);
  if (!entry || !verifyText(signed, entry.metadata.sig, signingKey)) {
    fail('The signature does not check out against the key.');
  }

  mkdirSync(values.out, { recursive: true });
  chunkEntries(plan.content).forEach((entries, index) => {
    writeFileSync(join(values.out, `content-${index + 1}.json`), JSON.stringify(entries));
  });
  writeFileSync(join(values.out, 'pointer.json'), JSON.stringify(plan.pointer));
  writeFileSync(join(values.out, plan.manifestText ? 'manifest.json' : 'directive.json'), signed);
  const summary = {
    action: plan.action,
    id: plan.id ?? null,
    createdAt: plan.createdAt,
    channel: plan.channel,
    platform: plan.platform,
    runtimeVersion: plan.runtimeVersion,
    republishOf: plan.republishOf ?? null,
    commit: plan.commit ?? null,
    files: plan.files,
  };
  writeFileSync(join(values.out, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify(summary));
}

try {
  main();
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
