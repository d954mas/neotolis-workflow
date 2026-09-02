import assert from 'node:assert/strict';
import { appendFileSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { cliResponse, runCli } from '../phase/helpers.ts';
import { tree } from '../e2e/harness.ts';
import { beginWork, git, WORK_OWNER, WORK_ROLES, workFixture } from './helpers.ts';

test('ntwork requires every native role and enters work-active on the current branch', () => {
  const root = workFixture();
  try {
    for (const missing of WORK_ROLES) {
      const before = tree(root);
      const result = runCli(
        root,
        'phase', 'begin', 'ntwork', '--session-id', WORK_OWNER,
        ...WORK_ROLES.filter((role) => role !== missing),
      );
      assert.equal(result.status, 14, result.stdout);
      assert.equal(cliResponse(result).error?.code, 'ARTIFACT_FAILURE');
      assert.deepEqual(tree(root), before);
    }

    const response = beginWork(root);
    const current = response.state.current;
    assert.equal(current?.lifecycle, 'work-active');
    assert.equal(current?.phase, 'ntwork');
    assert.deepEqual(current?.owner, { session_id: WORK_OWNER });
    assert.equal(current?.work?.provider, 'codex');
    assert.equal(current?.work?.branch, 'main');
    assert.equal(current?.work?.base_branch, 'main');
    assert.equal(current?.work?.head_commit, git(root, 'rev-parse', 'HEAD'));
    assert.deepEqual(current?.work?.tasks.map((task) => task.status), ['pending', 'pending']);
    assert.equal(response.next_action.skill, 'ntwork');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('ntwork begin validates approved artifacts before state mutation', () => {
  const root = workFixture();
  try {
    const plan = join(root, '.ntworkflow/runs/NT-001/PLAN.md');
    const original = readFileSync(plan);
    const before = tree(root);
    rmSync(plan);
    const missing = tree(root);
    const result = runCli(
      root,
      'phase', 'begin', 'ntwork', '--session-id', WORK_OWNER,
      ...WORK_ROLES,
    );
    assert.equal(result.status, 14, result.stdout);
    assert.deepEqual(tree(root), missing);
    assert.notDeepEqual(missing, before);
    assert.ok(original.length > 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('ntwork requires explicit authority for pre-existing project changes', () => {
  const root = workFixture();
  try {
    appendFileSync(join(root, 'project.txt'), 'user change\n');
    const dirty = tree(root);
    const blocked = runCli(
      root, 'phase', 'begin', 'ntwork', '--session-id', WORK_OWNER, ...WORK_ROLES,
    );
    assert.equal(blocked.status, 14, blocked.stdout);
    assert.deepEqual(tree(root), dirty);

    const allowed = runCli(
      root, 'phase', 'begin', 'ntwork', '--session-id', WORK_OWNER,
      ...WORK_ROLES, '--existing-changes-confirmed',
    );
    assert.equal(allowed.status, 0, allowed.stdout);
    const task = runCli(
      root, 'task', 'begin', 'NT-001-01', '--session-id', WORK_OWNER,
      '--existing-changes-confirmed',
    );
    assert.equal(task.status, 0, task.stdout);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('an interrupted active task resumes only with explicit authority under the same provider', () => {
  const root = workFixture();
  try {
    beginWork(root);
    assert.equal(runCli(
      root, 'task', 'begin', 'NT-001-01', '--session-id', WORK_OWNER,
    ).status, 0);
    appendFileSync(join(root, 'project.txt'), 'partial task work\n');
    const dirty = tree(root);
    const wrongProvider = runCli(
      root, 'phase', 'begin', 'ntwork', '--session-id', 'claude:replacement',
      ...WORK_ROLES, '--interruption', 'user-confirmed',
    );
    assert.equal(wrongProvider.status, 12, wrongProvider.stdout);
    assert.deepEqual(tree(root), dirty);

    const replacement = runCli(
      root, 'phase', 'begin', 'ntwork', '--session-id', 'codex:replacement',
      ...WORK_ROLES, '--interruption', 'provider-ended',
    );
    assert.equal(replacement.status, 0, replacement.stdout);
    assert.deepEqual(cliResponse(replacement).state.current?.owner, {
      session_id: 'codex:replacement',
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('optional delivery context records an explicit base and one stable pull request identity', () => {
  const root = workFixture();
  try {
    const begun = runCli(
      root, 'phase', 'begin', 'ntwork', '--session-id', WORK_OWNER,
      ...WORK_ROLES, '--base-branch', 'trunk',
    );
    assert.equal(begun.status, 0, begun.stdout);
    assert.equal(cliResponse(begun).state.current?.work?.base_branch, 'trunk');

    const record = () => runCli(
      root, 'work', 'record', 'pull-request', '--session-id', WORK_OWNER,
      '--id', '42', '--url', 'https://example.invalid/pull/42',
    );
    const first = record();
    assert.equal(first.status, 0, first.stdout);
    assert.deepEqual(cliResponse(first).state.current?.work?.pull_request, {
      id: '42', url: 'https://example.invalid/pull/42',
    });
    assert.equal(record().status, 0);

    const recorded = tree(root);
    const mismatch = runCli(
      root, 'work', 'record', 'pull-request', '--session-id', WORK_OWNER,
      '--id', '43', '--url', 'https://example.invalid/pull/43',
    );
    assert.equal(mismatch.status, 14, mismatch.stdout);
    assert.deepEqual(tree(root), recorded);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('delivery-ready invocation diagnoses lifecycle before roles or Git context', () => {
  const root = workFixture();
  try {
    writeFileSync(
      join(root, '.ntworkflow/state.json'),
      readFileSync('tests/fixtures/states/delivery-ready.json'),
    );
    const before = tree(root);
    const result = runCli(
      root, 'phase', 'begin', 'ntwork', '--session-id', WORK_OWNER,
    );
    assert.equal(result.status, 11, result.stdout);
    assert.equal(cliResponse(result).error?.code, 'ILLEGAL_TRANSITION');
    assert.deepEqual(tree(root), before);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
