#!/usr/bin/env node
// Shortcuts for the development TV, wrapping LG's ares CLI.
//
//   pnpm tv:install   build, package, install and launch on the TV
//   pnpm tv:launch    launch the installed app
//   pnpm tv:inspect   open Chrome DevTools for the running app
//
// The TV is the ares device named "tv" unless BANNERTV_TV names another.
// Set it up once with `pnpm exec ares-setup-device` (see docs/TV_SETUP.md).
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const device = process.env.BANNERTV_TV ?? 'tv';
const { id, version } = JSON.parse(readFileSync('apps/webos/webos-meta/appinfo.json', 'utf8'));
const ipk = `out/${id}_${version}_all.ipk`;

function run(command, args) {
  console.log(`> ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const ares = (tool, args) => run('pnpm', ['--filter', '@bannertv/webos', 'exec', tool, ...args]);

switch (process.argv[2]) {
  case 'install':
    run('pnpm', ['build']);
    run('pnpm', ['check:bundle']);
    run('pnpm', ['package']);
    ares('ares-install', ['--device', device, `../../${ipk}`]);
    ares('ares-launch', ['--device', device, id]);
    break;
  case 'launch':
    ares('ares-launch', ['--device', device, id]);
    break;
  case 'inspect':
    ares('ares-inspect', ['--device', device, '--app', id, '--open']);
    break;
  default:
    console.error('Usage: node tools/scripts/tv.mjs install | launch | inspect');
    process.exit(1);
}
