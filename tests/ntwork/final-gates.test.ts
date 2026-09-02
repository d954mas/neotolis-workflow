import assert from 'node:assert/strict';
import { appendFileSync, rmSync } from 'node:fs';
import test from 'node:test';

import { cliResponse, runCli } from '../phase/helpers.ts';
import { tree } from '../e2e/harness.ts';
import { beginWork, git, WORK_OWNER, WORK_ROLES, workFixture } from './helpers.ts';

function completeTask(root: string, taskId: string): void {
  assert.equal(runCli(root, 'task', 'begin', taskId, '--session-id', WORK_OWNER).status, 0);
  appendFileSync(`${root}/project.txt`, `${taskId}\n`);
  assert.equal(runCli(
    root, 'work', 'record', 'evidence', '--session-id', WORK_OWNER,
    '--gate', `task:${taskId}`, '--procedure', `verify ${taskId}`,
    '--result', 'passed', '--expected', 'passed', '--source-id', `primary:${taskId}`,
  ).status, 0);
  assert.equal(runCli(
    root, 'work', 'record', 'task-review', taskId, '--session-id', WORK_OWNER,
    '--packet', 'pass', '--quality', 'pass', '--source-id', `reviewer:${taskId}`,
  ).status, 0);
  git(root, 'add', 'project.txt');
  git(root, 'commit', '--quiet', '-m', `complete ${taskId}`);
  const commit = git(root, 'rev-parse', 'HEAD');
  const completed = runCli(
    root, 'task', 'complete', taskId, '--session-id', WORK_OWNER,
    '--commit-id', commit,
  );
  assert.equal(completed.status, 0, completed.stdout);
}

function recordGate(
  root: string,
  gate: string,
  verdict: 'pass' | 'fail' | 'block' | 'not-required',
): ReturnType<typeof runCli> {
  return runCli(
    root, 'work', 'record', 'gate', gate, '--session-id', WORK_OWNER,
    '--verdict', verdict, '--procedure', `check ${gate}`, '--result', verdict,
    '--expected', gate === 'ci' ? 'pass or not-required' : 'pass',
    '--source-id', `native:${gate}`,
  );
}

test('delivery-ready requires whole-plan, three independent reviews and applicable CI on one revision', () => {
  const root = workFixture();
  try {
    beginWork(root);
    completeTask(root, 'NT-001-01');
    completeTask(root, 'NT-001-02');

    const beforeReview = tree(root);
    const prematureReview = recordGate(root, 'nyquist', 'pass');
    assert.equal(prematureReview.status, 11, prematureReview.stdout);
    assert.deepEqual(tree(root), beforeReview);

    assert.equal(recordGate(root, 'whole-plan', 'pass').status, 0);
    assert.equal(recordGate(root, 'nyquist', 'pass').status, 0);
    assert.equal(recordGate(root, 'spec-integration', 'pass').status, 0);
    assert.equal(recordGate(root, 'code-review', 'pass').status, 0);

    const missingCi = runCli(
      root, 'phase', 'complete', 'ntwork', '--session-id', WORK_OWNER,
    );
    assert.equal(missingCi.status, 14, missingCi.stdout);
    assert.equal(recordGate(root, 'ci', 'not-required').status, 0);

    const complete = runCli(
      root, 'phase', 'complete', 'ntwork', '--session-id', WORK_OWNER,
    );
    assert.equal(complete.status, 0, complete.stdout);
    const current = cliResponse(complete).state.current;
    assert.equal(current?.lifecycle, 'delivery-ready');
    assert.equal(current?.phase, 'delivery-ready');
    assert.equal(current?.owner, null);
    assert.deepEqual(current?.work?.verdicts, {
      whole_plan: 'pass',
      nyquist: 'pass',
      spec_integration: 'pass',
      code_review: 'pass',
      ci: 'not-required',
    });
    const head = git(root, 'rev-parse', 'HEAD');
    for (const gate of ['whole-plan', 'nyquist', 'spec-integration', 'code-review', 'ci']) {
      assert.equal(current?.work?.evidence.find((item) => item.gate === gate)?.revision, head);
    }

    const delivered = tree(root);
    const late = runCli(
      root, 'phase', 'begin', 'ntwork', '--session-id', WORK_OWNER, ...WORK_ROLES,
    );
    assert.equal(late.status, 11, late.stdout);
    assert.deepEqual(tree(root), delivered);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a recorded fix commit invalidates every final gate until the complete gate reruns', () => {
  const root = workFixture();
  try {
    beginWork(root);
    completeTask(root, 'NT-001-01');
    completeTask(root, 'NT-001-02');
    for (const [gate, verdict] of [
      ['whole-plan', 'pass'], ['nyquist', 'pass'], ['spec-integration', 'pass'],
      ['code-review', 'pass'], ['ci', 'not-required'],
    ] as const) assert.equal(recordGate(root, gate, verdict).status, 0);

    appendFileSync(`${root}/project.txt`, 'review fix\n');
    assert.equal(runCli(
      root, 'work', 'record', 'evidence', '--session-id', WORK_OWNER,
      '--gate', 'fix:integration', '--procedure', 'focused regression',
      '--result', 'pass', '--expected', 'pass', '--source-id', 'primary:fix-review',
    ).status, 0);
    assert.equal(runCli(
      root, 'work', 'record', 'task-review', 'integration', '--session-id', WORK_OWNER,
      '--packet', 'pass', '--quality', 'pass', '--source-id', 'native:fix-review',
    ).status, 0);
    git(root, 'add', 'project.txt');
    git(root, 'commit', '--quiet', '-m', 'fix final review finding');
    const fix = git(root, 'rev-parse', 'HEAD');
    const recorded = runCli(
      root, 'work', 'record', 'fix-commit', '--session-id', WORK_OWNER,
      '--scope', 'integration', '--commit-id', fix, '--procedure', 'focused regression', '--result', 'pass',
      '--expected', 'pass', '--source-id', 'primary:fix-review',
    );
    assert.equal(recorded.status, 0, recorded.stdout);
    const work = cliResponse(recorded).state.current?.work;
    assert.deepEqual(work?.fix_commits, [fix]);
    assert.deepEqual(work?.verdicts, {
      whole_plan: 'pending', nyquist: 'pending', spec_integration: 'pending',
      code_review: 'pending', ci: 'pending',
    });
    assert.equal(work?.evidence.some((item) => item.gate === 'whole-plan'), false);

    for (const [gate, verdict] of [
      ['whole-plan', 'pass'], ['nyquist', 'pass'], ['spec-integration', 'pass'],
      ['code-review', 'pass'], ['ci', 'not-required'],
    ] as const) assert.equal(recordGate(root, gate, verdict).status, 0);
    const complete = runCli(root, 'phase', 'complete', 'ntwork', '--session-id', WORK_OWNER);
    assert.equal(complete.status, 0, complete.stdout);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('known red CI between tasks requires a reviewed direct fix before work continues', () => {
  const root = workFixture();
  try {
    beginWork(root);
    completeTask(root, 'NT-001-01');
    assert.equal(recordGate(root, 'ci', 'fail').status, 0);
    const red = tree(root);
    const blocked = runCli(
      root, 'task', 'begin', 'NT-001-02', '--session-id', WORK_OWNER,
    );
    assert.equal(blocked.status, 11, blocked.stdout);
    assert.deepEqual(tree(root), red);

    const retry = recordGate(root, 'ci', 'pass');
    assert.equal(retry.status, 14, retry.stdout);
    appendFileSync(`${root}/project.txt`, 'ci fix\n');
    assert.equal(runCli(
      root, 'work', 'record', 'evidence', '--session-id', WORK_OWNER,
      '--gate', 'fix:integration', '--procedure', 'ci reproduction',
      '--result', 'pass', '--expected', 'pass', '--source-id', 'primary:ci-fix',
    ).status, 0);
    assert.equal(runCli(
      root, 'work', 'record', 'task-review', 'integration', '--session-id', WORK_OWNER,
      '--packet', 'pass', '--quality', 'pass', '--source-id', 'native:ci-fix',
    ).status, 0);
    git(root, 'add', 'project.txt');
    git(root, 'commit', '--quiet', '-m', 'fix red CI');
    const fix = git(root, 'rev-parse', 'HEAD');
    assert.equal(runCli(
      root, 'work', 'record', 'fix-commit', '--session-id', WORK_OWNER,
      '--scope', 'integration', '--commit-id', fix, '--procedure', 'ci reproduction',
      '--result', 'pass', '--expected', 'pass', '--source-id', 'primary:ci-fix',
    ).status, 0);
    const allowed = runCli(
      root, 'task', 'begin', 'NT-001-02', '--session-id', WORK_OWNER,
    );
    assert.equal(allowed.status, 0, allowed.stdout);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a task commit may resolve CI that failed while that task was active', () => {
  const root = workFixture();
  try {
    beginWork(root);
    assert.equal(runCli(
      root, 'task', 'begin', 'NT-001-01', '--session-id', WORK_OWNER,
    ).status, 0);
    assert.equal(recordGate(root, 'ci', 'fail').status, 0);
    appendFileSync(`${root}/project.txt`, 'active task CI fix\n');
    assert.equal(runCli(
      root, 'work', 'record', 'evidence', '--session-id', WORK_OWNER,
      '--gate', 'task:NT-001-01', '--procedure', 'focused CI reproduction',
      '--result', 'pass', '--expected', 'pass', '--source-id', 'primary:active-ci',
    ).status, 0);
    assert.equal(runCli(
      root, 'work', 'record', 'task-review', 'NT-001-01', '--session-id', WORK_OWNER,
      '--packet', 'pass', '--quality', 'pass', '--source-id', 'native:active-ci',
    ).status, 0);
    git(root, 'add', 'project.txt');
    git(root, 'commit', '--quiet', '-m', 'complete task and fix CI');
    const commit = git(root, 'rev-parse', 'HEAD');
    assert.equal(runCli(
      root, 'task', 'complete', 'NT-001-01', '--session-id', WORK_OWNER,
      '--commit-id', commit,
    ).status, 0);
    const green = recordGate(root, 'ci', 'pass');
    assert.equal(green.status, 0, green.stdout);
    assert.equal(cliResponse(green).state.current?.work?.verdicts.ci, 'pass');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CI and integration-fix evidence are illegal before the first approved task boundary', () => {
  const root = workFixture();
  try {
    beginWork(root);
    const untouched = tree(root);
    const earlyCi = recordGate(root, 'ci', 'fail');
    assert.equal(earlyCi.status, 11, earlyCi.stdout);
    assert.deepEqual(tree(root), untouched);
    appendFileSync(`${root}/project.txt`, 'unapproved bypass\n');
    const before = tree(root);
    const result = runCli(
      root, 'work', 'record', 'evidence', '--session-id', WORK_OWNER,
      '--gate', 'fix:integration', '--procedure', 'bypass', '--result', 'pass',
      '--expected', 'pass', '--source-id', 'primary:bypass',
    );
    assert.equal(result.status, 11, result.stdout);
    assert.deepEqual(tree(root), before);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('negative final gates are sticky on the same revision', () => {
  for (const gate of ['whole-plan', 'ci'] as const) {
    const root = workFixture();
    try {
      beginWork(root);
      if (gate === 'whole-plan') {
        completeTask(root, 'NT-001-01');
        completeTask(root, 'NT-001-02');
      } else {
        completeTask(root, 'NT-001-01');
      }
      const negative = gate === 'whole-plan' ? 'fail' : 'fail';
      assert.equal(recordGate(root, gate, negative).status, 0);
      const before = tree(root);
      const retry = recordGate(root, gate, 'pass');
      assert.equal(retry.status, 14, retry.stdout);
      assert.deepEqual(tree(root), before);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test('a blocking fix review cannot authorize the fix commit', () => {
  const root = workFixture();
  try {
    beginWork(root);
    completeTask(root, 'NT-001-01');
    appendFileSync(`${root}/project.txt`, 'bad fix\n');
    assert.equal(runCli(
      root, 'work', 'record', 'evidence', '--session-id', WORK_OWNER,
      '--gate', 'fix:NT-001-01', '--procedure', 'focused test', '--result', 'failed',
      '--expected', 'pass', '--source-id', 'primary:bad-fix',
    ).status, 0);
    assert.equal(runCli(
      root, 'work', 'record', 'task-review', 'NT-001-01', '--session-id', WORK_OWNER,
      '--packet', 'block', '--quality', 'block', '--source-id', 'native:bad-fix',
    ).status, 0);
    git(root, 'add', 'project.txt');
    git(root, 'commit', '--quiet', '-m', 'unaccepted fix');
    const before = tree(root);
    const result = runCli(
      root, 'work', 'record', 'fix-commit', '--session-id', WORK_OWNER,
      '--scope', 'NT-001-01', '--commit-id', git(root, 'rev-parse', 'HEAD'),
      '--procedure', 'focused test', '--result', 'failed', '--expected', 'pass',
      '--source-id', 'primary:bad-fix',
    );
    assert.equal(result.status, 14, result.stdout);
    assert.deepEqual(tree(root), before);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
