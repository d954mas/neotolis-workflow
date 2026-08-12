import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { ERROR_CODES } from '../../src/core/errors.ts';
import type { WorkflowError } from '../../src/core/errors.ts';
import {
  beginNttaskPhase,
  assertNttaskCompletionAuthority,
  completeNttaskPhase,
  stopNttaskPhase,
} from '../../src/runtime/phase.ts';
import {
  CODEX_OWNER,
  FIRST_OWNER,
  SECOND_CLAUDE_OWNER,
  expectRejectedWithoutMutation,
  intakeState,
  stateBytes,
  temporaryProject,
} from './helpers.ts';

test('begin-claims-owner', async () => {
  const project = temporaryProject('begin', intakeState());
  try {
    const result = await beginNttaskPhase(project, { sessionId: FIRST_OWNER });
    assert.deepEqual(result.state.current?.owner, { session_id: FIRST_OWNER });
    assert.equal(result.state.current?.phase, 'nttask');
  } finally {
    rmSync(project, { force: true, recursive: true });
  }
});

for (const [name, requestedOwner] of [
  ['second-primary-is-rejected', CODEX_OWNER],
  ['same-provider-different-session-is-rejected', SECOND_CLAUDE_OWNER],
] as const) {
  test(name, async () => {
    const project = temporaryProject(name, intakeState({ owner: FIRST_OWNER }));
    try {
      const error = await expectRejectedWithoutMutation(
        project,
        () => beginNttaskPhase(project, { sessionId: requestedOwner }),
        ERROR_CODES.OWNERSHIP_CONFLICT,
        12,
      );
      assert.deepEqual(error.details, {
        recorded_owner: FIRST_OWNER,
        requested_owner: requestedOwner,
      });
    } finally {
      rmSync(project, { force: true, recursive: true });
    }
  });
}

for (const interruption of ['provider-ended', 'user-confirmed'] as const) {
  test(`confirmed-interruption-replaces-owner: ${interruption}`, async () => {
    const project = temporaryProject(
      `takeover-${interruption}`,
      intakeState({ owner: FIRST_OWNER }),
    );
    try {
      const result = await beginNttaskPhase(project, {
        sessionId: CODEX_OWNER,
        interruption,
      });
      assert.deepEqual(result.state.current?.owner, { session_id: CODEX_OWNER });
    } finally {
      rmSync(project, { force: true, recursive: true });
    }
  });
}

test('blocker-stops-begin', async () => {
  const blocker = 'Need repository access.';
  const project = temporaryProject('blocked-begin', intakeState({ blocker }));
  try {
    const error = await expectRejectedWithoutMutation(
      project,
      () => beginNttaskPhase(project, { sessionId: FIRST_OWNER }),
      ERROR_CODES.UNRESOLVED_BLOCKER,
      13,
    );
    assert.deepEqual(error.details, { blocker });
  } finally {
    rmSync(project, { force: true, recursive: true });
  }
});

test('confirmed-resolution-clears-blocker', async () => {
  const project = temporaryProject(
    'resolve-blocker',
    intakeState({ blocker: 'Need repository access.' }),
  );
  try {
    const result = await beginNttaskPhase(project, {
      sessionId: FIRST_OWNER,
      blockerResolved: true,
    });
    assert.equal(result.state.current?.blocker, null);
    assert.deepEqual(result.state.current?.owner, { session_id: FIRST_OWNER });
  } finally {
    rmSync(project, { force: true, recursive: true });
  }
});

test('stop-clears-phase-and-records-blocker', async () => {
  const blocker = 'Cannot read the directly referenced source.';
  const project = temporaryProject('stop', intakeState({ owner: FIRST_OWNER }));
  try {
    const result = await stopNttaskPhase(project, {
      sessionId: FIRST_OWNER,
      blocker,
    });
    assert.deepEqual(result.state.current, {
      run_id: 'NT-001',
      lifecycle: 'intake-active',
      phase: null,
      owner: null,
      blocker,
      work: null,
    });
  } finally {
    rmSync(project, { force: true, recursive: true });
  }
});

for (const interruption of ['provider-ended', 'user-confirmed'] as const) {
  test(`interrupted stop accepts ${interruption}`, async () => {
    const project = temporaryProject(
      `stop-${interruption}`,
      intakeState({ owner: FIRST_OWNER }),
    );
    try {
      const result = await stopNttaskPhase(project, {
        sessionId: CODEX_OWNER,
        blocker: 'The prior primary ended.',
        interruption,
      });
      assert.equal(result.state.current?.owner, null);
      assert.equal(result.state.current?.blocker, 'The prior primary ended.');
    } finally {
      rmSync(project, { force: true, recursive: true });
    }
  });
}

test('ordinary stop requires exact owner and a non-empty blocker', async () => {
  const project = temporaryProject(
    'stop-authority',
    intakeState({ owner: FIRST_OWNER }),
  );
  try {
    await expectRejectedWithoutMutation(
      project,
      () => stopNttaskPhase(project, {
        sessionId: SECOND_CLAUDE_OWNER,
        blocker: 'Blocked.',
      }),
      ERROR_CODES.OWNERSHIP_CONFLICT,
      12,
    );
    await expectRejectedWithoutMutation(
      project,
      () => stopNttaskPhase(project, { sessionId: FIRST_OWNER, blocker: '  ' }),
      ERROR_CODES.INVALID_INPUT,
      2,
    );
  } finally {
    rmSync(project, { force: true, recursive: true });
  }
});

test('complete authority requires exact owner and an active blocker-free phase', async () => {
  const active = temporaryProject('complete', intakeState({ owner: FIRST_OWNER }));
  const blocked = temporaryProject(
    'complete-blocked',
    intakeState({ blocker: 'Intake is blocked.' }),
  );
  try {
    await expectRejectedWithoutMutation(
      active,
      () => completeNttaskPhase(active, { sessionId: CODEX_OWNER }),
      ERROR_CODES.OWNERSHIP_CONFLICT,
      12,
    );
    assert.doesNotThrow(() => assertNttaskCompletionAuthority(
      intakeState({ owner: FIRST_OWNER }),
      { sessionId: FIRST_OWNER },
    ));
    assert.throws(
      () => assertNttaskCompletionAuthority(
        intakeState({ owner: FIRST_OWNER }), { sessionId: 'native-only' },
      ),
      (error: unknown) => {
        assert.equal((error as WorkflowError).code, ERROR_CODES.INVALID_INPUT);
        return true;
      },
    );
    await expectRejectedWithoutMutation(
      active,
      () => completeNttaskPhase(active, { sessionId: FIRST_OWNER }),
      ERROR_CODES.ILLEGAL_TRANSITION,
      11,
    );

    await expectRejectedWithoutMutation(
      blocked,
      () => completeNttaskPhase(blocked, { sessionId: FIRST_OWNER }),
      ERROR_CODES.ILLEGAL_TRANSITION,
      11,
    );
  } finally {
    rmSync(active, { force: true, recursive: true });
    rmSync(blocked, { force: true, recursive: true });
  }
});

test('unexpected interruption preserves owner', async () => {
  const project = temporaryProject(
    'unexpected-interruption',
    intakeState({ owner: FIRST_OWNER }),
  );
  try {
    await expectRejectedWithoutMutation(
      project,
      () => beginNttaskPhase(project, { sessionId: CODEX_OWNER }),
      ERROR_CODES.OWNERSHIP_CONFLICT,
      12,
    );
    assert.deepEqual(
      JSON.parse(stateBytes(project).toString('utf8')).current.owner,
      { session_id: FIRST_OWNER },
    );
  } finally {
    rmSync(project, { force: true, recursive: true });
  }
});

test('phase operations reject non-canonical session IDs before mutation', async () => {
  const operations = [
    (project: string) => beginNttaskPhase(project, { sessionId: 'native-only' }),
    (project: string) => completeNttaskPhase(project, { sessionId: 'claude:' }),
    (project: string) => stopNttaskPhase(project, {
      sessionId: 'codex:invalid:session',
      blocker: 'Blocked.',
    }),
  ] as const;

  for (const operation of operations) {
    const project = temporaryProject(
      'invalid-session',
      intakeState({ owner: FIRST_OWNER }),
    );
    try {
      await expectRejectedWithoutMutation(
        project,
        () => operation(project),
        ERROR_CODES.INVALID_INPUT,
        2,
      );
    } finally {
      rmSync(project, { force: true, recursive: true });
    }
  }
});

test('begin requires intake-active and mutators require an initialized workflow', async () => {
  const later = temporaryProject(
    'later-lifecycle',
    intakeState({ lifecycle: 'brief-ready' }),
  );
  const missing = mkdtempSync(join(tmpdir(), 'ntworkflow-phase-missing-'));
  try {
    await expectRejectedWithoutMutation(
      later,
      () => beginNttaskPhase(later, { sessionId: FIRST_OWNER }),
      ERROR_CODES.ILLEGAL_TRANSITION,
      11,
    );
    for (const operation of [
      () => completeNttaskPhase(missing, { sessionId: FIRST_OWNER }),
      () => stopNttaskPhase(missing, {
        sessionId: FIRST_OWNER,
        blocker: 'Blocked.',
      }),
    ] as const) {
      try {
        await operation();
      } catch (error) {
        assert.equal((error as WorkflowError).code, ERROR_CODES.COMMIT_FAILURE);
      }
    }
  } finally {
    rmSync(later, { force: true, recursive: true });
    rmSync(missing, { force: true, recursive: true });
  }
});
