import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
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

import { parseArguments } from '../../src/cli/arguments.ts';
import { ERROR_CODES, WorkflowError } from '../../src/core/errors.ts';
import type { State } from '../../src/core/state.ts';
import {
  cancelRun,
  completeRun,
  startRun,
} from '../../src/runtime/run.ts';

const SESSION_ID = 'codex:run-tests';

function temporaryProject(name: string, state?: State): string {
  const project = mkdtempSync(join(tmpdir(), `ntworkflow-run-${name}-`));
  mkdirSync(join(project, '.git'));
  if (state !== undefined) {
    mkdirSync(join(project, '.ntworkflow'));
    writeFileSync(
      join(project, '.ntworkflow', 'state.json'),
      `${JSON.stringify(state, null, 2)}\n`,
    );
  }
  return project;
}

function fixtureState(name: string): State {
  return JSON.parse(
    readFileSync(join('tests', 'fixtures', 'states', name), 'utf8'),
  ) as State;
}

function readState(project: string): State {
  return JSON.parse(
    readFileSync(join(project, '.ntworkflow', 'state.json'), 'utf8'),
  ) as State;
}

function snapshotTree(root: string, directory = root): Record<string, string> {
  const snapshot: Record<string, string> = {};
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = join(directory, entry.name);
    const relativePath = absolutePath.slice(root.length + 1).replaceAll('\\', '/');
    if (entry.isDirectory()) {
      snapshot[`${relativePath}/`] = 'directory';
      Object.assign(snapshot, snapshotTree(root, absolutePath));
    } else {
      snapshot[relativePath] = readFileSync(absolutePath).toString('base64');
    }
  }
  return snapshot;
}

function ensureCurrentRunDirectory(project: string, state: State): string {
  assert.ok(state.current !== null);
  const runDirectory = join(project, '.ntworkflow', 'runs', state.current.run_id);
  mkdirSync(runDirectory, { recursive: true });
  return runDirectory;
}

async function expectWorkflowError(
  promise: Promise<unknown>,
  code: string,
  exitCode: number,
): Promise<WorkflowError> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof WorkflowError);
    assert.equal(error.code, code);
    assert.equal(error.exitCode, exitCode);
    return error;
  }
  assert.fail(`Expected ${code}.`);
}

function runCli(cwd: string, ...command: string[]) {
  return spawnSync(
    process.execPath,
    ['src/cli/main.ts', '--cwd', cwd, ...command],
    { encoding: 'utf8' },
  );
}

test('run start rejects a project outside Git without mutation', async () => {
  const project = mkdtempSync(join(tmpdir(), 'ntworkflow-run-no-git-'));
  try {
    const before = snapshotTree(project);
    const error = await expectWorkflowError(
      startRun(project, { sessionId: SESSION_ID }),
      ERROR_CODES.INVALID_INPUT,
      2,
    );

    assert.deepEqual(error.details, { project_root: project });
    assert.deepEqual(snapshotTree(project), before);
  } finally {
    rmSync(project, { force: true, recursive: true });
  }
});
test('first-run-is-NT-001', async () => {
  const project = temporaryProject('first');
  try {
    const result = await startRun(project, { sessionId: SESSION_ID });

    assert.deepEqual(result.state, {
      next_work_number: 2,
      current: {
        run_id: 'NT-001',
        lifecycle: 'intake-active',
        phase: null,
        owner: null,
        blocker: null,
        work: null,
      },
    });
    assert.deepEqual(readState(project), result.state);
    assert.equal(existsSync(join(project, '.ntworkflow', 'runs', 'NT-001')), true);
  } finally {
    rmSync(project, { force: true, recursive: true });
  }
});

test('shared argument parser owns the three fixed run forms', () => {
  const cases = [
    [[
      '--cwd', 'project', 'run', 'start', '--session-id', 'codex:start',
    ], {
      cwd: 'project',
      command: 'run',
      operation: 'start',
      sessionId: 'codex:start',
      userConfirmed: false,
    }],
    [[
      '--cwd', 'project', 'run', 'cancel', '--session-id', 'claude:cancel',
      '--user-confirmed',
    ], {
      cwd: 'project',
      command: 'run',
      operation: 'cancel',
      sessionId: 'claude:cancel',
      userConfirmed: true,
    }],
    [[
      '--cwd', 'project', 'run', 'complete', '--session-id', 'codex:complete',
      '--user-confirmed',
    ], {
      cwd: 'project',
      command: 'run',
      operation: 'complete',
      sessionId: 'codex:complete',
      userConfirmed: true,
    }],
  ] as const;

  for (const [argv, expected] of cases) {
    assert.deepEqual(parseArguments(argv), expected);
  }
});

test('canceled-id-is-not-reused', async () => {
  const project = temporaryProject('no-reuse');
  try {
    await startRun(project, { sessionId: SESSION_ID });
    await cancelRun(project, { sessionId: SESSION_ID, userConfirmed: true });
    const second = await startRun(project, { sessionId: SESSION_ID });

    assert.equal(second.state.next_work_number, 3);
    assert.equal(second.state.current?.run_id, 'NT-002');
    assert.equal(existsSync(join(project, '.ntworkflow', 'runs', 'NT-001')), true);
    assert.equal(existsSync(join(project, '.ntworkflow', 'runs', 'NT-002')), true);
  } finally {
    rmSync(project, { force: true, recursive: true });
  }
});

test('NT-999-advances-to-NT-1000', async () => {
  const project = temporaryProject('four-digits', {
    next_work_number: 999,
    current: null,
  });
  try {
    const run999 = await startRun(project, { sessionId: SESSION_ID });
    assert.equal(run999.state.current?.run_id, 'NT-999');

    await cancelRun(project, { sessionId: SESSION_ID, userConfirmed: true });
    const run1000 = await startRun(project, { sessionId: SESSION_ID });

    assert.equal(run1000.state.current?.run_id, 'NT-1000');
    assert.equal(run1000.state.next_work_number, 1001);
  } finally {
    rmSync(project, { force: true, recursive: true });
  }
});

test('cancel-preserves-run-directory', async () => {
  const project = temporaryProject('cancel-preserves');
  try {
    await startRun(project, { sessionId: SESSION_ID });
    const runDirectory = join(project, '.ntworkflow', 'runs', 'NT-001');
    writeFileSync(join(runDirectory, 'BRIEF.md'), '# Partial brief\n');

    const result = await cancelRun(project, {
      sessionId: SESSION_ID,
      userConfirmed: true,
    });

    assert.equal(result.state.current, null);
    assert.equal(result.state.next_work_number, 2);
    assert.equal(readFileSync(join(runDirectory, 'BRIEF.md'), 'utf8'), '# Partial brief\n');
  } finally {
    rmSync(project, { force: true, recursive: true });
  }
});

test('complete-clears-current', async () => {
  const state = fixtureState('delivery-ready.json');
  const project = temporaryProject('complete', state);
  try {
    const runDirectory = ensureCurrentRunDirectory(project, state);
    writeFileSync(join(runDirectory, 'PLAN.md'), '# Delivered plan\n');

    const result = await completeRun(project, {
      sessionId: 'claude:delivery-session',
      userConfirmed: true,
    });

    assert.deepEqual(result.state, { next_work_number: 1001, current: null });
    assert.equal(existsSync(runDirectory), true);
    assert.equal(readFileSync(join(runDirectory, 'PLAN.md'), 'utf8'), '# Delivered plan\n');
  } finally {
    rmSync(project, { force: true, recursive: true });
  }
});

test('delivery-ready-start-is-one-state-commit', async () => {
  const state = fixtureState('delivery-ready.json');
  const project = temporaryProject('delivery-start', state);
  const originalState = readFileSync(join(project, '.ntworkflow', 'state.json'), 'utf8');
  try {
    ensureCurrentRunDirectory(project, state);
    const result = await startRun(
      project,
      { sessionId: SESSION_ID },
      {
        faultInjector: (point) => {
          if (point === 'before-rename') {
            assert.equal(
              readFileSync(join(project, '.ntworkflow', 'state.json'), 'utf8'),
              originalState,
            );
            assert.equal(existsSync(join(project, '.ntworkflow', 'runs', 'NT-1001')), true);
          }
        },
      },
    );

    assert.equal(result.state.current?.run_id, 'NT-1001');
    assert.equal(result.state.current?.lifecycle, 'intake-active');
    assert.equal(result.state.next_work_number, 1002);
  } finally {
    rmSync(project, { force: true, recursive: true });
  }
});

test('commit-failure-leaves-old-current-and-partial-directory', async () => {
  const state = fixtureState('delivery-ready.json');
  const project = temporaryProject('commit-failure', state);
  const statePath = join(project, '.ntworkflow', 'state.json');
  const originalState = readFileSync(statePath);
  try {
    ensureCurrentRunDirectory(project, state);
    await expectWorkflowError(
      startRun(
        project,
        { sessionId: SESSION_ID },
        {
          faultInjector: (point) => {
            if (point === 'before-rename') throw new Error('injected commit failure');
          },
        },
      ),
      ERROR_CODES.COMMIT_FAILURE,
      16,
    );

    assert.deepEqual(readFileSync(statePath), originalState);
    assert.equal(readState(project).current?.lifecycle, 'delivery-ready');
    assert.equal(existsSync(join(project, '.ntworkflow', 'runs', 'NT-1001')), true);
  } finally {
    rmSync(project, { force: true, recursive: true });
  }
});

test('pre-existing target directory returns PARTIAL_RUN without adoption or repair', async () => {
  const project = temporaryProject('partial', { next_work_number: 1, current: null });
  const target = join(project, '.ntworkflow', 'runs', 'NT-001');
  mkdirSync(target, { recursive: true });
  writeFileSync(join(target, 'sentinel.txt'), 'keep me\n');
  const before = snapshotTree(project);

  try {
    const error = await expectWorkflowError(
      startRun(project, { sessionId: SESSION_ID }),
      ERROR_CODES.PARTIAL_RUN,
      15,
    );

    assert.deepEqual(error.details, { path: target });
    assert.deepEqual(snapshotTree(project), before);
  } finally {
    rmSync(project, { force: true, recursive: true });
  }
});

test('cancel is legal only from confirmed active lifecycles', async () => {
  const fixtures = [
    'intake-active.json',
    'brief-ready.json',
    'plan-ready.json',
    'plan-approved.json',
    'work-active.json',
  ] as const;

  for (const fixture of fixtures) {
    const state = fixtureState(fixture);
    const project = temporaryProject(`cancel-${fixture}`, state);
    try {
      const runDirectory = ensureCurrentRunDirectory(project, state);
      const result = await cancelRun(project, {
        sessionId: SESSION_ID,
        userConfirmed: true,
      });
      assert.equal(result.state.current, null, fixture);
      assert.equal(existsSync(runDirectory), true, fixture);
    } finally {
      rmSync(project, { force: true, recursive: true });
    }
  }
});

test('rejected operations do not change existing state', async () => {
  const intakeState = fixtureState('intake-active.json');
  const deliveryState = fixtureState('delivery-ready.json');
  const scenarios = [
    {
      name: 'start while intake is active',
      state: intakeState,
      operation: (project: string) => startRun(project, { sessionId: SESSION_ID }),
      code: ERROR_CODES.ILLEGAL_TRANSITION,
      exitCode: 11,
    },
    {
      name: 'cancel without user authority',
      state: intakeState,
      operation: (project: string) => cancelRun(project, {
        sessionId: SESSION_ID,
        userConfirmed: false,
      }),
      code: ERROR_CODES.INVALID_INPUT,
      exitCode: 2,
    },
    {
      name: 'cancel from delivery-ready',
      state: deliveryState,
      operation: (project: string) => cancelRun(project, {
        sessionId: SESSION_ID,
        userConfirmed: true,
      }),
      code: ERROR_CODES.ILLEGAL_TRANSITION,
      exitCode: 11,
    },
    {
      name: 'complete without user authority',
      state: deliveryState,
      operation: (project: string) => completeRun(project, {
        sessionId: SESSION_ID,
        userConfirmed: false,
      }),
      code: ERROR_CODES.INVALID_INPUT,
      exitCode: 2,
    },
    {
      name: 'complete before delivery-ready',
      state: intakeState,
      operation: (project: string) => completeRun(project, {
        sessionId: SESSION_ID,
        userConfirmed: true,
      }),
      code: ERROR_CODES.ILLEGAL_TRANSITION,
      exitCode: 11,
    },
  ] as const;

  for (const scenario of scenarios) {
    const project = temporaryProject(`rejected-${scenario.name}`, scenario.state);
    try {
      ensureCurrentRunDirectory(project, scenario.state);
      const before = snapshotTree(project);
      await expectWorkflowError(
        scenario.operation(project),
        scenario.code,
        scenario.exitCode,
      );
      assert.deepEqual(snapshotTree(project), before, scenario.name);
    } finally {
      rmSync(project, { force: true, recursive: true });
    }
  }
});

test('CLI keeps run operations while phase commands use their registered handler', () => {
  const cancelProject = temporaryProject('cli-cancel');
  const completeState = fixtureState('delivery-ready.json');
  const completeProject = temporaryProject('cli-complete', completeState);
  try {
    ensureCurrentRunDirectory(completeProject, completeState);

    const start = runCli(
      cancelProject,
      'run',
      'start',
      '--session-id',
      'codex:cli-start',
    );
    assert.equal(start.status, 0, start.stderr);
    assert.equal(JSON.parse(start.stdout).operation, 'run start');

    const rejectedCancel = runCli(
      cancelProject,
      'run',
      'cancel',
      '--session-id',
      'codex:cli-cancel',
    );
    assert.equal(rejectedCancel.status, 2, rejectedCancel.stderr);
    assert.equal(readState(cancelProject).current?.run_id, 'NT-001');

    const cancel = runCli(
      cancelProject,
      'run',
      'cancel',
      '--session-id',
      'codex:cli-cancel',
      '--user-confirmed',
    );
    assert.equal(cancel.status, 0, cancel.stderr);
    assert.equal(JSON.parse(cancel.stdout).operation, 'run cancel');
    assert.equal(readState(cancelProject).current, null);

    const complete = runCli(
      completeProject,
      'run',
      'complete',
      '--session-id',
      'claude:cli-complete',
      '--user-confirmed',
    );
    assert.equal(complete.status, 0, complete.stderr);
    assert.equal(JSON.parse(complete.stdout).operation, 'run complete');
    assert.equal(readState(completeProject).current, null);

    const phase = runCli(
      cancelProject,
      'phase',
      'begin',
      'nttask',
      '--session-id',
      'codex:not-yet',
    );
    assert.equal(phase.status, 11, phase.stderr);
    assert.equal(JSON.parse(phase.stdout).operation, 'phase begin nttask');
    assert.equal(readState(cancelProject).current, null);
  } finally {
    rmSync(cancelProject, { force: true, recursive: true });
    rmSync(completeProject, { force: true, recursive: true });
  }
});
