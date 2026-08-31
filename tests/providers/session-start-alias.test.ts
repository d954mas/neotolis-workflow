import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import test from 'node:test';

import { loadCorpus } from '../conformance/harness.ts';

for (const adapter of loadCorpus('tests/conformance/scenarios.json').adapters) {
  for (const hook of [
    adapter.provider === 'claude'
      ? 'src/providers/session-start.ts'
      : 'src/providers/codex-session-start.ts',
    adapter.session_start,
  ]) {
    test(`${adapter.provider} SessionStart emits context through an alias: ${hook}`, () => {
      const root = mkdtempSync(join(tmpdir(), 'ntworkflow-hook-alias пробел '));
      const alias = join(root, 'alias');
      try {
        symlinkSync(resolve(dirname(hook)), alias, process.platform === 'win32' ? 'junction' : 'dir');
        const result = spawnSync(process.execPath, [
          join(alias, basename(hook)), resolve(adapter.runtime),
        ], {
          encoding: 'utf8',
          input: JSON.stringify({ ...adapter.payload, cwd: root }),
        });
        assert.equal(result.status, 0, result.stderr);
        assert.equal(result.stderr, '');
        assert.equal(result.stdout, `${JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'SessionStart',
            additionalContext: `Neotolis Workflow runtime context: ${JSON.stringify({
              owner: `${adapter.provider}:${String(adapter.payload.session_id)}`,
              cwd: realpathSync(root),
              cli: realpathSync(adapter.runtime),
            })}`,
          },
        })}\n`);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
  }
}
