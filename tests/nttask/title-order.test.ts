import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { ERROR_CODES, WorkflowError } from '../../src/core/errors.ts';
import type { State } from '../../src/core/state.ts';
import { completeNttaskPhase } from '../../src/runtime/nttask.ts';

test('H1 after the first H2 blocks completion without mutation', async () => {
  const project = mkdtempSync(join(tmpdir(), 'ntworkflow-title-order-'));
  const workflow = join(project, '.ntworkflow');
  const run = join(workflow, 'runs', 'NT-001');
  const statePath = join(workflow, 'state.json');
  const briefPath = join(run, 'BRIEF.md');
  const state: State = {
    next_work_number: 2,
    current: {
      run_id: 'NT-001',
      lifecycle: 'intake-active',
      phase: 'nttask',
      owner: { session_id: 'codex:title-order' },
      blocker: null,
      work: null,
    },
  };
  const brief = `## Brief
# Late title

## Repository context
Context.

## Success
Outcome.
`;

  try {
    mkdirSync(run, { recursive: true });
    writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
    writeFileSync(briefPath, brief);
    const stateBefore = readFileSync(statePath);
    const briefBefore = readFileSync(briefPath);

    await assert.rejects(
      completeNttaskPhase(project, { sessionId: 'codex:title-order' }),
      (error: unknown) => {
        assert.ok(error instanceof WorkflowError);
        assert.equal(error.code, ERROR_CODES.ARTIFACT_FAILURE);
        return true;
      },
    );
    assert.deepEqual(readFileSync(statePath), stateBefore);
    assert.deepEqual(readFileSync(briefPath), briefBefore);
  } finally {
    rmSync(project, { force: true, recursive: true });
  }
});
