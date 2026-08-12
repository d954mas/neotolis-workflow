import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import test from 'node:test';

import { parseArguments } from '../../src/cli/arguments.ts';
import {
  CODEX_OWNER,
  FIRST_OWNER,
  cliResponse,
  intakeState,
  runCli,
  stateBytes,
  temporaryProject,
} from './helpers.ts';

test('shared argument parser owns the three documented phase forms', () => {
  const cases = [
    [[
      '--cwd', 'project', 'phase', 'begin', 'nttask',
      '--session-id', 'codex:begin', '--blocker-resolved',
    ], {
      cwd: 'project',
      command: 'phase',
      operation: 'begin',
      phase: 'nttask',
      sessionId: 'codex:begin',
      blockerResolved: true,
    }],
    [[
      '--cwd', 'project', 'phase', 'complete', 'nttask',
      '--session-id', 'claude:complete',
    ], {
      cwd: 'project',
      command: 'phase',
      operation: 'complete',
      phase: 'nttask',
      sessionId: 'claude:complete',
    }],
    [[
      '--cwd', 'project', 'phase', 'stop', 'nttask',
      '--session-id', 'codex:stop', '--blocker', 'Need access.',
      '--interruption', 'user-confirmed',
    ], {
      cwd: 'project',
      command: 'phase',
      operation: 'stop',
      phase: 'nttask',
      sessionId: 'codex:stop',
      blocker: 'Need access.',
      interruption: 'user-confirmed',
    }],
  ] as const;

  for (const [argv, expected] of cases) {
    assert.deepEqual(parseArguments(argv), expected);
  }
});

test('CLI begin claims owner and accepts explicit recovery flags', () => {
  const fresh = temporaryProject('cli-begin', intakeState());
  const takeover = temporaryProject(
    'cli-takeover',
    intakeState({ owner: FIRST_OWNER }),
  );
  const blocked = temporaryProject(
    'cli-resolve',
    intakeState({ blocker: 'Waiting for access.' }),
  );
  try {
    const begin = runCli(
      fresh,
      'phase', 'begin', 'nttask', '--session-id', FIRST_OWNER,
    );
    const replace = runCli(
      takeover,
      'phase', 'begin', 'nttask', '--session-id', CODEX_OWNER,
      '--interruption', 'provider-ended',
    );
    const resolve = runCli(
      blocked,
      'phase', 'begin', 'nttask', '--session-id', FIRST_OWNER,
      '--blocker-resolved',
    );

    assert.equal(begin.status, 0);
    assert.deepEqual(cliResponse(begin).state.current?.owner, {
      session_id: FIRST_OWNER,
    });
    assert.equal(replace.status, 0);
    assert.deepEqual(cliResponse(replace).state.current?.owner, {
      session_id: CODEX_OWNER,
    });
    assert.equal(resolve.status, 0);
    assert.equal(cliResponse(resolve).state.current?.blocker, null);
  } finally {
    rmSync(fresh, { force: true, recursive: true });
    rmSync(takeover, { force: true, recursive: true });
    rmSync(blocked, { force: true, recursive: true });
  }
});

test('CLI stop accepts blocker as one Windows argv element', () => {
  const project = temporaryProject(
    'cli-stop',
    intakeState({ owner: FIRST_OWNER }),
  );
  const blocker = 'Need access to C:\\Program Files\\Example and screenshots.';
  try {
    const result = runCli(
      project,
      'phase', 'stop', 'nttask', '--session-id', FIRST_OWNER,
      '--blocker', blocker,
    );
    const response = cliResponse(result);

    assert.equal(result.status, 0);
    assert.equal(response.operation, 'phase stop nttask');
    assert.equal(response.state.current?.blocker, blocker);
    assert.deepEqual(response.next_action, {
      skill: 'nttask',
      instruction: 'Resolve the recorded blocker, then retry phase begin nttask with --blocker-resolved.',
    });
  } finally {
    rmSync(project, { force: true, recursive: true });
  }
});

test('CLI complete preserves ownership until the TB-07 artifact gate', () => {
  const project = temporaryProject(
    'cli-complete',
    intakeState({ owner: FIRST_OWNER }),
  );
  const before = stateBytes(project);
  try {
    const result = runCli(
      project,
      'phase', 'complete', 'nttask', '--session-id', FIRST_OWNER,
    );
    const response = cliResponse(result);

    assert.equal(result.status, 11);
    assert.equal(response.error?.code, 'ILLEGAL_TRANSITION');
    assert.deepEqual(response.state.current?.owner, { session_id: FIRST_OWNER });
    assert.deepEqual(stateBytes(project), before);
    assert.deepEqual(response.next_action, {
      skill: 'nttask',
      instruction: 'Continue the active nttask phase.',
    });
  } finally {
    rmSync(project, { force: true, recursive: true });
  }
});

test('CLI complete conflict names a legal ownership recovery path', () => {
  const project = temporaryProject(
    'cli-complete-conflict',
    intakeState({ owner: FIRST_OWNER }),
  );
  const before = stateBytes(project);
  try {
    const result = runCli(
      project,
      'phase', 'complete', 'nttask', '--session-id', CODEX_OWNER,
    );
    const response = cliResponse(result);

    assert.equal(result.status, 12);
    assert.deepEqual(stateBytes(project), before);
    assert.equal(
      response.next_action.instruction,
      'Continue in the recorded owner session, or replace it with phase begin nttask --interruption <provider-ended|user-confirmed>.',
    );
  } finally {
    rmSync(project, { force: true, recursive: true });
  }
});

test('CLI status describes blocked and durable intake boundaries', () => {
  const blocked = temporaryProject(
    'cli-status-blocked',
    intakeState({ blocker: 'Waiting for access.' }),
  );
  const durable = temporaryProject('cli-status-durable', intakeState());
  try {
    assert.equal(
      cliResponse(runCli(blocked, 'status')).next_action.instruction,
      'Resolve the recorded blocker, then retry phase begin nttask with --blocker-resolved.',
    );
    assert.equal(
      cliResponse(runCli(durable, 'status')).next_action.instruction,
      'Begin nttask from the durable intake boundary.',
    );
  } finally {
    rmSync(blocked, { force: true, recursive: true });
    rmSync(durable, { force: true, recursive: true });
  }
});

for (const scenario of [
  {
    name: 'ownership conflict',
    state: intakeState({ owner: FIRST_OWNER }),
    command: ['phase', 'begin', 'nttask', '--session-id', CODEX_OWNER],
    status: 12,
    code: 'OWNERSHIP_CONFLICT',
    instruction: 'Continue in the recorded owner session, or retry with explicit --interruption authority.',
  },
  {
    name: 'unresolved blocker',
    state: intakeState({ blocker: 'Waiting for access.' }),
    command: ['phase', 'begin', 'nttask', '--session-id', FIRST_OWNER],
    status: 13,
    code: 'UNRESOLVED_BLOCKER',
    instruction: 'Resolve the recorded blocker, then retry phase begin nttask with --blocker-resolved.',
  },
] as const) {
  test(`CLI ${scenario.name} returns stable next action and preserves bytes`, () => {
    const project = temporaryProject(`cli-${scenario.name}`, scenario.state);
    const before = stateBytes(project);
    try {
      const result = runCli(project, ...scenario.command);
      const response = cliResponse(result);

      assert.equal(result.status, scenario.status);
      assert.equal(response.error?.code, scenario.code);
      assert.equal(response.next_action.instruction, scenario.instruction);
      assert.deepEqual(stateBytes(project), before);
    } finally {
      rmSync(project, { force: true, recursive: true });
    }
  });
}

test('CLI rejects malformed phase forms without mutation', () => {
  const cases = [
    ['phase', 'begin', 'nttask', '--session-id', FIRST_OWNER, '--interruption', 'unexpected'],
    ['phase', 'begin', 'future', '--session-id', FIRST_OWNER],
    ['phase', 'complete', 'nttask', '--session-id', FIRST_OWNER, '--blocker-resolved'],
    ['phase', 'stop', 'nttask', '--session-id', FIRST_OWNER],
  ] as const;

  for (const command of cases) {
    const project = temporaryProject('cli-malformed', intakeState({ owner: FIRST_OWNER }));
    const before = stateBytes(project);
    try {
      const result = runCli(project, ...command);
      const response = cliResponse(result);
      assert.equal(result.status, 2, command.join(' '));
      assert.equal(response.error?.code, 'INVALID_INPUT');
      assert.deepEqual(stateBytes(project), before);
    } finally {
      rmSync(project, { force: true, recursive: true });
    }
  }
});
