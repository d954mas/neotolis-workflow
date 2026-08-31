import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { ERROR_CODES, WorkflowError } from '../../src/core/errors.ts';
import type { State } from '../../src/core/state.ts';
import { completeNttaskPhase } from '../../src/runtime/nttask.ts';

const OWNER = 'codex:tb-07-primary';

function projectFixture(name: string): string {
  const root = mkdtempSync(join(tmpdir(), `ntworkflow-nttask-${name}-`));
  mkdirSync(join(root, '.git'));
  writeFileSync(join(root, '.git', 'config'), '[core]\n\trepositoryformatversion = 0\n');
  writeFileSync(join(root, '.gitignore'), 'dist/\n');
  return root;
}

function runCli(project: string, ...command: string[]) {
  return spawnSync(
    process.execPath,
    ['src/cli/main.ts', '--cwd', project, ...command],
    { encoding: 'utf8' },
  );
}

function response(result: ReturnType<typeof runCli>) {
  assert.equal(result.stderr, '');
  return JSON.parse(result.stdout) as {
    ok: boolean;
    state: State;
    next_action: { skill: string | null; instruction: string };
    error?: { code: string; exit_code: number };
  };
}

function statePath(project: string): string {
  return join(project, '.ntworkflow', 'state.json');
}

function briefPath(project: string, runId = 'NT-001'): string {
  return join(project, '.ntworkflow', 'runs', runId, 'BRIEF.md');
}

function fixtureBrief(name: string): Buffer {
  return readFileSync(join('tests', 'fixtures', 'briefs', name));
}

function writeBrief(project: string, fixture: string): Buffer {
  const bytes = fixtureBrief(fixture);
  writeFileSync(briefPath(project), bytes);
  return bytes;
}

function startAndBegin(project: string): void {
  assert.equal(runCli(project, 'run', 'start', '--session-id', OWNER).status, 0);
  assert.equal(runCli(
    project,
    'phase', 'begin', 'nttask', '--session-id', OWNER,
  ).status, 0);
}

function rootEntries(project: string): string[] {
  return readdirSync(project).sort();
}

test('valid BRIEF completes nttask and preserves Unicode bytes', () => {
  const project = projectFixture('valid-юникод');
  const nested = join(project, 'папка', 'вложенная');
  mkdirSync(nested, { recursive: true });
  const gitConfigBefore = readFileSync(join(project, '.git', 'config'));
  const gitignoreBefore = readFileSync(join(project, '.gitignore'));

  try {
    startAndBegin(nested);
    const briefBefore = writeBrief(project, 'valid.md');
    const result = runCli(
      nested,
      'phase', 'complete', 'nttask', '--session-id', OWNER,
    );
    const body = response(result);

    assert.equal(result.status, 0);
    assert.deepEqual(body.state.current, {
      run_id: 'NT-001',
      lifecycle: 'brief-ready',
      phase: null,
      owner: null,
      blocker: null,
      work: null,
    });
    assert.deepEqual(body.next_action, {
      skill: 'ntgrill',
      instruction: 'Continue with ntgrill.',
    });
    assert.deepEqual(readFileSync(briefPath(project)), briefBefore);
    assert.deepEqual(readFileSync(join(project, '.git', 'config')), gitConfigBefore);
    assert.deepEqual(readFileSync(join(project, '.gitignore')), gitignoreBefore);
    assert.deepEqual(rootEntries(project), ['.git', '.gitignore', '.ntworkflow', 'папка']);
    assert.deepEqual(readdirSync(nested), []);
  } finally {
    rmSync(project, { force: true, recursive: true });
  }
});

for (const fixture of [
  'missing-section.md',
  'duplicate-section.md',
  'empty-section.md',
  'out-of-order.md',
  'unknown-section.md',
  'empty-title.md',
  'duplicate-title.md',
  'duplicate-open-questions.md',
  'early-open-questions.md',
] as const) {
  test(`invalid BRIEF blocks completion without mutation: ${fixture}`, async () => {
    const project = projectFixture(fixture);
    try {
      startAndBegin(project);
      const briefBefore = writeBrief(project, fixture);
      const stateBefore = readFileSync(statePath(project));

      await assert.rejects(
        completeNttaskPhase(project, { sessionId: OWNER }),
        (error: unknown) => {
          assert.ok(error instanceof WorkflowError);
          assert.equal(error.code, ERROR_CODES.ARTIFACT_FAILURE);
          assert.equal(error.exitCode, 14);
          return true;
        },
      );
      assert.deepEqual(readFileSync(statePath(project)), stateBefore);
      assert.deepEqual(readFileSync(briefPath(project)), briefBefore);
    } finally {
      rmSync(project, { force: true, recursive: true });
    }
  });
}

test('missing BRIEF blocks completion without creating or repairing it', async () => {
  const project = projectFixture('missing');
  try {
    startAndBegin(project);
    const stateBefore = readFileSync(statePath(project));

    await assert.rejects(
      completeNttaskPhase(project, { sessionId: OWNER }),
      (error: unknown) => {
        assert.ok(error instanceof WorkflowError);
        assert.equal(error.code, ERROR_CODES.ARTIFACT_FAILURE);
        return true;
      },
    );
    assert.deepEqual(readFileSync(statePath(project)), stateBefore);
    assert.equal(readdirSync(join(project, '.ntworkflow', 'runs', 'NT-001')).length, 0);
  } finally {
    rmSync(project, { force: true, recursive: true });
  }
});

test('brief-ready nttask re-entry is read-only and directs ntgrill', () => {
  const project = projectFixture('re-entry');
  try {
    startAndBegin(project);
    const briefBefore = writeBrief(project, 'valid.md');
    assert.equal(runCli(
      project,
      'phase', 'complete', 'nttask', '--session-id', OWNER,
    ).status, 0);
    const stateBefore = readFileSync(statePath(project));

    const reentry = runCli(
      project,
      'phase', 'begin', 'nttask', '--session-id', 'claude:new-primary',
    );
    const body = response(reentry);

    assert.equal(reentry.status, 11);
    assert.equal(body.error?.code, ERROR_CODES.ILLEGAL_TRANSITION);
    assert.equal(body.next_action.skill, 'ntgrill');
    assert.deepEqual(readFileSync(statePath(project)), stateBefore);
    assert.deepEqual(readFileSync(briefPath(project)), briefBefore);
  } finally {
    rmSync(project, { force: true, recursive: true });
  }
});

test('stop, confirmed restart, and cancel preserve the durable intake boundary', () => {
  const project = projectFixture('stop-cancel');
  try {
    startAndBegin(project);
    const stop = runCli(
      project,
      'phase', 'stop', 'nttask', '--session-id', OWNER,
      '--blocker', 'Нужен доступ к источнику.',
    );
    assert.equal(stop.status, 0);

    const unconfirmed = runCli(
      project,
      'phase', 'begin', 'nttask', '--session-id', 'claude:replacement',
    );
    assert.equal(unconfirmed.status, 13);

    const restarted = runCli(
      project,
      'phase', 'begin', 'nttask', '--session-id', 'claude:replacement',
      '--blocker-resolved',
    );
    assert.equal(restarted.status, 0);
    const canceled = runCli(
      project,
      'run', 'cancel', '--session-id', 'claude:replacement', '--user-confirmed',
    );
    assert.equal(canceled.status, 0);
    assert.equal(response(canceled).state.current, null);
    assert.deepEqual(rootEntries(project), ['.git', '.gitignore', '.ntworkflow']);
  } finally {
    rmSync(project, { force: true, recursive: true });
  }
});
