import assert from 'node:assert/strict';
import { appendFileSync, rmSync } from 'node:fs';
import test from 'node:test';

import { cliResponse, runCli } from '../phase/helpers.ts';
import { tree } from '../e2e/harness.ts';
import { beginWork, git, WORK_OWNER, WORK_ROLES, workFixture } from './helpers.ts';

test('task begin selects only the exact next task and records its durable Git boundary', () => {
  const root = workFixture();
  try {
    beginWork(root);
    const reject = (taskId: string, exitCode: number, code: string) => {
      const before = tree(root);
      const result = runCli(
        root,
        'task', 'begin', taskId, '--session-id', WORK_OWNER,
      );
      assert.equal(result.status, exitCode, result.stdout);
      assert.equal(cliResponse(result).error?.code, code);
      assert.deepEqual(tree(root), before);
    };

    reject('NT-001-02', 11, 'ILLEGAL_TRANSITION');
    reject('NT-001-99', 11, 'ILLEGAL_TRANSITION');

    const head = git(root, 'rev-parse', 'HEAD');
    const result = runCli(
      root,
      'task', 'begin', 'NT-001-01', '--session-id', WORK_OWNER,
    );
    assert.equal(result.status, 0, result.stdout);
    const tasks = cliResponse(result).state.current?.work?.tasks;
    assert.deepEqual(tasks?.map((task) => ({
      id: task.task_id,
      status: task.status,
      start: task.start_commit,
    })), [
      { id: 'NT-001-01', status: 'active', start: head },
      { id: 'NT-001-02', status: 'pending', start: null },
    ]);
    reject('NT-001-01', 11, 'ILLEGAL_TRANSITION');
    reject('NT-001-02', 11, 'ILLEGAL_TRANSITION');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('task mutation requires the recorded ntwork owner', () => {
  const root = workFixture();
  try {
    beginWork(root);
    const before = tree(root);
    const result = runCli(
      root,
      'task', 'begin', 'NT-001-01', '--session-id', 'codex:other-primary',
    );
    assert.equal(result.status, 12, result.stdout);
    assert.equal(cliResponse(result).error?.code, 'OWNERSHIP_CONFLICT');
    assert.deepEqual(tree(root), before);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('task completion requires evidence, both reviewer passes and one dedicated commit', () => {
  const root = workFixture();
  try {
    beginWork(root);
    assert.equal(runCli(
      root,
      'task', 'begin', 'NT-001-01', '--session-id', WORK_OWNER,
    ).status, 0);
    appendFileSync(`${root}/project.txt`, 'task one\n');

    const evidence = runCli(
      root,
      'work', 'record', 'evidence',
      '--session-id', WORK_OWNER,
      '--gate', 'task:NT-001-01',
      '--procedure', 'node --test focused.test.ts',
      '--result', 'passed',
      '--expected', 'all focused tests pass',
      '--source-id', 'primary:focused-run',
    );
    assert.equal(evidence.status, 0, evidence.stdout);

    const review = runCli(
      root,
      'work', 'record', 'task-review', 'NT-001-01',
      '--session-id', WORK_OWNER,
      '--packet', 'pass',
      '--quality', 'pass',
      '--source-id', 'native:task-reviewer-1',
    );
    assert.equal(review.status, 0, review.stdout);

    const beforeCommit = tree(root);
    const premature = runCli(
      root,
      'task', 'complete', 'NT-001-01', '--session-id', WORK_OWNER,
      '--commit-id', git(root, 'rev-parse', 'HEAD'),
    );
    assert.equal(premature.status, 14, premature.stdout);
    assert.deepEqual(tree(root), beforeCommit);

    git(root, 'add', 'project.txt');
    git(root, 'commit', '--quiet', '-m', 'complete NT-001-01');
    const commit = git(root, 'rev-parse', 'HEAD');
    const complete = runCli(
      root,
      'task', 'complete', 'NT-001-01', '--session-id', WORK_OWNER,
      '--commit-id', commit,
    );
    assert.equal(complete.status, 0, complete.stdout);
    const current = cliResponse(complete).state.current;
    assert.deepEqual(current?.work?.tasks[0], {
      task_id: 'NT-001-01',
      status: 'completed',
      start_commit: git(root, 'rev-parse', `${commit}^`),
      commit_id: commit,
      packet_review: 'pass',
      quality_review: 'pass',
    });
    assert.equal(current?.work?.head_commit, commit);
    assert.ok(current?.work?.evidence.every((item) => item.revision === commit));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('re-entry reuses one already-created active task commit without duplicating it', () => {
  const root = workFixture();
  try {
    beginWork(root);
    assert.equal(runCli(root, 'task', 'begin', 'NT-001-01', '--session-id', WORK_OWNER).status, 0);
    appendFileSync(`${root}/project.txt`, 'task one\n');
    assert.equal(runCli(
      root, 'work', 'record', 'evidence', '--session-id', WORK_OWNER,
      '--gate', 'task:NT-001-01', '--procedure', 'focused test', '--result', 'pass',
      '--expected', 'pass', '--source-id', 'primary:focused',
    ).status, 0);
    assert.equal(runCli(
      root, 'work', 'record', 'task-review', 'NT-001-01', '--session-id', WORK_OWNER,
      '--packet', 'pass', '--quality', 'pass', '--source-id', 'native:review',
    ).status, 0);
    git(root, 'add', 'project.txt');
    git(root, 'commit', '--quiet', '-m', 'complete NT-001-01');
    const commit = git(root, 'rev-parse', 'HEAD');
    const resumed = runCli(
      root, 'phase', 'begin', 'ntwork', '--session-id', 'codex:resumed',
      ...WORK_ROLES, '--interruption', 'provider-ended',
    );
    assert.equal(resumed.status, 0, resumed.stdout);
    const completed = runCli(
      root, 'task', 'complete', 'NT-001-01', '--session-id', 'codex:resumed',
      '--commit-id', commit,
    );
    assert.equal(completed.status, 0, completed.stdout);
    assert.equal(git(root, 'rev-list', '--count', 'HEAD'), '2');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('re-recording canonical evidence invalidates the prior task review', () => {
  const root = workFixture();
  try {
    beginWork(root);
    assert.equal(runCli(root, 'task', 'begin', 'NT-001-01', '--session-id', WORK_OWNER).status, 0);
    appendFileSync(`${root}/project.txt`, 'task edit\n');
    assert.equal(runCli(
      root, 'work', 'record', 'evidence', '--session-id', WORK_OWNER,
      '--gate', 'task:NT-001-01', '--procedure', 'focused test',
      '--result', 'pass', '--expected', 'pass', '--source-id', 'primary:first',
    ).status, 0);
    assert.equal(runCli(
      root, 'work', 'record', 'task-review', 'NT-001-01', '--session-id', WORK_OWNER,
      '--packet', 'pass', '--quality', 'pass', '--source-id', 'native:first',
    ).status, 0);
    assert.equal(runCli(
      root, 'work', 'record', 'evidence', '--session-id', WORK_OWNER,
      '--gate', 'task:NT-001-01', '--procedure', 'canonical rerun',
      '--result', 'pass', '--expected', 'pass', '--source-id', 'primary:rerun',
    ).status, 0);
    git(root, 'add', 'project.txt');
    git(root, 'commit', '--quiet', '-m', 'task without refreshed review');
    const before = tree(root);
    const result = runCli(
      root, 'task', 'complete', 'NT-001-01', '--session-id', WORK_OWNER,
      '--commit-id', git(root, 'rev-parse', 'HEAD'),
    );
    assert.equal(result.status, 14, result.stdout);
    assert.deepEqual(tree(root), before);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a blocking review is fixed and rerun before the single task commit', () => {
  const root = workFixture();
  try {
    beginWork(root);
    assert.equal(runCli(root, 'task', 'begin', 'NT-001-01', '--session-id', WORK_OWNER).status, 0);
    appendFileSync(`${root}/project.txt`, 'first attempt\n');
    const evidence = () => runCli(
      root, 'work', 'record', 'evidence', '--session-id', WORK_OWNER,
      '--gate', 'task:NT-001-01', '--procedure', 'focused test',
      '--result', 'pass', '--expected', 'pass', '--source-id', 'primary:focused',
    );
    assert.equal(evidence().status, 0);
    assert.equal(runCli(
      root, 'work', 'record', 'task-review', 'NT-001-01', '--session-id', WORK_OWNER,
      '--packet', 'block', '--quality', 'block', '--source-id', 'native:first',
    ).status, 0);

    appendFileSync(`${root}/project.txt`, 'review fix\n');
    assert.equal(evidence().status, 0);
    assert.equal(runCli(
      root, 'work', 'record', 'task-review', 'NT-001-01', '--session-id', WORK_OWNER,
      '--packet', 'pass', '--quality', 'pass', '--source-id', 'native:rerun',
    ).status, 0);
    git(root, 'add', 'project.txt');
    git(root, 'commit', '--quiet', '-m', 'complete reviewed task');
    const commit = git(root, 'rev-parse', 'HEAD');
    const complete = runCli(
      root, 'task', 'complete', 'NT-001-01', '--session-id', WORK_OWNER,
      '--commit-id', commit,
    );
    assert.equal(complete.status, 0, complete.stdout);
    assert.equal(git(root, 'rev-list', '--count', 'HEAD'), '2');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('blocking task review cannot close a task', () => {
  const root = workFixture();
  try {
    beginWork(root);
    assert.equal(runCli(root, 'task', 'begin', 'NT-001-01', '--session-id', WORK_OWNER).status, 0);
    appendFileSync(`${root}/project.txt`, 'task change\n');
    assert.equal(runCli(
      root, 'work', 'record', 'evidence', '--session-id', WORK_OWNER,
      '--gate', 'task:NT-001-01', '--procedure', 'focused test',
      '--result', 'one test failed', '--expected', 'pass', '--source-id', 'primary:red',
    ).status, 0);
    const review = runCli(
      root, 'work', 'record', 'task-review', 'NT-001-01', '--session-id', WORK_OWNER,
      '--packet', 'block', '--quality', 'block', '--source-id', 'native:review',
    );
    assert.equal(review.status, 0, review.stdout);
    git(root, 'add', 'project.txt');
    git(root, 'commit', '--quiet', '-m', 'red task');
    const result = runCli(
      root, 'task', 'complete', 'NT-001-01', '--session-id', WORK_OWNER,
      '--commit-id', git(root, 'rev-parse', 'HEAD'),
    );
    assert.equal(result.status, 14, result.stdout);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
