import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  createClaudeSessionStartContext,
  serializeClaudeSessionStartOutput,
} from '../../../src/providers/session-start.ts';

test('Claude SessionStart maps native identity, cwd, and installed CLI path', () => {
  const root = mkdtempSync(join(tmpdir(), 'ntworkflow-claude-session-'));
  const cwd = join(root, 'project');
  const cli = join(root, 'plugin', 'runtime', 'ntworkflow.mjs');
  mkdirSync(cwd);
  mkdirSync(join(root, 'plugin', 'runtime'), { recursive: true });
  writeFileSync(cli, '#!/usr/bin/env node\n');

  try {
    const context = createClaudeSessionStartContext({
      session_id: 'native-session-42',
      transcript_path: join(root, 'transcript.jsonl'),
      cwd,
      hook_event_name: 'SessionStart',
      source: 'startup',
    }, cli);

    assert.deepEqual(context, {
      owner: 'claude:native-session-42',
      cwd: realpathSync(cwd),
      cli: realpathSync(cli),
    });
    assert.equal(
      serializeClaudeSessionStartOutput(context),
      `${JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'SessionStart',
          additionalContext: `Neotolis Workflow runtime context: ${JSON.stringify(context)}`,
        },
      })}\n`,
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

for (const [name, payload] of [
  ['missing session identity', { cwd: process.cwd(), hook_event_name: 'SessionStart' }],
  ['empty session identity', { session_id: '', cwd: process.cwd(), hook_event_name: 'SessionStart' }],
  ['wrong hook event', { session_id: 'abc', cwd: process.cwd(), hook_event_name: 'Stop' }],
  ['relative cwd', { session_id: 'abc', cwd: '.', hook_event_name: 'SessionStart' }],
] as const) {
  test(`Claude SessionStart rejects ${name}`, () => {
    assert.throws(
      () => createClaudeSessionStartContext(payload, import.meta.filename),
      /Invalid Claude SessionStart payload/,
    );
  });
}

test('Claude SessionStart rejects a missing or relative installed CLI', () => {
  const payload = {
    session_id: 'abc',
    cwd: process.cwd(),
    hook_event_name: 'SessionStart',
  };

  assert.throws(
    () => createClaudeSessionStartContext(payload, 'runtime/ntworkflow.mjs'),
    /Installed CLI path must be absolute/,
  );
  assert.throws(
    () => createClaudeSessionStartContext(payload, join(tmpdir(), 'missing-ntworkflow.mjs')),
    /Installed CLI does not exist/,
  );
});

test('Claude SessionStart executable reads native JSON from stdin', () => {
  const root = mkdtempSync(join(tmpdir(), 'ntworkflow-claude-hook-'));
  const cwd = join(root, 'project');
  const cli = join(root, 'runtime', 'ntworkflow.mjs');
  mkdirSync(cwd);
  mkdirSync(join(root, 'runtime'));
  writeFileSync(cli, '#!/usr/bin/env node\n');

  try {
    const result = spawnSync(
      process.execPath,
      ['src/providers/session-start.ts', cli],
      {
        encoding: 'utf8',
        input: JSON.stringify({
          session_id: 'native-session-99',
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
    assert.match(output.hookSpecificOutput.additionalContext, /claude:native-session-99/);
    assert.match(output.hookSpecificOutput.additionalContext, /ntworkflow\.mjs/);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test('invalid native identity produces no runtime context', () => {
  const result = spawnSync(
    process.execPath,
    ['src/providers/session-start.ts', import.meta.filename],
    {
      encoding: 'utf8',
      input: JSON.stringify({
        cwd: process.cwd(),
        hook_event_name: 'SessionStart',
        source: 'startup',
      }),
    },
  );

  assert.equal(result.status, 2);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /^Invalid Claude SessionStart payload:/);
});
