import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createFailureResponse,
  createSuccessResponse,
  serializeResponse,
} from '../../src/core/protocol.ts';
import type {
  FailureResponse,
  ProtocolResponse,
  SuccessResponse,
} from '../../src/core/protocol.ts';
import {
  ERROR_CODES,
  EXIT_CODES,
  WorkflowError,
  normalizeCaughtError,
} from '../../src/core/errors.ts';

const failureExitCodeExcludesSuccess:
  Extract<FailureResponse['error']['exit_code'], 0> extends never ? true : false = true;
const defaultResponseStatesAreUsable: [
  ProtocolResponse['state'],
  SuccessResponse['state'],
  FailureResponse['state'],
] = [null, null, null];

interface NamedState {
  next_work_number: number;
  current: null;
}

const namedState: NamedState = {
  next_work_number: 1,
  current: null,
};
const namedResponseState: SuccessResponse<NamedState>['state'] = namedState;

function action(instruction: string) {
  return { skill: null, instruction } as const;
}
const createNamedStateResponse = () => createSuccessResponse({
  operation: 'status',
  projectRoot: '/work/project',
  state: namedState,
  nextAction: action('None.'),
  warnings: [],
});

test('serializes a success response as exactly one JSON line', () => {
  const response = createSuccessResponse({
    operation: 'status',
    projectRoot: 'C:/work/project',
    state: null,
    nextAction: action('Run nttask with a non-empty task.'),
    warnings: [],
  });

  assert.equal(
    serializeResponse(response),
    '{"ok":true,"operation":"status","project_root":"C:/work/project","state":null,"next_action":{"skill":null,"instruction":"Run nttask with a non-empty task."},"warnings":[]}\n',
  );
});

test('serializes a failure response with stable error details as exactly one JSON line', () => {
  const response = createFailureResponse({
    operation: 'phase begin nttask',
    projectRoot: '/work/project',
    state: { next_work_number: 1, current: null },
    nextAction: action('Start a run before beginning nttask.'),
    warnings: [],
    error: new WorkflowError({
      code: ERROR_CODES.ILLEGAL_TRANSITION,
      message: 'Cannot begin nttask without an active run.',
      details: { lifecycle: null },
    }),
  });

  assert.equal(
    serializeResponse(response),
    '{"ok":false,"operation":"phase begin nttask","project_root":"/work/project","state":{"next_work_number":1,"current":null},"next_action":{"skill":null,"instruction":"Start a run before beginning nttask."},"warnings":[],"error":{"code":"ILLEGAL_TRANSITION","exit_code":11,"message":"Cannot begin nttask without an active run.","details":{"lifecycle":null}}}\n',
  );
});

test('escapes embedded newlines without emitting more than one protocol line', () => {
  const response = createFailureResponse({
    operation: 'status',
    projectRoot: '/work/project',
    state: null,
    nextAction: action('Correct the input.'),
    warnings: [],
    error: new WorkflowError({
      code: ERROR_CODES.INVALID_INPUT,
      message: 'first line\nsecond line',
    }),
  });
  const serialized = serializeResponse(response);

  assert.equal(serialized.endsWith('\n'), true);
  assert.equal(serialized.slice(0, -1).includes('\n'), false);
  assert.deepEqual(JSON.parse(serialized), response);
});

test('locks the complete stable exit-code mapping', () => {
  assert.deepEqual(EXIT_CODES, {
    SUCCESS: 0,
    INVALID_INPUT: 2,
    INVALID_STATE: 10,
    ILLEGAL_TRANSITION: 11,
    OWNERSHIP_CONFLICT: 12,
    UNRESOLVED_BLOCKER: 13,
    ARTIFACT_FAILURE: 14,
    LOCK_CONFLICT: 15,
    COMMIT_FAILURE: 16,
    INTERNAL_FAILURE: 70,
  });
});

test('maps every stable workflow error code into the response and JSON line', () => {
  for (const [name, code] of Object.entries(ERROR_CODES)) {
    const workflowError = new WorkflowError({ code, message: name });
    const response = createFailureResponse({
      operation: 'test',
      projectRoot: '/work/project',
      state: null,
      nextAction: action('None.'),
      warnings: [],
      error: workflowError,
    });
    const serializedError = JSON.parse(serializeResponse(response)).error as {
      code: string;
      exit_code: number;
    };

    assert.equal(response.error.exit_code, workflowError.exitCode);
    assert.equal(serializedError.code, code);
    assert.equal(serializedError.exit_code, workflowError.exitCode);
  }
});

test('maps PARTIAL_RUN to the existing exit class 15', () => {
  const error = new WorkflowError({
    code: ERROR_CODES.PARTIAL_RUN,
    message: 'Partial run directory exists.',
  });

  assert.equal(error.exitCode, EXIT_CODES.LOCK_CONFLICT);
});

test('normalizes caught errors without exposing a stack trace', () => {
  const caught = new Error('disk exploded');
  caught.stack = 'SECRET STACK';

  const normalized = normalizeCaughtError(caught);

  assert.deepEqual(normalized, {
    code: ERROR_CODES.INTERNAL_FAILURE,
    exitCode: EXIT_CODES.INTERNAL_FAILURE,
    message: 'disk exploded',
    details: null,
  });
  assert.equal('stack' in normalized, false);
});

test('preserves declared workflow errors without exposing their stack traces', () => {
  const caught = new WorkflowError({
    code: ERROR_CODES.ARTIFACT_FAILURE,
    message: 'BRIEF.md is unreadable.',
    details: { path: '.ntworkflow/runs/NT-001/BRIEF.md' },
  });
  caught.stack = 'SECRET STACK';

  const normalized = normalizeCaughtError(caught);

  assert.deepEqual(normalized, {
    code: ERROR_CODES.ARTIFACT_FAILURE,
    exitCode: EXIT_CODES.ARTIFACT_FAILURE,
    message: 'BRIEF.md is unreadable.',
    details: { path: '.ntworkflow/runs/NT-001/BRIEF.md' },
  });
  assert.equal('stack' in normalized, false);
});

test('invalid runtime state produces a serializable internal failure', () => {
  const cyclicState: { self?: unknown } = {};
  cyclicState.self = cyclicState;
  const invalidStates = [undefined, 1n, Number.NaN, cyclicState];

  for (const state of invalidStates) {
    const response = createSuccessResponse({
      operation: 'status',
      projectRoot: '/work/project',
      state: state as never,
      nextAction: action('Correct the runtime integration.'),
      warnings: [],
    });

    assert.equal(response.ok, false);
    assert.equal(JSON.parse(serializeResponse(response)).error.exit_code, EXIT_CODES.INTERNAL_FAILURE);
  }
});

test('sanitizes invalid error details without changing the declared exit code', () => {
  const response = createFailureResponse({
    operation: 'status',
    projectRoot: '/work/project',
    state: null,
    nextAction: action('Correct the input.'),
    warnings: [],
    error: new WorkflowError({
      code: ERROR_CODES.INVALID_INPUT,
      message: 'Invalid input.',
      details: { value: Number.NaN },
    }),
  });

  assert.deepEqual(response.error, {
    code: ERROR_CODES.INVALID_INPUT,
    exit_code: EXIT_CODES.INVALID_INPUT,
    message: 'Invalid input.',
    details: null,
  });
});

test('factories keep deep snapshots of state, warnings, and error details', () => {
  const state = { nested: { values: [1] } };
  const warnings = ['initial'];
  const details = { nested: { value: 1 } };
  const success = createSuccessResponse({
    operation: 'status',
    projectRoot: '/work/project',
    state,
    nextAction: action('None.'),
    warnings,
  });
  const failure = createFailureResponse({
    operation: 'status',
    projectRoot: '/work/project',
    state: null,
    nextAction: action('Correct the input.'),
    warnings: [],
    error: new WorkflowError({
      code: ERROR_CODES.INVALID_INPUT,
      message: 'Invalid input.',
      details,
    }),
  });

  state.nested.values.push(2);
  warnings.push('late mutation');
  details.nested.value = 2;

  const serializedSuccess = JSON.parse(serializeResponse(success)) as {
    state: unknown;
    warnings: unknown;
  };
  assert.deepEqual(serializedSuccess.state, {
    nested: { values: [1] },
  });
  assert.deepEqual(serializedSuccess.warnings, ['initial']);
  assert.deepEqual(failure.error.details, { nested: { value: 1 } });
});

test('types reject non-JSON state', () => {
  const compileOnlyAssertions = () => {
    createSuccessResponse({
      operation: 'x',
      projectRoot: 'x',
      state: null,
      // @ts-expect-error nextAction has one canonical object contract
      nextAction: 'x',
      warnings: [],
    });
    // @ts-expect-error functions are not JSON state
    createSuccessResponse({ operation: 'x', projectRoot: 'x', state: () => null, nextAction: action('x'), warnings: [] });
    // @ts-expect-error Map is not JSON state
    createSuccessResponse({ operation: 'x', projectRoot: 'x', state: new Map(), nextAction: action('x'), warnings: [] });
    // @ts-expect-error Date is not JSON state
    createSuccessResponse({ operation: 'x', projectRoot: 'x', state: new Date(), nextAction: action('x'), warnings: [] });
    // @ts-expect-error custom toJSON is not JSON state
    createSuccessResponse({ operation: 'x', projectRoot: 'x', state: { toJSON: () => null }, nextAction: action('x'), warnings: [] });
  };

  assert.equal(typeof compileOnlyAssertions, 'function');
});

test('failure types exclude exit code zero and default response states are usable', () => {
  assert.equal(failureExitCodeExcludesSuccess, true);
  assert.deepEqual(defaultResponseStatesAreUsable, [null, null, null]);
  assert.deepEqual(namedResponseState, namedState);
  assert.equal(typeof createNamedStateResponse, 'function');
});

test('accepts only the canonical object shape for next_action', () => {
  const valid = createSuccessResponse({
    operation: 'status',
    projectRoot: '/work/project',
    state: null,
    nextAction: {
      skill: 'nttask',
      instruction: 'Start nttask with a non-empty task.',
    },
    warnings: [],
  });
  assert.equal(valid.ok, true);
  assert.deepEqual(valid.next_action, {
    skill: 'nttask',
    instruction: 'Start nttask with a non-empty task.',
  });

  const invalid = createSuccessResponse({
    operation: 'status',
    projectRoot: '/work/project',
    state: null,
    nextAction: 'Run nttask.' as never,
    warnings: [],
  });
  assert.equal(invalid.ok, false);
  assert.equal(Object.isFrozen(invalid.next_action), true);
});
