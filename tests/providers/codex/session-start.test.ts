import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  realpathSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const SESSION_START = resolve('plugins/codex/runtime/session-start.mjs');

test('Codex SessionStart reads native JSON and maps canonical runtime context', () => {
  const root = mkdtempSync(join(tmpdir(), 'ntworkflow-codex-session-'));
  const cwd = join(root, 'project');
  const cli = join(root, 'plugin', 'runtime', 'ntworkflow.mjs');
  mkdirSync(cwd);
  mkdirSync(join(root, 'plugin', 'runtime'), { recursive: true });
  writeFileSync(cli, '#!/usr/bin/env node\n');

  try {
    const result = spawnSync(
      process.execPath,
      [SESSION_START, cli],
      {
        encoding: 'utf8',
        input: JSON.stringify({
          session_id: 'native-session-42',
          transcript_path: null,
          cwd,
          hook_event_name: 'SessionStart',
          source: 'startup',
        }),
      },
    );

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, '');
    const output = JSON.parse(result.stdout) as {
      hookSpecificOutput: { hookEventName: string; additionalContext: string };
    };
    assert.equal(output.hookSpecificOutput.hookEventName, 'SessionStart');
    const marker = 'Neotolis Workflow runtime context: ';
    assert.ok(output.hookSpecificOutput.additionalContext.startsWith(marker));
    assert.deepEqual(
      JSON.parse(output.hookSpecificOutput.additionalContext.slice(marker.length)),
      {
        owner: 'codex:native-session-42',
        cwd: realpathSync(cwd),
        cli: realpathSync(cli),
      },
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

for (const [name, createPayload] of [
  ['missing session identity', (cwd: string) => ({ cwd, hook_event_name: 'SessionStart' })],
  ['empty session identity', (cwd: string) => ({ session_id: '', cwd, hook_event_name: 'SessionStart' })],
  ['whitespace session identity', (cwd: string) => ({ session_id: 'abc def', cwd, hook_event_name: 'SessionStart' })],
  ['colon session identity', (cwd: string) => ({ session_id: 'abc:def', cwd, hook_event_name: 'SessionStart' })],
  ['wrong hook event', (cwd: string) => ({ session_id: 'abc', cwd, hook_event_name: 'Stop' })],
  ['relative cwd', () => ({ session_id: 'abc', cwd: '.', hook_event_name: 'SessionStart' })],
] as const) {
  test(`Codex SessionStart rejects ${name} without mutation`, () => {
    const root = mkdtempSync(join(tmpdir(), 'ntworkflow-codex-invalid-'));
    const cwd = join(root, 'project');
    mkdirSync(cwd);
    try {
      const payload = createPayload(cwd);
      if (payload.cwd !== '.') {
        assert.equal(realpathSync(payload.cwd), realpathSync(cwd));
      }
      const result = spawnSync(
        process.execPath,
        [SESSION_START, import.meta.filename],
        {
          cwd,
          encoding: 'utf8',
          input: JSON.stringify(payload),
        },
      );

      assert.equal(result.status, 2);
      assert.equal(result.stdout, '');
      assert.match(result.stderr, /^Invalid Codex SessionStart payload:/);
      assert.equal(readdirSync(cwd).includes('.ntworkflow'), false);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
}

test('Codex SessionStart rejects a missing or relative installed CLI', () => {
  const root = mkdtempSync(join(tmpdir(), 'ntworkflow-codex-cli-invalid-'));
  const cwd = join(root, 'project');
  mkdirSync(cwd);
  try {
    for (const cli of ['runtime/ntworkflow.mjs', join(root, 'missing-ntworkflow.mjs')]) {
      const result = spawnSync(
        process.execPath,
        [SESSION_START, cli],
        {
          cwd,
          encoding: 'utf8',
          input: JSON.stringify({
            session_id: 'abc',
            cwd,
            hook_event_name: 'SessionStart',
            source: 'startup',
          }),
        },
      );

      assert.equal(result.status, 2);
      assert.equal(result.stdout, '');
      assert.match(
        result.stderr,
        cli.startsWith('runtime')
          ? /Installed CLI path must be absolute/
          : /Installed CLI does not exist/,
      );
      assert.equal(readdirSync(cwd).includes('.ntworkflow'), false);
    }
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});
