import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import type { SpawnSyncReturns } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import test from 'node:test';

const NPM_CLI = process.env.npm_execpath ?? assert.fail('npm_execpath is required.');
const RELEASE = resolve('build/release');
const TARBALL = join(RELEASE, 'npm', 'neotolis-workflow-0.0.0.tgz');
const CLAUDE_MARKETPLACE = join(RELEASE, 'marketplaces', 'claude-code');
const CODEX_MARKETPLACE = join(RELEASE, 'marketplaces', 'codex');
const CLAUDE_ROOT = resolve('node_modules/@anthropic-ai/claude-code');
const CODEX_ROOT = resolve('node_modules/@openai/codex');
const CLAUDE_PACKAGE = JSON.parse(readFileSync(join(CLAUDE_ROOT, 'package.json'), 'utf8')) as {
  bin: Record<string, string>;
};
const CODEX_PACKAGE = JSON.parse(readFileSync(join(CODEX_ROOT, 'package.json'), 'utf8')) as {
  bin: Record<string, string>;
};
const CLAUDE = resolve(CLAUDE_ROOT, CLAUDE_PACKAGE.bin.claude ?? assert.fail('Claude bin missing.'));
const CODEX = resolve(CODEX_ROOT, CODEX_PACKAGE.bin.codex ?? assert.fail('Codex bin missing.'));
const REMOTE_PLUGIN_OFF = ['-c', 'features.remote_plugin=false'];

function filesUnder(root: string, directory = root): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    assert.equal(lstatSync(path).isSymbolicLink(), false, `artifact link: ${path}`);
    if (entry.isDirectory()) files.push(...filesUnder(root, path));
    else files.push(relative(root, path).replaceAll('\\', '/'));
  }
  return files.sort();
}

function expectSuccess(result: SpawnSyncReturns<string>): void {
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
}

function isolatedCodexEnvironment(codexHome: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    CODEX_HOME: codexHome,
    HOME: codexHome,
    USERPROFILE: codexHome,
  };
}

test('package aliases and npm metadata expose only the built ntworkflow bin', () => {
  const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
    bin: Record<string, string>;
    files: string[];
    scripts: Record<string, string>;
  };

  assert.deepEqual(packageJson.bin, { ntworkflow: 'build/cli/ntworkflow.mjs' });
  assert.deepEqual(packageJson.files, ['build/cli/ntworkflow.mjs']);
  assert.equal(packageJson.scripts['test:conformance'], 'node scripts/run-tests.mjs conformance');
  assert.equal(packageJson.scripts.package, 'node scripts/package-plugins.mjs');
  assert.equal(packageJson.scripts['package:verify'], 'node --test tests/packaging/packaging.verify.ts');
});

test('release artifacts contain exactly the approved inventories and no links', () => {
  assert.equal(existsSync(TARBALL), true, TARBALL);
  assert.deepEqual(filesUnder(CLAUDE_MARKETPLACE), [
    '.claude-plugin/marketplace.json',
    'plugins/neotolis-workflow/.claude-plugin/plugin.json',
    'plugins/neotolis-workflow/hooks/hooks.json',
    'plugins/neotolis-workflow/runtime/ntworkflow.mjs',
    'plugins/neotolis-workflow/runtime/session-start.mjs',
    'plugins/neotolis-workflow/skills/nttask/SKILL.md',
  ]);
  assert.deepEqual(filesUnder(CODEX_MARKETPLACE), [
    '.agents/plugins/marketplace.json',
    'plugins/neotolis-workflow/.codex-plugin/plugin.json',
    'plugins/neotolis-workflow/hooks/hooks.json',
    'plugins/neotolis-workflow/runtime/ntworkflow.mjs',
    'plugins/neotolis-workflow/runtime/session-start.mjs',
    'plugins/neotolis-workflow/skills/nttask/SKILL.md',
  ]);
});

test('npm tarball installs exact files, exposes ntworkflow, and shares runtime bytes', () => {
  const root = mkdtempSync(join(tmpdir(), 'ntworkflow-tarball-install-'));
  const project = join(root, 'project');
  mkdirSync(project);
  writeFileSync(join(project, 'package.json'), '{"private":true}\n');

  try {
    const install = spawnSync(
      process.execPath,
      [NPM_CLI, 'install', '--ignore-scripts', '--no-audit', '--no-fund', TARBALL],
      { cwd: project, encoding: 'utf8' },
    );
    expectSuccess(install);

    const installedPackage = join(project, 'node_modules', '@neotolis', 'workflow');
    assert.deepEqual(filesUnder(installedPackage), [
      'build/cli/ntworkflow.mjs',
      'package.json',
    ]);

    const consumer = join(root, 'consumer');
    mkdirSync(join(consumer, '.git'), { recursive: true });
    const bin = spawnSync(
      process.execPath,
      [NPM_CLI, 'exec', '--offline', '--', 'ntworkflow', '--cwd', consumer, 'status'],
      { cwd: project, encoding: 'utf8' },
    );
    expectSuccess(bin);
    const response = JSON.parse(bin.stdout) as {
      ok: boolean;
      operation: string;
      project_root: string;
    };
    assert.equal(response.ok, true);
    assert.equal(response.operation, 'status');
    assert.equal(response.project_root, realpathSync.native(consumer));

    const npmRuntime = readFileSync(join(installedPackage, 'build', 'cli', 'ntworkflow.mjs'));
    assert.deepEqual(
      npmRuntime,
      readFileSync(join(
        CLAUDE_MARKETPLACE,
        'plugins', 'neotolis-workflow', 'runtime', 'ntworkflow.mjs',
      )),
    );
    assert.deepEqual(
      npmRuntime,
      readFileSync(join(
        CODEX_MARKETPLACE,
        'plugins', 'neotolis-workflow', 'runtime', 'ntworkflow.mjs',
      )),
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test('pinned Claude installs the complete packaged marketplace fixture', () => {
  const root = mkdtempSync(join(tmpdir(), 'ntworkflow-claude-package-'));
  const config = join(root, 'config');
  mkdirSync(config);
  const env = {
    ...process.env,
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    CLAUDE_CONFIG_DIR: config,
    DISABLE_AUTOUPDATER: '1',
  };
  const run = (...arguments_: string[]) => spawnSync(
    CLAUDE,
    arguments_,
    { encoding: 'utf8', env },
  );

  try {
    const version = run('--version');
    expectSuccess(version);
    assert.equal(version.stdout.trim(), '2.1.220 (Claude Code)');
    const validate = run('plugin', 'validate', CLAUDE_MARKETPLACE);
    expectSuccess(validate);
    assert.match(validate.stdout, /Validation passed/);
    expectSuccess(run(
      'plugin', 'marketplace', 'add', CLAUDE_MARKETPLACE, '--scope', 'user',
    ));
    expectSuccess(run(
      'plugin', 'install', 'neotolis-workflow@neotolis-local', '--scope', 'user',
    ));
    const list = run('plugin', 'list', '--json');
    expectSuccess(list);
    const installed = JSON.parse(list.stdout) as Array<{
      id: string;
      enabled: boolean;
      installPath: string;
    }>;
    const plugin = installed.find((entry) => (
      entry.id === 'neotolis-workflow@neotolis-local'
    ));
    assert.ok(plugin !== undefined, list.stdout);
    assert.equal(plugin.enabled, true);
    assert.deepEqual(filesUnder(plugin.installPath), [
      '.claude-plugin/plugin.json',
      'hooks/hooks.json',
      'runtime/ntworkflow.mjs',
      'runtime/session-start.mjs',
      'skills/nttask/SKILL.md',
    ]);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test('pinned Codex installs the complete packaged marketplace fixture', () => {
  const root = mkdtempSync(join(tmpdir(), 'ntworkflow-codex-package-'));
  const codexHome = join(root, 'codex-home');
  const project = join(root, 'project');
  mkdirSync(codexHome);
  mkdirSync(project);
  writeFileSync(
    join(codexHome, 'config.toml'),
    '[features]\nplugins = true\nhooks = true\nremote_plugin = false\n',
  );
  const run = (...arguments_: string[]) => spawnSync(
    process.execPath,
    [CODEX, ...REMOTE_PLUGIN_OFF, ...arguments_],
    { cwd: project, encoding: 'utf8', env: isolatedCodexEnvironment(codexHome) },
  );

  try {
    const version = run('--version');
    expectSuccess(version);
    assert.equal(version.stdout.trim(), 'codex-cli 0.144.6');
    expectSuccess(run(
      'plugin', 'marketplace', 'add', CODEX_MARKETPLACE, '--json',
    ));
    expectSuccess(run(
      'plugin', 'add', 'neotolis-workflow@neotolis-local', '--json',
    ));
    const list = run('plugin', 'list', '--json');
    expectSuccess(list);
    const listed = JSON.parse(list.stdout) as {
      installed: Array<{
        pluginId: string;
        installed: boolean;
        enabled: boolean;
      }>;
    };
    const plugin = listed.installed.find((entry) => (
      entry.pluginId === 'neotolis-workflow@neotolis-local'
    ));
    assert.ok(plugin !== undefined, list.stdout);
    assert.equal(plugin.installed, true);
    assert.equal(plugin.enabled, true);

  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});
