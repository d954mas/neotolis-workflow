import assert from 'node:assert/strict';
import { appendFileSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { cliResponse, runCli } from '../phase/helpers.ts';
import { tree } from '../e2e/harness.ts';
import { beginWork, git, WORK_OWNER, workFixture } from './helpers.ts';

function addCorrectiveTask(root: string): void {
  const run = join(root, '.ntworkflow/runs/NT-001');
  appendFileSync(join(run, 'SPEC.md'), '- AC-4: The export includes an explicit schema version.\n');
  const planPath = join(run, 'PLAN.md');
  const plan = readFileSync(planPath, 'utf8').replaceAll('\r\n', '\n')
    .replace('- NT-001-02: NT-001-01', '- NT-001-02: NT-001-01\n- NT-001-03: NT-001-02')
    .replace('2. NT-001-02', '2. NT-001-02\n3. NT-001-03')
    .replace('- NT-001-02: Command integration.', '- NT-001-02: Command integration.\n- NT-001-03: Versioned schema.');
  writeFileSync(planPath, plan);
  writeFileSync(join(run, 'tasks/NT-001-03.md'), `# NT-001-03: Versioned schema

## Goal
Add an explicit schema version.

## Scope
Export schema metadata and direct tests.

## Dependencies
NT-001-02

## Acceptance coverage
AC-4

## Verification
Run \`node --test tests/schema.test.mjs\`; the schema version assertion passes. Retain fresh output.
`);
}

test('unapproved task-list drift blocks the next task without state mutation', () => {
  const root = workFixture();
  try {
    beginWork(root);
    addCorrectiveTask(root);
    const changed = tree(root);
    const stale = runCli(root, 'task', 'begin', 'NT-001-01', '--session-id', WORK_OWNER);
    assert.equal(stale.status, 14, stale.stdout);
    assert.equal(cliResponse(stale).error?.code, 'ARTIFACT_FAILURE');
    assert.deepEqual(tree(root), changed);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a reapproved amendment resets an active boundary and reconciles corrective tasks', () => {
  const root = workFixture();
  try {
    beginWork(root);
    assert.equal(runCli(
      root, 'task', 'begin', 'NT-001-01', '--session-id', WORK_OWNER,
    ).status, 0);
    addCorrectiveTask(root);

    const amended = runCli(
      root, 'plan', 'validate', '--session-id', WORK_OWNER,
      '--critic-pass', '--user-confirmed',
    );
    assert.equal(amended.status, 0, amended.stdout);
    assert.deepEqual(
      cliResponse(amended).state.current?.work?.tasks.map(task => [task.task_id, task.status]),
      [
        ['NT-001-01', 'pending'],
        ['NT-001-02', 'pending'],
        ['NT-001-03', 'pending'],
      ],
    );
    assert.equal(runCli(
      root, 'task', 'begin', 'NT-001-01', '--session-id', WORK_OWNER,
    ).status, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('an interrupted amendment restarts under a user-confirmed recovery owner', () => {
  const root = workFixture();
  try {
    beginWork(root);
    assert.equal(runCli(
      root, 'task', 'begin', 'NT-001-01', '--session-id', WORK_OWNER,
    ).status, 0);
    addCorrectiveTask(root);
    const recoveryOwner = 'codex:amendment-recovery';
    const stopped = runCli(
      root, 'phase', 'stop', 'ntwork', '--session-id', recoveryOwner,
      '--blocker', 'Interrupted amendment must restart.',
      '--interruption', 'user-confirmed',
    );
    assert.equal(stopped.status, 0, stopped.stdout);

    const validated = runCli(
      root, 'plan', 'validate', '--session-id', recoveryOwner,
      '--amendment-recovery',
    );
    assert.equal(validated.status, 0, validated.stdout);
    const approved = runCli(
      root, 'plan', 'validate', '--session-id', recoveryOwner,
      '--critic-pass', '--user-confirmed', '--amendment-recovery',
    );
    assert.equal(approved.status, 0, approved.stdout);
    const current = cliResponse(approved).state.current;
    assert.equal(current?.phase, 'ntwork');
    assert.deepEqual(current?.owner, { session_id: recoveryOwner });
    assert.equal(current?.blocker, null);
    assert.deepEqual(
      current?.work?.tasks.map(task => [task.task_id, task.status]),
      [
        ['NT-001-01', 'pending'],
        ['NT-001-02', 'pending'],
        ['NT-001-03', 'pending'],
      ],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('amendment recovery cannot switch provider inside active ntwork', () => {
  const root = workFixture();
  try {
    beginWork(root);
    addCorrectiveTask(root);
    const recoveryOwner = 'claude:amendment-recovery';
    assert.equal(runCli(
      root, 'phase', 'stop', 'ntwork', '--session-id', recoveryOwner,
      '--blocker', 'Interrupted amendment must restart.',
      '--interruption', 'user-confirmed',
    ).status, 0);
    const before = tree(root);
    const result = runCli(
      root, 'plan', 'validate', '--session-id', recoveryOwner,
      '--critic-pass', '--user-confirmed', '--amendment-recovery',
    );
    assert.equal(result.status, 12, result.stdout);
    assert.equal(cliResponse(result).error?.code, 'OWNERSHIP_CONFLICT');
    assert.deepEqual(tree(root), before);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('amendment recovery rejects a changed Git boundary', () => {
  const root = workFixture();
  try {
    beginWork(root);
    assert.equal(runCli(
      root, 'task', 'begin', 'NT-001-01', '--session-id', WORK_OWNER,
    ).status, 0);
    addCorrectiveTask(root);
    const recoveryOwner = 'codex:amendment-recovery';
    assert.equal(runCli(
      root, 'phase', 'stop', 'ntwork', '--session-id', recoveryOwner,
      '--blocker', 'Interrupted amendment must restart.',
      '--interruption', 'user-confirmed',
    ).status, 0);
    appendFileSync(join(root, 'project.txt'), 'unexpected commit\n');
    git(root, 'add', 'project.txt');
    git(root, 'commit', '--quiet', '-m', 'unexpected recovery boundary');
    const before = tree(root);
    const result = runCli(
      root, 'plan', 'validate', '--session-id', recoveryOwner,
      '--critic-pass', '--user-confirmed', '--amendment-recovery',
    );
    assert.equal(result.status, 14, result.stdout);
    assert.equal(cliResponse(result).error?.code, 'ARTIFACT_FAILURE');
    assert.deepEqual(tree(root), before);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
