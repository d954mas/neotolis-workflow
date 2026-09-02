import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import type { SpawnSyncReturns } from 'node:child_process';
import {
  cpSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import test from 'node:test';
import { buildSync } from 'esbuild';

const CLAUDE = resolve('node_modules/@anthropic-ai/claude-code/bin/claude.exe');

function filesUnder(root: string, directory = root): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...filesUnder(root, path));
    else files.push(relative(root, path).replaceAll('\\', '/'));
  }
  return files.sort();
}

function stageMarketplace(root: string): string {
  const marketplace = join(root, 'marketplace');
  mkdirSync(join(marketplace, '.claude-plugin'), { recursive: true });
  mkdirSync(join(marketplace, 'plugins'), { recursive: true });
  cpSync(
    'marketplaces/claude-code/.claude-plugin/marketplace.json',
    join(marketplace, '.claude-plugin', 'marketplace.json'),
  );
  cpSync(
    'plugins/claude-code',
    join(marketplace, 'plugins', 'neotolis-workflow'),
    { recursive: true },
  );
  return marketplace;
}

function runClaude(
  config: string,
  ...arguments_: string[]
): SpawnSyncReturns<string> {
  return spawnSync(CLAUDE, arguments_, {
    encoding: 'utf8',
    env: {
      ...process.env,
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
      CLAUDE_CONFIG_DIR: config,
      DISABLE_AUTOUPDATER: '1',
    },
  });
}

function expectSuccess(result: SpawnSyncReturns<string>): void {
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
}

test('pinned Claude CLI validates, installs, lists, and discovers the staged plugin', () => {
  const root = mkdtempSync(join(tmpdir(), 'ntworkflow-claude-install-'));
  const marketplace = stageMarketplace(root);
  const config = join(root, 'config');
  mkdirSync(config);

  try {
    const validation = runClaude(config, 'plugin', 'validate', marketplace);
    expectSuccess(validation);
    assert.match(validation.stdout, /Validation passed/);
    assert.doesNotMatch(validation.stdout, /warning/i);

    const add = runClaude(
      config,
      'plugin', 'marketplace', 'add', marketplace, '--scope', 'user',
    );
    expectSuccess(add);

    const install = runClaude(
      config,
      'plugin', 'install', 'neotolis-workflow@neotolis-local',
      '--scope', 'user',
    );
    expectSuccess(install);

    const list = runClaude(config, 'plugin', 'list', '--json');
    expectSuccess(list);
    const installed = JSON.parse(list.stdout) as Array<{
      id: string;
      version: string;
      scope: string;
      enabled: boolean;
      installPath: string;
    }>;
    assert.equal(installed.length, 1);
    assert.deepEqual(installed[0] === undefined ? null : {
      id: installed[0].id,
      version: installed[0].version,
      scope: installed[0].scope,
      enabled: installed[0].enabled,
    }, {
      id: 'neotolis-workflow@neotolis-local',
      version: '0.0.0',
      scope: 'user',
      enabled: true,
    });

    const installPath = installed[0]?.installPath;
    assert.ok(installPath !== undefined);
    assert.deepEqual(filesUnder(installPath), [
      '.claude-plugin/plugin.json',
    'agents/ntplan-critic.md',
    'agents/ntplan-researcher.md',
      'hooks/hooks.json',
      'runtime/ntworkflow.mjs',
      'runtime/session-start.mjs',
      'skills/ntgrill/LICENSE',
    'skills/ntgrill/SKILL.md',
    'skills/ntplan/SKILL.md',
    'skills/nttask/SKILL.md',
    ]);

    const details = runClaude(
      config,
      'plugin', 'details', 'neotolis-workflow@neotolis-local',
    );
    expectSuccess(details);
    assert.match(details.stdout, /Skills \(3\)\s+ntgrill, ntplan, nttask/);
    assert.match(details.stdout, /Agents \(2\)/);
    assert.match(details.stdout, /Hooks \(1\)\s+SessionStart/);
    assert.match(details.stdout, /MCP servers \(0\)/);
    assert.match(details.stdout, /LSP servers \(0\)/);

    const payload = JSON.stringify({
      session_id: 'recorded-native-session',
      cwd: root,
      hook_event_name: 'SessionStart',
      source: 'startup',
    });
    const hook = spawnSync(
      process.execPath,
      [
        join(installPath, 'runtime', 'session-start.mjs'),
        join(installPath, 'runtime', 'ntworkflow.mjs'),
      ],
      { encoding: 'utf8', input: payload },
    );
    expectSuccess(hook);
    const hookOutput = JSON.parse(hook.stdout) as {
      hookSpecificOutput: { additionalContext: string };
    };
    const marker = 'Neotolis Workflow runtime context: ';
    assert.ok(hookOutput.hookSpecificOutput.additionalContext.startsWith(marker));
    assert.deepEqual(
      JSON.parse(hookOutput.hookSpecificOutput.additionalContext.slice(marker.length)),
      {
        owner: 'claude:recorded-native-session',
        cwd: realpathSync(root),
        cli: realpathSync(join(installPath, 'runtime', 'ntworkflow.mjs')),
      },
    );

    const invalidHook = spawnSync(
      process.execPath,
      [
        join(installPath, 'runtime', 'session-start.mjs'),
        join(installPath, 'runtime', 'ntworkflow.mjs'),
      ],
      {
        encoding: 'utf8',
        input: JSON.stringify({
          cwd: root,
          hook_event_name: 'SessionStart',
          source: 'startup',
        }),
      },
    );
    assert.equal(invalidHook.status, 2);
    assert.equal(invalidHook.stdout, '');
    assert.equal(readdirSync(root).includes('.ntworkflow'), false);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test('checked Claude runtime bundles match current TypeScript sources', () => {
  const root = mkdtempSync(join(tmpdir(), 'ntworkflow-claude-bundles-'));
  try {
    for (const [source, installed] of [
      ['src/cli/main.ts', 'plugins/claude-code/runtime/ntworkflow.mjs'],
      ['src/providers/session-start.ts', 'plugins/claude-code/runtime/session-start.mjs'],
    ] as const) {
      const output = join(root, installed.endsWith('ntworkflow.mjs')
        ? 'ntworkflow.mjs'
        : 'session-start.mjs');
      buildSync({
        entryPoints: [source],
        bundle: true,
        format: 'esm',
        platform: 'node',
        target: 'node24',
        banner: { js: '/* eslint-disable */' },
        outfile: output,
      });
      assert.deepEqual(readFileSync(output), readFileSync(installed));
    }
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});
