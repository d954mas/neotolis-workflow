import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { ERROR_CODES, WorkflowError } from '../../src/core/errors.ts';
import type { State } from '../../src/core/state.ts';
import { validateNttaskBrief } from '../../src/runtime/artifacts.ts';
import { completeNttaskPhase } from '../../src/runtime/nttask.ts';

const VALID_BRIEF = `# Task

## Brief
Intent.

## Repository context
Context.

## Success
Outcome.
`;

function artifactRoot(name: string): { root: string; run: string; brief: string } {
  const root = mkdtempSync(join(tmpdir(), `ntworkflow-review-${name}-`));
  const run = join(root, '.ntworkflow', 'runs', 'NT-001');
  mkdirSync(run, { recursive: true });
  return { root, run, brief: join(run, 'BRIEF.md') };
}

async function expectArtifactFailure(operation: Promise<unknown>): Promise<void> {
  await assert.rejects(operation, (error: unknown) => {
    assert.ok(error instanceof WorkflowError);
    assert.equal(error.code, ERROR_CODES.ARTIFACT_FAILURE);
    return true;
  });
}

test('a fence prefix with trailing text does not expose headings inside the fence', async () => {
  const fixture = artifactRoot('fence');
  const brief = `# Task

## Brief
Intent.

\`\`\`md
\`\`\` trailing text
## Repository context
Context.

## Success
Outcome.
\`\`\`
`;
  try {
    writeFileSync(fixture.brief, brief);
    const before = readFileSync(fixture.brief);
    await expectArtifactFailure(validateNttaskBrief(fixture.root, 'NT-001'));
    assert.deepEqual(readFileSync(fixture.brief), before);
  } finally {
    rmSync(fixture.root, { force: true, recursive: true });
  }
});

test('a backtick in the info string does not hide later H2 sections', async () => {
  const fixture = artifactRoot('backtick-info');
  const brief = `${VALID_BRIEF}
\`\`\`md\`invalid
## Unknown
This section must remain visible to structural validation.
\`\`\`
`;
  try {
    writeFileSync(fixture.brief, brief);
    const before = readFileSync(fixture.brief);
    await expectArtifactFailure(validateNttaskBrief(fixture.root, 'NT-001'));
    assert.deepEqual(readFileSync(fixture.brief), before);
  } finally {
    rmSync(fixture.root, { force: true, recursive: true });
  }
});

test('ATX headings may use up to three leading spaces', async () => {
  const fixture = artifactRoot('indented-headings');
  const brief = VALID_BRIEF
    .replace('# Task', ' # Task')
    .replace('## Brief', '  ## Brief')
    .replace('## Repository context', '   ## Repository context');
  try {
    writeFileSync(fixture.brief, brief);
    await validateNttaskBrief(fixture.root, 'NT-001');
  } finally {
    rmSync(fixture.root, { force: true, recursive: true });
  }
});

test('a linked runs directory cannot supply an external BRIEF', async () => {
  const project = mkdtempSync(join(tmpdir(), 'ntworkflow-review-linked-runs-'));
  const external = mkdtempSync(join(tmpdir(), 'ntworkflow-review-external-'));
  const workflow = join(project, '.ntworkflow');
  const externalRun = join(external, 'NT-001');
  const statePath = join(workflow, 'state.json');
  const externalBrief = join(externalRun, 'BRIEF.md');
  const state: State = {
    next_work_number: 2,
    current: {
      run_id: 'NT-001',
      lifecycle: 'intake-active',
      phase: 'nttask',
      owner: { session_id: 'codex:linked-runs' },
      blocker: null,
      work: null,
    },
  };

  try {
    mkdirSync(workflow);
    mkdirSync(externalRun);
    writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
    writeFileSync(externalBrief, VALID_BRIEF);
    symlinkSync(
      external,
      join(workflow, 'runs'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    const stateBefore = readFileSync(statePath);
    const briefBefore = readFileSync(externalBrief);

    await expectArtifactFailure(completeNttaskPhase(project, {
      sessionId: 'codex:linked-runs',
    }));
    assert.deepEqual(readFileSync(statePath), stateBefore);
    assert.deepEqual(readFileSync(externalBrief), briefBefore);
  } finally {
    rmSync(project, { force: true, recursive: true });
    rmSync(external, { force: true, recursive: true });
  }
});
