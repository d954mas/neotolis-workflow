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


test('factories use their typed state, warnings, and error details directly', () => {
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

  assert.equal(success.state, state);
  assert.equal(success.warnings, warnings);
  assert.equal(failure.error.details, details);
});

test('failure types exclude exit code zero and default response states are usable', () => {
  assert.equal(failureExitCodeExcludesSuccess, true);
  assert.deepEqual(defaultResponseStatesAreUsable, [null, null, null]);
  assert.deepEqual(namedResponseState, namedState);
  assert.equal(typeof createNamedStateResponse, 'function');
});

test('preserves the typed next_action object', () => {
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

});
