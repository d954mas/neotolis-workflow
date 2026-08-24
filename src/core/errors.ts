export const EXIT_CODES = Object.freeze({
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
} as const);

export type ExitCode = (typeof EXIT_CODES)[keyof typeof EXIT_CODES];
export type FailureExitCode = Exclude<ExitCode, typeof EXIT_CODES.SUCCESS>;

export const ERROR_CODES = Object.freeze({
  INVALID_INPUT: 'INVALID_INPUT',
  INVALID_STATE: 'INVALID_STATE',
  ILLEGAL_TRANSITION: 'ILLEGAL_TRANSITION',
  OWNERSHIP_CONFLICT: 'OWNERSHIP_CONFLICT',
  UNRESOLVED_BLOCKER: 'UNRESOLVED_BLOCKER',
  ARTIFACT_FAILURE: 'ARTIFACT_FAILURE',
  LOCK_CONFLICT: 'LOCK_CONFLICT',
  PARTIAL_RUN: 'PARTIAL_RUN',
  COMMIT_FAILURE: 'COMMIT_FAILURE',
  INTERNAL_FAILURE: 'INTERNAL_FAILURE',
} as const);

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

const ERROR_EXIT_CODES = Object.freeze({
  [ERROR_CODES.INVALID_INPUT]: EXIT_CODES.INVALID_INPUT,
  [ERROR_CODES.INVALID_STATE]: EXIT_CODES.INVALID_STATE,
  [ERROR_CODES.ILLEGAL_TRANSITION]: EXIT_CODES.ILLEGAL_TRANSITION,
  [ERROR_CODES.OWNERSHIP_CONFLICT]: EXIT_CODES.OWNERSHIP_CONFLICT,
  [ERROR_CODES.UNRESOLVED_BLOCKER]: EXIT_CODES.UNRESOLVED_BLOCKER,
  [ERROR_CODES.ARTIFACT_FAILURE]: EXIT_CODES.ARTIFACT_FAILURE,
  [ERROR_CODES.LOCK_CONFLICT]: EXIT_CODES.LOCK_CONFLICT,
  [ERROR_CODES.PARTIAL_RUN]: EXIT_CODES.LOCK_CONFLICT,
  [ERROR_CODES.COMMIT_FAILURE]: EXIT_CODES.COMMIT_FAILURE,
  [ERROR_CODES.INTERNAL_FAILURE]: EXIT_CODES.INTERNAL_FAILURE,
} satisfies Record<ErrorCode, FailureExitCode>);

export type JsonPrimitive = null | boolean | number | string;
export type JsonValue = JsonPrimitive | readonly JsonValue[] | {
  readonly [key: string]: JsonValue;
};
export type ErrorDetails = JsonValue;

export function hasErrorCode(error: unknown, code: string): boolean {
  return error !== null
    && typeof error === 'object'
    && 'code' in error
    && error.code === code;
}

export interface WorkflowErrorOptions {
  code: ErrorCode;
  message: string;
  details?: ErrorDetails;
}

export interface NormalizedWorkflowError {
  code: ErrorCode;
  exitCode: FailureExitCode;
  message: string;
  details: ErrorDetails;
}

export class WorkflowError extends Error {
  override readonly name = 'WorkflowError';
  readonly code: ErrorCode;
  readonly details: ErrorDetails;
  readonly exitCode: FailureExitCode;

  constructor(options: WorkflowErrorOptions) {
    super(options.message);
    this.code = options.code;
    this.details = options.details ?? null;
    this.exitCode = ERROR_EXIT_CODES[options.code];
  }
}

export function normalizeCaughtError(error: unknown): NormalizedWorkflowError {
  if (error instanceof WorkflowError) {
    return {
      code: error.code,
      exitCode: error.exitCode,
      message: error.message,
      details: error.details,
    };
  }

  return {
    code: ERROR_CODES.INTERNAL_FAILURE,
    exitCode: EXIT_CODES.INTERNAL_FAILURE,
    message: error instanceof Error ? error.message : 'An internal error occurred.',
    details: null,
  };
}