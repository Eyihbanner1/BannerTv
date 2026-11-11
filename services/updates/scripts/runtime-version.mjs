/**
 * Prints the runtime version a publish goes to, after checking expo-updates worked it out from the
 * whole of apps/mobile/fingerprint.config.js (lib/runtime.mjs says why). Run in apps/mobile:
 *
 *   pnpm exec expo-updates runtimeversion:resolve --platform android > resolved.json
 *   node ../../services/updates/scripts/runtime-version.mjs --resolved resolved.json \
 *     --config fingerprint.config.js
 *
 * It also takes `fingerprint fingerprint:generate` output, the command ci.yml checks the same way.
 */
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { checkRuntimeVersion, loadFingerprintConfig, readResolved } from './lib/runtime.mjs';

try {
  const { values } = parseArgs({
    options: { resolved: { type: 'string' }, config: { type: 'string' } },
  });
  if (!values.resolved || !values.config) {
    throw new Error('Give --resolved <file> and --config <fingerprint.config.js>.');
  }
  const config = loadFingerprintConfig(values.config);
  const resolved = readResolved(readFileSync(values.resolved, 'utf8'));
  process.stdout.write(`${checkRuntimeVersion({ resolved, config })}\n`);
} catch (error) {
  console.error(`::error::${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
