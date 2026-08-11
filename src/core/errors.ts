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
  [ERROR_CODES.COMMIT_FAILURE]: EXIT_CODES.COMMIT_FAILURE,
  [ERROR_CODES.INTERNAL_FAILURE]: EXIT_CODES.INTERNAL_FAILURE,
} satisfies Record<ErrorCode, FailureExitCode>);

export type JsonPrimitive = null | boolean | number | string;
export type JsonValue = JsonPrimitive | readonly JsonValue[] | {
  readonly [key: string]: JsonValue;
};
export type ErrorDetails = JsonValue;

function snapshotJsonValueInternal(
  value: unknown,
  ancestors: Set<object>,
): JsonValue | undefined {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value !== 'object' || ancestors.has(value)) {
    return undefined;
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const keys = Reflect.ownKeys(value);
      const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
      if (
        lengthDescriptor === undefined
        || !('value' in lengthDescriptor)
        || !Number.isSafeInteger(lengthDescriptor.value)
        || lengthDescriptor.value < 0
        || keys.length !== lengthDescriptor.value + 1
      ) {
        return undefined;
      }

      const snapshot: JsonValue[] = [];
      for (let index = 0; index < lengthDescriptor.value; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
          return undefined;
        }
        const entry = snapshotJsonValueInternal(descriptor.value, ancestors);
        if (entry === undefined) {
          return undefined;
        }
        snapshot.push(entry);
      }
      return Object.freeze(snapshot);
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      return undefined;
    }

    const snapshot: { [key: string]: JsonValue } = {};
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string') {
        return undefined;
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
        return undefined;
      }
      const entry = snapshotJsonValueInternal(descriptor.value, ancestors);
      if (entry === undefined) {
        return undefined;
      }
      Object.defineProperty(snapshot, key, {
        enumerable: true,
        value: entry,
      });
    }
    return Object.freeze(snapshot);
  } finally {
    ancestors.delete(value);
  }
}

export function createJsonSnapshot(value: unknown): JsonValue | undefined {
  try {
    return snapshotJsonValueInternal(value, new Set());
  } catch {
    return undefined;
  }
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
    let code: ErrorCode = ERROR_CODES.INTERNAL_FAILURE;
    let message = 'An internal error occurred.';
    let details: ErrorDetails = null;

    try {
      const candidateCode = options.code;
      const candidateMessage = options.message;
      const candidateDetails = options.details ?? null;

      if (Object.values(ERROR_CODES).includes(candidateCode)) {
        code = candidateCode;
      }
      if (typeof candidateMessage === 'string') {
        message = candidateMessage;
      }
      const detailsSnapshot = createJsonSnapshot(candidateDetails);
      if (detailsSnapshot !== undefined) {
        details = detailsSnapshot;
      }
    } catch {
      // Keep the constant internal-error defaults.
    }

    super(message);
    this.code = code;
    this.details = details;
    this.exitCode = ERROR_EXIT_CODES[code];
  }
}

export function normalizeCaughtError(error: unknown): NormalizedWorkflowError {
  const internalError: NormalizedWorkflowError = {
    code: ERROR_CODES.INTERNAL_FAILURE,
    exitCode: EXIT_CODES.INTERNAL_FAILURE,
    message: 'An internal error occurred.',
    details: null,
  };

  try {
    if (error instanceof WorkflowError) {
      const code = error.code;
      const message = error.message;
      const details = error.details;
      if (!Object.values(ERROR_CODES).includes(code) || typeof message !== 'string') {
        return internalError;
      }

      return {
        code,
        exitCode: ERROR_EXIT_CODES[code],
        message,
        details: createJsonSnapshot(details) ?? null,
      };
    }

    if (error instanceof Error) {
      const message = error.message;
      if (typeof message !== 'string') {
        return internalError;
      }
      return {
        ...internalError,
        message,
      };
    }
  } catch {
    return internalError;
  }

  return internalError;
}
