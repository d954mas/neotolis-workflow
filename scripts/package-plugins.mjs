import { Buffer } from 'node:buffer';
import { spawnSync } from 'node:child_process';
import {
  cp,
  mkdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { join, resolve } from 'node:path';

const npmCli = process.env.npm_execpath;
const buildRoot = resolve('build');
const releaseRoot = join(buildRoot, 'release');
const npmRoot = join(releaseRoot, 'npm');
const npmStage = join(npmRoot, 'stage');
const marketplacesRoot = join(releaseRoot, 'marketplaces');
const claudeMarketplace = join(marketplacesRoot, 'claude-code');
const codexMarketplace = join(marketplacesRoot, 'codex');
const pluginName = 'neotolis-workflow';

function run(command, arguments_) {
  const result = spawnSync(command, arguments_, { encoding: 'utf8', stdio: 'pipe' });
  if (result.status !== 0) {
    process.stderr.write(result.stdout ?? '');
    process.stderr.write(result.stderr ?? result.error?.message ?? '');
    process.exit(result.status ?? 70);
  }
}

run(process.execPath, ['scripts/build.mjs']);

const builtRuntime = await readFile(join(buildRoot, 'cli', 'ntworkflow.mjs'));
const runtime = Buffer.concat([
  Buffer.from('#!/usr/bin/env node\n'),
  builtRuntime,
]);

await mkdir(join(npmStage, 'build', 'cli'), { recursive: true });
await writeFile(join(npmStage, 'package.json'), await readFile('package.json'));
await writeFile(join(npmStage, 'build', 'cli', 'ntworkflow.mjs'), runtime);

await mkdir(join(claudeMarketplace, '.claude-plugin'), { recursive: true });
await mkdir(join(claudeMarketplace, 'plugins'), { recursive: true });
await cp(
  'marketplaces/claude-code/.claude-plugin/marketplace.json',
  join(claudeMarketplace, '.claude-plugin', 'marketplace.json'),
);
await cp(
  'plugins/claude-code',
  join(claudeMarketplace, 'plugins', pluginName),
  { recursive: true },
);
await writeFile(
  join(claudeMarketplace, 'plugins', pluginName, 'runtime', 'ntworkflow.mjs'),
  runtime,
);

await mkdir(join(codexMarketplace, '.agents', 'plugins'), { recursive: true });
await mkdir(join(codexMarketplace, 'plugins'), { recursive: true });
await cp(
  'marketplaces/codex/marketplace.json',
  join(codexMarketplace, '.agents', 'plugins', 'marketplace.json'),
);
await cp(
  'plugins/codex',
  join(codexMarketplace, 'plugins', pluginName),
  { recursive: true },
);
await writeFile(
  join(codexMarketplace, 'plugins', pluginName, 'runtime', 'ntworkflow.mjs'),
  runtime,
);

run(process.execPath, [npmCli, 'pack', npmStage, '--pack-destination', npmRoot]);
await rm(npmStage, { force: true, recursive: true });
