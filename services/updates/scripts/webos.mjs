/**
 * The steps of the "Publish LG update" workflow that are more than running wrangler, for the LG
 * TV's Homebrew Channel repository (lib/webos.mjs). It reads and writes files only, with Node's
 * own modules, so the jobs holding the Cloudflare token run it from their own checkout with no
 * install. Run from services/updates:
 *
 *   node scripts/webos.mjs has-key --keys <list> --key <key>
 *   node scripts/webos.mjs next-version --appinfo <appinfo.json> --history <file> --keys <list>
 *   node scripts/webos.mjs check-rollback --history <file> --keys <list>
 *   node scripts/webos.mjs stamp --version <x.y.z> --appinfo <appinfo.json> \
 *     --package <package.json>
 *   node scripts/webos.mjs describe-build --ipk <file> --version <x.y.z> --commit <sha> \
 *     --out <build.json>
 *   node scripts/webos.mjs publish --ipk <file> --build <build.json> --version <x.y.z> \
 *     --commit <sha> --history <file> --history-now <file> --keys <list> --out <dir>
 *   node scripts/webos.mjs rollback-previous --history <file> --history-now <file> \
 *     --keys <list> --out <dir>
 *   node scripts/webos.mjs offers --index <served repo.json> --summary <summary.json>
 *   node scripts/webos.mjs summary --summary <summary.json> --result <job status>
 *
 * --keys is a `wrangler kv key list --prefix webos/` answer, and --history a `wrangler kv key get
 * webos/history/main` answer (missing: nothing published yet). --history-now is the same key read
 * again just before the upload, so that a publish is refused when another ran in between.
 *
 * has-key exits 0 when the list names the key, 1 when not, and 2 when it cannot tell.
 * next-version prints the version a publish stamps, and check-rollback the version
 * rollback-previous goes back to; both refuse, before anything is built, what the store cannot
 * take. stamp rewrites the two files in place. describe-build checks the .ipk Build made and
 * writes what it is, for Upload to check again.
 *
 * publish and rollback-previous write, in --out (which must not exist yet): content-1.json and on
 * (the .ipk and icon, uploaded first; none for a roll back), history.json (the history, uploaded
 * next), repo.json (the index, uploaded last), index.json (the index's exact text) and
 * summary.json. offers exits 0 when the served index offers the build in the summary, and
 * summary prints the run's summary in Markdown.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { parseArgs } from 'node:util';
import { chunkEntries, readKeyList } from './lib/update.mjs';
import {
  checkRollback,
  describeBuild,
  ipkUrl,
  nextVersion,
  offers,
  planPublish,
  planRollbackPrevious,
  readHistory,
  readStoredHistory,
  REPO_URL,
  runSummary,
  stampVersion,
} from './lib/webos.mjs';

const COMMANDS = [
  'has-key',
  'next-version',
  'check-rollback',
  'stamp',
  'describe-build',
  'publish',
  'rollback-previous',
  'offers',
  'summary',
];

/** has-key's 1 means "not listed", so its failures exit 2, never to be taken for an answer. */
let failure = 1;

function fail(message) {
  console.error(`::error::${message}`);
  process.exit(failure);
}

const readText = (path) =>
  path === undefined || !existsSync(path) ? undefined : readFileSync(path, 'utf8');

function need(values, ...names) {
  const missing = names.filter((name) => !values[name]);
  if (missing.length > 0) fail(`Give ${missing.map((name) => `--${name}`).join(', ')}.`);
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

/** What the run's summary and the served-index check read. */
function summarise(plan) {
  const { entry, previous } = plan;
  return {
    action: plan.action,
    channel: plan.channel,
    version: entry.version,
    commit: entry.commit ?? null,
    sha256: entry.sha256,
    ipkSize: entry.ipkSize,
    iconSha256: entry.iconSha256,
    ipkUrl: ipkUrl(entry.sha256),
    repoUrl: REPO_URL,
    publishedAt: entry.publishedAt,
    restoredAt: entry.restoredAt ?? null,
    // What the TV was offered before this run: the build a roll back undoes, or the last publish.
    before: previous ? { version: previous.version, commit: previous.commit ?? null } : null,
    files: plan.files,
  };
}

function writePlan(out, plan) {
  if (existsSync(out)) fail(`${out} exists already: give a new folder.`);
  mkdirSync(out, { recursive: true });
  chunkEntries(plan.content).forEach((entries, index) => {
    writeFileSync(join(out, `content-${index + 1}.json`), JSON.stringify(entries));
  });
  writeFileSync(join(out, 'history.json'), JSON.stringify([plan.history]));
  writeFileSync(join(out, 'repo.json'), JSON.stringify([plan.repo]));
  writeFileSync(join(out, 'index.json'), plan.repo.value);
  const summary = summarise(plan);
  writeJson(join(out, 'summary.json'), summary);
  console.log(JSON.stringify(summary));
}

function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      keys: { type: 'string' },
      key: { type: 'string' },
      appinfo: { type: 'string' },
      package: { type: 'string' },
      history: { type: 'string' },
      'history-now': { type: 'string' },
      version: { type: 'string' },
      commit: { type: 'string' },
      ipk: { type: 'string' },
      build: { type: 'string' },
      index: { type: 'string' },
      summary: { type: 'string' },
      result: { type: 'string' },
      out: { type: 'string' },
    },
  });
  const command = positionals[0];
  if (command === 'has-key') failure = 2;
  if (!COMMANDS.includes(command) || positionals.length !== 1) {
    fail(`Say one of ${COMMANDS.join(', ')}.`);
  }
  const keys = () => readKeyList(readText(values.keys));
  const history = () => readHistory(readText(values.history));
  // Only when given: a missing file then means nothing is stored now.
  const historyNow = () =>
    values['history-now'] === undefined ? undefined : readHistory(readText(values['history-now']));

  if (command === 'has-key') {
    need(values, 'keys', 'key');
    if (!existsSync(values.keys)) fail(`${values.keys} is not there.`);
    process.exit(keys().has(values.key) ? 0 : 1);
  }
  if (command === 'next-version' || command === 'check-rollback') {
    need(values, 'keys', ...(command === 'next-version' ? ['appinfo'] : []));
    const stored = keys();
    const read = readStoredHistory(readText(values.history), { stored });
    if (command === 'check-rollback') {
      process.stdout.write(`${checkRollback({ history: read, stored }).version}\n`);
      return;
    }
    const committed = JSON.parse(readFileSync(values.appinfo, 'utf8')).version;
    process.stdout.write(`${nextVersion({ committed, history: read })}\n`);
    return;
  }
  if (command === 'stamp') {
    need(values, 'version', 'appinfo', 'package');
    const stamped = stampVersion({
      appinfoText: readFileSync(values.appinfo, 'utf8'),
      packageText: readFileSync(values.package, 'utf8'),
      version: values.version,
    });
    writeFileSync(values.appinfo, stamped.appinfoText);
    writeFileSync(values.package, stamped.packageText);
    console.log(`Stamped ${values.version} into ${values.appinfo} and ${values.package}.`);
    return;
  }
  if (command === 'describe-build') {
    need(values, 'ipk', 'version', 'commit', 'out');
    const build = describeBuild(readFileSync(values.ipk), {
      version: values.version,
      commit: values.commit,
      ipkName: basename(values.ipk),
    });
    writeJson(values.out, build);
    console.log(JSON.stringify(build));
    return;
  }
  if (command === 'publish') {
    need(values, 'ipk', 'build', 'version', 'commit', 'out');
    writePlan(
      values.out,
      planPublish({
        ipkBytes: readFileSync(values.ipk),
        build: JSON.parse(readFileSync(values.build, 'utf8')),
        version: values.version,
        commit: values.commit,
        history: history(),
        historyNow: historyNow(),
        stored: keys(),
        now: new Date(),
      }),
    );
    return;
  }
  if (command === 'rollback-previous') {
    need(values, 'out');
    writePlan(
      values.out,
      planRollbackPrevious({
        history: history(),
        historyNow: historyNow(),
        stored: keys(),
        now: new Date(),
      }),
    );
    return;
  }
  need(values, 'summary');
  const summary = JSON.parse(readFileSync(values.summary, 'utf8'));
  if (command === 'summary') {
    process.stdout.write(runSummary(summary, { result: values.result }));
    return;
  }
  // offers
  need(values, 'index');
  process.exit(offers(readText(values.index) ?? '', summary) ? 0 : 1);
}

try {
  main();
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
