import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { cliResponse, FIRST_OWNER, runCli } from './helpers.ts';

for (const operation of ['begin', 'complete', 'stop']) {
  test(`phase ${operation} distinguishes no run from lock and filesystem failures without mutation`, () => {
    for (const kind of ['missing', 'empty', 'no-current', 'locked', 'file']) {
      const root = mkdtempSync(join(tmpdir(), 'ntworkflow-phase-no-run-'));
      const workflow = join(root, '.ntworkflow');
      try {
        mkdirSync(join(root, '.git'));
        if (kind === 'file') writeFileSync(workflow, 'not a directory');
        else if (kind !== 'missing') mkdirSync(workflow);
        if (kind === 'no-current') {
          writeFileSync(join(workflow, 'state.json'), '{"next_work_number":1,"current":null}\n');
        }
        if (kind === 'locked') writeFileSync(join(workflow, '.state.lock'), 'held');
        const entries = readdirSync(root, { recursive: true });
        const file = kind === 'file' ? workflow
          : kind === 'locked' ? join(workflow, '.state.lock')
            : kind === 'no-current' ? join(workflow, 'state.json') : null;
        const bytes = file === null ? null : readFileSync(file);
        const result = runCli(root, 'phase', operation, 'nttask', '--session-id', FIRST_OWNER,
          ...(operation === 'stop' ? ['--blocker', 'Needs user input.'] : []));
        const response = cliResponse(result);
        const [code, exit] = kind === 'locked' ? ['LOCK_CONFLICT', 15]
          : kind === 'file' ? ['COMMIT_FAILURE', 16] : ['ILLEGAL_TRANSITION', 11];
        assert.equal(result.status, exit, `${kind}: ${result.stdout}`);
        assert.equal(response.error?.code, code);
        if (exit === 11) {
          assert.deepEqual(response.next_action, {
            skill: 'nttask', instruction: 'Start nttask with a non-empty task.',
          });
        }
        assert.deepEqual(readdirSync(root, { recursive: true }), entries);
        if (file !== null) assert.deepEqual(readFileSync(file), bytes);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  });
}
