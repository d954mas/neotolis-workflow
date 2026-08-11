import assert from 'node:assert/strict';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import test from 'node:test';

import { ERROR_CODES, WorkflowError } from '../../src/core/errors.ts';
import type { State } from '../../src/core/state.ts';
import {
  TRANSACTION_FAULT_POINTS,
  runStateTransaction,
} from '../../src/runtime/transaction.ts';
import type { TransactionFaultPoint } from '../../src/runtime/transaction.ts';

const EMPTY_STATE: State = {
  next_work_number: 1,
  current: null,
};

const FIRST_RUN_STATE: State = {
  next_work_number: 2,
  current: {
    run_id: 'NT-001',
    lifecycle: 'intake-active',
    phase: null,
    owner: null,
    blocker: null,
    work: null,
  },
};

function temporaryProject(name: string, stateSource?: string | Buffer): string {
  const project = mkdtempSync(join(tmpdir(), `ntworkflow-transaction-${name}-`));
  mkdirSync(join(project, '.ntworkflow'));
  if (stateSource !== undefined) {
    writeFileSync(join(project, '.ntworkflow', 'state.json'), stateSource);
  }
  return project;
}

function workflowFiles(project: string): string[] {
  return readdirSync(join(project, '.ntworkflow')).sort();
}

function allProjectFiles(root: string, directory = root): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...allProjectFiles(root, absolutePath));
    } else {
      files.push(relative(root, absolutePath).replaceAll('\\', '/'));
    }
  }
  return files.sort();
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

test('exports only the three deterministic commit fault points', () => {
  assert.deepEqual(TRANSACTION_FAULT_POINTS, [
    'before-write',
    'after-temp-sync',
    'before-rename',
  ]);
});

test('writes canonical UTF-8 LF two-space JSON and cleans transaction files', async () => {
  const project = temporaryProject('canonical');
  try {
    const result = await runStateTransaction(project, (state) => {
      assert.equal(state, null);
      return FIRST_RUN_STATE;
    });

    const expected = `${JSON.stringify(FIRST_RUN_STATE, null, 2)}\n`;
    const bytes = readFileSync(join(project, '.ntworkflow', 'state.json'));
    assert.deepEqual(result, { state: FIRST_RUN_STATE, warnings: [] });
    assert.equal(bytes.toString('utf8'), expected);
    assert.deepEqual(workflowFiles(project), ['state.json']);
  } finally {
    rmSync(project, { force: true, recursive: true });
  }
});

test('commits the validated snapshot when the transition result mutates later', async () => {
  const project = temporaryProject(
    'validated-snapshot',
    Buffer.from('{"next_work_number":1,"current":null}\n'),
  );
  const candidate = structuredClone(FIRST_RUN_STATE);
  const expected = structuredClone(candidate);

  try {
    const result = await runStateTransaction(
      project,
      () => candidate,
      {
        faultInjector: (point) => {
          if (point === 'before-write') {
            candidate.next_work_number = 0;
          }
        },
      },
    );

    assert.deepEqual(result, { state: expected, warnings: [] });
    assert.deepEqual(
      JSON.parse(readFileSync(join(project, '.ntworkflow', 'state.json'), 'utf8')),
      expected,
    );
  } finally {
    rmSync(project, { force: true, recursive: true });
  }
});

test('runs asynchronous commit preparation under lock before writing state', async () => {
  const original = Buffer.from('{ "next_work_number": 1, "current": null }\r\n');
  const project = temporaryProject('commit-preparation', original);
  const lockPath = join(project, '.ntworkflow', '.state.lock');
  let prepared = false;

  try {
    await expectWorkflowError(
      runStateTransaction(
        project,
        () => FIRST_RUN_STATE,
        {
          prepareCommit: async (current, next) => {
            prepared = true;
            assert.deepEqual(current, EMPTY_STATE);
            assert.deepEqual(next, FIRST_RUN_STATE);
            assert.equal(Object.isFrozen(next), true);
            assert.equal(Object.isFrozen(next.current), true);
            assert.equal(existsSync(lockPath), true);
            await Promise.resolve();
            throw new WorkflowError({
              code: ERROR_CODES.ARTIFACT_FAILURE,
              message: 'Prepared artifact is invalid.',
            });
          },
        },
      ),
      ERROR_CODES.ARTIFACT_FAILURE,
      14,
    );

    assert.equal(prepared, true);
    assert.deepEqual(readFileSync(join(project, '.ntworkflow', 'state.json')), original);
    assert.deepEqual(workflowFiles(project), ['state.json']);
  } finally {
    rmSync(project, { force: true, recursive: true });
  }
});

test('calculates a pure transition after lock acquisition and validates its result', async () => {
  const source = `${JSON.stringify(FIRST_RUN_STATE)}\n`;
  const project = temporaryProject('pure-transition', source);
  try {
    let calls = 0;
    await runStateTransaction(project, (state) => {
      calls += 1;
      assert.ok(state !== null);
      assert.equal(existsSync(join(project, '.ntworkflow', '.state.lock')), true);
      assert.equal(Object.isFrozen(state), true);
      assert.equal(Object.isFrozen(state.current), true);
      return state as State;
    });
    assert.equal(calls, 1);

    const previousBytes = readFileSync(join(project, '.ntworkflow', 'state.json'));
    await expectWorkflowError(
      runStateTransaction(project, () => ({ next_work_number: 0, current: null })),
      ERROR_CODES.INVALID_STATE,
      10,
    );
    assert.deepEqual(
      readFileSync(join(project, '.ntworkflow', 'state.json')),
      previousBytes,
    );
    assert.deepEqual(workflowFiles(project), ['state.json']);
  } finally {
    rmSync(project, { force: true, recursive: true });
  }
});

test('an existing lock fails immediately as lock conflict without mutation', async () => {
  const original = Buffer.from('{ "next_work_number": 1, "current": null }\r\n');
  const project = temporaryProject('existing-lock', original);
  const lockPath = join(project, '.ntworkflow', '.state.lock');
  const foreignLock = '{"pid":999,"token":"foreign"}\n';
  writeFileSync(lockPath, foreignLock);
  try {
    let transitionCalled = false;
    await expectWorkflowError(
      runStateTransaction(project, () => {
        transitionCalled = true;
        return FIRST_RUN_STATE;
      }),
      ERROR_CODES.LOCK_CONFLICT,
      15,
    );

    assert.equal(transitionCalled, false);
    assert.deepEqual(readFileSync(join(project, '.ntworkflow', 'state.json')), original);
    assert.equal(readFileSync(lockPath, 'utf8'), foreignLock);
  } finally {
    rmSync(project, { force: true, recursive: true });
  }
});

test('lock conflict wins before malformed current state is read', async () => {
  const malformed = Buffer.from('{not-json}\n');
  const project = temporaryProject('locked-malformed-state', malformed);
  const lockPath = join(project, '.ntworkflow', '.state.lock');
  writeFileSync(lockPath, '{"pid":999,"token":"foreign"}\n');
  try {
    await expectWorkflowError(
      runStateTransaction(project, () => FIRST_RUN_STATE),
      ERROR_CODES.LOCK_CONFLICT,
      15,
    );
    assert.deepEqual(readFileSync(join(project, '.ntworkflow', 'state.json')), malformed);
  } finally {
    rmSync(project, { force: true, recursive: true });
  }
});

test('malformed current state is rejected without leaving transaction files', async () => {
  const malformed = Buffer.from('{not-json}\n');
  const project = temporaryProject('malformed-state-cleanup', malformed);
  const statePath = join(project, '.ntworkflow', 'state.json');

  try {
    await expectWorkflowError(
      runStateTransaction(project, () => FIRST_RUN_STATE),
      ERROR_CODES.INVALID_STATE,
      10,
    );
    assert.deepEqual(readFileSync(statePath), malformed);
    assert.deepEqual(workflowFiles(project), ['state.json']);

    writeFileSync(statePath, `${JSON.stringify(EMPTY_STATE)}\n`);
    const result = await runStateTransaction(project, () => FIRST_RUN_STATE);
    assert.deepEqual(result, { state: FIRST_RUN_STATE, warnings: [] });
  } finally {
    rmSync(project, { force: true, recursive: true });
  }
});

test('exactly one of two racing mutators commits and the other gets exit class 15', {
  timeout: 5_000,
}, async () => {
  const project = temporaryProject(
    'race',
    Buffer.from('{"next_work_number":1,"current":null}\n'),
  );
  let releaseFirst: (() => void) | undefined;
  const firstCanFinish = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  let firstReachedFault: (() => void) | undefined;
  const firstHasLock = new Promise<void>((resolve) => {
    firstReachedFault = resolve;
  });
  let first: ReturnType<typeof runStateTransaction> | undefined;

  try {
    first = runStateTransaction(
      project,
      () => FIRST_RUN_STATE,
      {
        faultInjector: async (point) => {
          if (point === 'before-write') {
            firstReachedFault?.();
            await firstCanFinish;
          }
        },
      },
    );
    await Promise.race([
      firstHasLock,
      first.then(() => assert.fail('First mutator completed before holding the barrier.')),
    ]);

    const second = runStateTransaction(project, () => {
      const current = FIRST_RUN_STATE.current;
      assert.ok(current !== null);
      return {
        ...FIRST_RUN_STATE,
        current: { ...current, blocker: 'second mutator' },
      };
    });
    await expectWorkflowError(
      second,
      ERROR_CODES.LOCK_CONFLICT,
      15,
    );
    releaseFirst?.();
    await first;
    assert.deepEqual(
      JSON.parse(readFileSync(join(project, '.ntworkflow', 'state.json'), 'utf8')),
      FIRST_RUN_STATE,
    );
    assert.deepEqual(workflowFiles(project), ['state.json']);
  } finally {
    releaseFirst?.();
    await first?.catch(() => undefined);
    rmSync(project, { force: true, recursive: true });
  }
});

for (const faultPoint of TRANSACTION_FAULT_POINTS) {
  test(`${faultPoint} failure preserves previous state bytes and removes its temp file`, async () => {
    const original = Buffer.from('{ "next_work_number": 1, "current": null }\r\n');
    const project = temporaryProject(`fault-${faultPoint}`, original);
    try {
      const visited: TransactionFaultPoint[] = [];
      await expectWorkflowError(
        runStateTransaction(
          project,
          () => FIRST_RUN_STATE,
          {
            faultInjector: (point) => {
              visited.push(point);
              const temporaryFile = workflowFiles(project).find((file) => file.endsWith('.tmp'));
              assert.ok(temporaryFile !== undefined);
              const temporaryBytes = readFileSync(
                join(project, '.ntworkflow', temporaryFile),
              );
              assert.deepEqual(
                readFileSync(join(project, '.ntworkflow', 'state.json')),
                original,
              );
              if (point === 'before-write') {
                assert.equal(temporaryBytes.length, 0);
              } else {
                assert.equal(
                  temporaryBytes.toString('utf8'),
                  `${JSON.stringify(FIRST_RUN_STATE, null, 2)}\n`,
                );
              }
              if (point === faultPoint) throw new Error(`injected ${point}`);
            },
          },
        ),
        ERROR_CODES.COMMIT_FAILURE,
        16,
      );

      assert.deepEqual(
        visited,
        TRANSACTION_FAULT_POINTS.slice(
          0,
          TRANSACTION_FAULT_POINTS.indexOf(faultPoint) + 1,
        ),
      );
      assert.deepEqual(readFileSync(join(project, '.ntworkflow', 'state.json')), original);
      assert.deepEqual(workflowFiles(project), ['state.json']);
    } finally {
      rmSync(project, { force: true, recursive: true });
    }
  });
}

test('release never deletes a lock whose token changed', async () => {
  const original = Buffer.from('{"next_work_number":1,"current":null}\n');
  const project = temporaryProject('foreign-token', original);
  const lockPath = join(project, '.ntworkflow', '.state.lock');
  const foreignLock = `${JSON.stringify({ pid: 777, token: 'foreign-token' }, null, 2)}\n`;
  try {
    await expectWorkflowError(
      runStateTransaction(
        project,
        () => FIRST_RUN_STATE,
        {
          faultInjector: async (point) => {
            if (point === 'before-write') {
              const owned = JSON.parse(readFileSync(lockPath, 'utf8')) as {
                pid: number;
                token: string;
              };
              assert.equal(owned.pid, process.pid);
              assert.equal(typeof owned.token, 'string');
              assert.notEqual(owned.token, 'foreign-token');
              await writeFile(lockPath, foreignLock);
              throw new Error('replace lock ownership');
            }
          },
        },
      ),
      ERROR_CODES.COMMIT_FAILURE,
      16,
    );

    assert.deepEqual(readFileSync(join(project, '.ntworkflow', 'state.json')), original);
    assert.equal(readFileSync(lockPath, 'utf8'), foreignLock);
    assert.deepEqual(workflowFiles(project), ['.state.lock', 'state.json']);
  } finally {
    rmSync(project, { force: true, recursive: true });
  }
});

test('successful commit reports a warning when lock ownership is lost before release', async () => {
  const original = Buffer.from('{"next_work_number":1,"current":null}\n');
  const project = temporaryProject('release-warning', original);
  const lockPath = join(project, '.ntworkflow', '.state.lock');
  const foreignLock = `${JSON.stringify({ pid: 777, token: 'foreign-token' }, null, 2)}\n`;

  try {
    const result = await runStateTransaction(
      project,
      () => FIRST_RUN_STATE,
      {
        faultInjector: async (point) => {
          if (point === 'before-rename') await writeFile(lockPath, foreignLock);
        },
      },
    );

    assert.deepEqual(result.state, FIRST_RUN_STATE);
    assert.equal(result.warnings.length, 1);
    assert.match(result.warnings[0] ?? '', /lock/u);
    assert.equal(readFileSync(lockPath, 'utf8'), foreignLock);
    assert.deepEqual(
      JSON.parse(readFileSync(join(project, '.ntworkflow', 'state.json'), 'utf8')),
      FIRST_RUN_STATE,
    );
  } finally {
    rmSync(project, { force: true, recursive: true });
  }
});

test('lock and temporary state files are created only under .ntworkflow', async () => {
  const project = temporaryProject('path-confinement');
  try {
    await runStateTransaction(
      project,
      () => EMPTY_STATE,
      {
        faultInjector: (point) => {
          if (point !== 'before-write') return;
          const files = allProjectFiles(project);
          assert.equal(files.includes('.ntworkflow/.state.lock'), true);
          assert.equal(
            files.some((path) => /^\.ntworkflow\/\.state\..+\.tmp$/u.test(path)),
            true,
          );
          assert.equal(files.every((path) => path.startsWith('.ntworkflow/')), true);
        },
      },
    );

    assert.deepEqual(allProjectFiles(project), ['.ntworkflow/state.json']);
  } finally {
    rmSync(project, { force: true, recursive: true });
  }
});
