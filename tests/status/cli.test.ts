import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { parseArguments } from '../../src/cli/arguments.ts';
import { ERROR_CODES, WorkflowError } from '../../src/core/errors.ts';

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

function runRawCli(...argv: string[]) {
  return spawnSync(
    process.execPath,
    ['src/cli/main.ts', ...argv],
    { encoding: 'utf8' },
  );
}

function runCli(cwd: string, ...command: string[]) {
  return runRawCli('--cwd', cwd, ...command);
}

test('parses exactly --cwd <path> status', () => {
  assert.deepEqual(parseArguments(['--cwd', 'consumer', 'status']), {
    cwd: 'consumer',
    command: 'status',
  });
});

test('rejects missing, reordered, and extra CLI arguments with exit code 2', () => {
  const cases = [
    ['--cwd'],
    ['--cwd', 'consumer'],
    ['status', '--cwd', 'consumer'],
    ['--cwd', 'consumer', 'status', 'extra'],
  ] as const;

  for (const argv of cases) {
    assert.throws(
      () => parseArguments(argv),
      (error: unknown) => {
        assert.ok(error instanceof WorkflowError);
        assert.equal(error.code, ERROR_CODES.INVALID_INPUT);
        assert.equal(error.exitCode, 2);
        return true;
      },
      argv.join(' '),
    );
  }
});

test('malformed CLI input reports only a recognized operation token', () => {
  const project = mkdtempSync(join(tmpdir(), 'ntworkflow-cli-operation-'));
  try {
    writeFileSync(join(project, 'consumer.txt'), 'unchanged\n');
    const before = snapshotTree(project);

    const cases = [
      { argv: ['status', '--cwd', project], operation: 'unknown' },
      { argv: ['--cwd', project], operation: 'unknown' },
      { argv: ['--cwd', project, 'status', 'extra'], operation: 'status' },
    ] as const;

    for (const scenario of cases) {
      const result = runRawCli(...scenario.argv);
      const response = JSON.parse(result.stdout) as { operation: string };

      assert.equal(result.status, 2, scenario.argv.join(' '));
      assert.equal(response.operation, scenario.operation);
    }
    assert.deepEqual(snapshotTree(project), before);
  } finally {
    rmSync(project, { force: true, recursive: true });
  }
});

test('status reports an uninitialized project and the nttask next skill without mutation', () => {
  const project = mkdtempSync(join(tmpdir(), 'ntworkflow-cli-empty-'));
  try {
    mkdirSync(join(project, '.git'));
    writeFileSync(join(project, 'consumer.txt'), 'unchanged\n');
    const before = snapshotTree(project);

    const result = runCli(project, 'status');

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, '');
    assert.equal(result.stdout.endsWith('\n'), true);
    assert.equal(result.stdout.slice(0, -1).includes('\n'), false);
    const response = JSON.parse(result.stdout) as {
      ok: boolean;
      operation: string;
      project_root: string;
      state: unknown;
      next_action: { skill: string };
      warnings: unknown[];
    };
    assert.equal(response.ok, true);
    assert.equal(response.operation, 'status');
    assert.equal(response.project_root, realpathSync(project));
    assert.equal(response.state, null);
    assert.equal(response.next_action.skill, 'nttask');
    assert.deepEqual(response.warnings, []);
    assert.deepEqual(snapshotTree(project), before);
  } finally {
    rmSync(project, { force: true, recursive: true });
  }
});

test('status returns present state and its correct next skill without mutation', () => {
  const project = mkdtempSync(join(tmpdir(), 'ntworkflow-cli-state-'));
  try {
    mkdirSync(join(project, '.ntworkflow'));
    writeFileSync(
      join(project, '.ntworkflow', 'state.json'),
      readFileSync(join('tests', 'fixtures', 'states', 'brief-ready.json')),
    );
    const before = snapshotTree(project);

    const result = runCli(project, 'status');
    const response = JSON.parse(result.stdout) as {
      state: { current: { lifecycle: string } };
      next_action: { skill: string };
    };

    assert.equal(result.status, 0, result.stderr);
    assert.equal(response.state.current.lifecycle, 'brief-ready');
    assert.equal(response.next_action.skill, 'ntgrill');
    assert.deepEqual(snapshotTree(project), before);
  } finally {
    rmSync(project, { force: true, recursive: true });
  }
});

test('unknown commands return a protocol error with exit code 2 and do not mutate', () => {
  const project = mkdtempSync(join(tmpdir(), 'ntworkflow-cli-unknown-'));
  try {
    writeFileSync(join(project, 'consumer.txt'), 'unchanged\n');
    const before = snapshotTree(project);

    const result = runCli(project, 'future-command');
    const response = JSON.parse(result.stdout) as {
      ok: boolean;
      error: { code: string; exit_code: number };
    };

    assert.equal(result.status, 2, result.stderr);
    assert.equal(result.stderr, '');
    assert.equal(response.ok, false);
    assert.deepEqual(response.error, {
      code: 'INVALID_INPUT',
      exit_code: 2,
      message: 'Unknown command.',
      details: { command: 'future-command' },
    });
    assert.deepEqual(snapshotTree(project), before);
  } finally {
    rmSync(project, { force: true, recursive: true });
  }
});

test('status maps every readable lifecycle to the correct next skill', () => {
  const cases = [
    ['no-active-run.json', 'nttask'],
    ['intake-active.json', 'nttask'],
    ['brief-ready.json', 'ntgrill'],
    ['plan-ready.json', 'ntplan'],
    ['plan-approved.json', 'ntwork'],
    ['work-active.json', 'ntwork'],
    ['delivery-ready.json', 'nttask'],
  ] as const;

  for (const [fixture, expectedSkill] of cases) {
    const project = mkdtempSync(join(tmpdir(), 'ntworkflow-cli-lifecycle-'));
    try {
      mkdirSync(join(project, '.git'));
      mkdirSync(join(project, '.ntworkflow'));
      writeFileSync(
        join(project, '.ntworkflow', 'state.json'),
        readFileSync(join('tests', 'fixtures', 'states', fixture)),
      );
      const before = snapshotTree(project);

      const result = runCli(project, 'status');
      const response = JSON.parse(result.stdout) as {
        state: { current: { lifecycle: string } | null };
        next_action: { skill: string };
      };

      assert.equal(result.status, 0, result.stderr);
      assert.equal(response.next_action.skill, expectedSkill, fixture);
      assert.deepEqual(snapshotTree(project), before);
    } finally {
      rmSync(project, { force: true, recursive: true });
    }
  }
});

test('delivery-ready status names both legal ways to close the passive phase', () => {
  const project = mkdtempSync(join(tmpdir(), 'ntworkflow-cli-delivery-ready-'));
  try {
    mkdirSync(join(project, '.ntworkflow'));
    writeFileSync(
      join(project, '.ntworkflow', 'state.json'),
      readFileSync(join('tests', 'fixtures', 'states', 'delivery-ready.json')),
    );

    const result = runCli(project, 'status');
    const response = JSON.parse(result.stdout) as {
      next_action: { skill: string; instruction: string };
    };

    assert.equal(result.status, 0, result.stderr);
    assert.equal(response.next_action.skill, 'nttask');
    assert.match(response.next_action.instruction, /run complete/u);
    assert.match(response.next_action.instruction, /nttask/u);
  } finally {
    rmSync(project, { force: true, recursive: true });
  }
});

test('the committed empty consumer fixture stays unchanged when copied outside Git', () => {
  const fixture = join('tests', 'fixtures', 'consumer-repos', 'empty');
  const fixtureBefore = snapshotTree(fixture);
  const sandbox = mkdtempSync(join(tmpdir(), 'ntworkflow-cli-fixture-'));
  const project = join(sandbox, 'empty');

  try {
    cpSync(fixture, project, { recursive: true });
    const before = snapshotTree(project);

    const result = runCli(project, 'status');
    const response = JSON.parse(result.stdout) as {
      ok: boolean;
      project_root: string;
      state: unknown;
      next_action: { skill: string | null; instruction: string };
    };

    assert.equal(result.status, 0, result.stderr);
    assert.equal(response.ok, true);
    assert.equal(response.project_root, realpathSync(project));
    assert.equal(response.state, null);
    assert.equal(response.next_action.skill, null);
    assert.match(response.next_action.instruction, /Git repository/u);
    assert.deepEqual(snapshotTree(project), before);
  } finally {
    rmSync(sandbox, { force: true, recursive: true });
  }
  assert.deepEqual(snapshotTree(fixture), fixtureBefore);
});

test('malformed state returns one protocol line with exit code 10 and no mutation', () => {
  const project = mkdtempSync(join(tmpdir(), 'ntworkflow-cli-invalid-state-'));
  try {
    mkdirSync(join(project, '.ntworkflow'));
    writeFileSync(join(project, '.ntworkflow', 'state.json'), '{not-json}\n');
    const before = snapshotTree(project);

    const result = runCli(project, 'status');
    const response = JSON.parse(result.stdout) as {
      ok: boolean;
      next_action: { skill: string | null; instruction: string };
      error: { code: string; exit_code: number };
    };

    assert.equal(result.status, 10, result.stderr);
    assert.equal(result.stdout.endsWith('\n'), true);
    assert.equal(result.stdout.slice(0, -1).includes('\n'), false);
    assert.equal(response.ok, false);
    assert.deepEqual(response.next_action, {
      skill: null,
      instruction: 'Correct the reported failure and retry status.',
    });
    assert.equal(response.error.code, 'INVALID_STATE');
    assert.equal(response.error.exit_code, 10);
    assert.deepEqual(snapshotTree(project), before);
  } finally {
    rmSync(project, { force: true, recursive: true });
  }
});
