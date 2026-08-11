import {
  ERROR_CODES,
  EXIT_CODES,
  createJsonSnapshot,
  normalizeCaughtError,
} from './errors.ts';
import type {
  ErrorCode,
  ErrorDetails,
  FailureExitCode,
  JsonValue,
} from './errors.ts';

type JsonCompatible<T> =
  [T] extends [JsonValue] ? T
    : T extends (...args: never[]) => unknown ? never
      : T extends readonly unknown[] ? { readonly [K in keyof T]: JsonCompatible<T[K]> }
        : T extends object ? { readonly [K in keyof T]: JsonCompatible<T[K]> }
          : never;

interface ResponseContext<TState> {
  operation: string;
  projectRoot: string;
  state: TState & JsonCompatible<TState>;
  nextAction: string;
  warnings: readonly string[];
}

export interface SuccessResponse<TState = JsonValue> {
  readonly ok: true;
  readonly operation: string;
  readonly project_root: string;
  readonly state: JsonCompatible<TState>;
  readonly next_action: string;
  readonly warnings: readonly string[];
}

export interface FailureResponse<TState = JsonValue> {
  readonly ok: false;
  readonly operation: string;
  readonly project_root: string;
  readonly state: JsonCompatible<TState>;
  readonly next_action: string;
  readonly warnings: readonly string[];
  readonly error: {
    readonly code: ErrorCode;
    readonly exit_code: FailureExitCode;
    readonly message: string;
    readonly details: ErrorDetails;
  };
}

export type ProtocolResponse<TState = JsonValue> =
  | SuccessResponse<TState>
  | FailureResponse<TState>;

interface ResponseMetadata {
  readonly operation: string;
  readonly projectRoot: string;
  readonly nextAction: string;
  readonly warnings: readonly string[];
}

interface ContextSnapshot extends ResponseMetadata {
  readonly state: JsonValue | undefined;
}

function freezeFailureResponse<TState>(
  response: FailureResponse<TState>,
): FailureResponse<TState> {
  Object.freeze(response.error);
  return Object.freeze(response);
}

const EMERGENCY_FAILURE_RESPONSE = freezeFailureResponse<null>({
  ok: false,
  operation: 'unknown',
  project_root: '',
  state: null,
  next_action: 'Inspect the internal failure and retry.',
  warnings: Object.freeze([]),
  error: {
    code: ERROR_CODES.INTERNAL_FAILURE,
    exit_code: EXIT_CODES.INTERNAL_FAILURE,
    message: 'Protocol response could not be serialized.',
    details: null,
  },
});

function snapshotWarnings(value: unknown): readonly string[] | undefined {
  const snapshot = createJsonSnapshot(value);
  if (!Array.isArray(snapshot) || !snapshot.every((warning) => typeof warning === 'string')) {
    return undefined;
  }
  return snapshot as readonly string[];
}

function snapshotContext<TState>(
  context: ResponseContext<TState>,
): ContextSnapshot | undefined {
  try {
    const operation = context.operation;
    const projectRoot = context.projectRoot;
    const state = context.state;
    const nextAction = context.nextAction;
    const warnings = snapshotWarnings(context.warnings);

    if (
      typeof operation !== 'string'
      || typeof projectRoot !== 'string'
      || typeof nextAction !== 'string'
      || warnings === undefined
    ) {
      return undefined;
    }

    return Object.freeze({
      operation,
      projectRoot,
      state: createJsonSnapshot(state),
      nextAction,
      warnings,
    });
  } catch {
    return undefined;
  }
}

function createContextFailureResponse(metadata: ResponseMetadata): FailureResponse<null> {
  return freezeFailureResponse({
    ok: false,
    operation: metadata.operation,
    project_root: metadata.projectRoot,
    state: null,
    next_action: metadata.nextAction,
    warnings: metadata.warnings,
    error: {
      code: ERROR_CODES.INTERNAL_FAILURE,
      exit_code: EXIT_CODES.INTERNAL_FAILURE,
      message: 'Protocol response could not be serialized.',
      details: null,
    },
  });
}

export function createSuccessResponse<TState>(
  context: ResponseContext<TState>,
): SuccessResponse<TState> | FailureResponse<null> {
  const snapshot = snapshotContext(context);
  if (snapshot === undefined) {
    return EMERGENCY_FAILURE_RESPONSE;
  }
  if (snapshot.state === undefined) {
    return createContextFailureResponse(snapshot);
  }

  return Object.freeze({
    ok: true,
    operation: snapshot.operation,
    project_root: snapshot.projectRoot,
    state: snapshot.state as JsonCompatible<TState>,
    next_action: snapshot.nextAction,
    warnings: snapshot.warnings,
  });
}

export function createFailureResponse<TState>(
  context: ResponseContext<TState> & { error: unknown },
): FailureResponse<TState> | FailureResponse<null> {
  const snapshot = snapshotContext(context);
  if (snapshot === undefined) {
    return EMERGENCY_FAILURE_RESPONSE;
  }
  if (snapshot.state === undefined) {
    return createContextFailureResponse(snapshot);
  }

  const error = normalizeCaughtError(context.error);
  return freezeFailureResponse({
    ok: false,
    operation: snapshot.operation,
    project_root: snapshot.projectRoot,
    state: snapshot.state as JsonCompatible<TState>,
    next_action: snapshot.nextAction,
    warnings: snapshot.warnings,
    error: {
      code: error.code,
      exit_code: error.exitCode,
      message: error.message,
      details: error.details,
    },
  });
}

export function serializeResponse<TState>(
  response: ProtocolResponse<TState>,
): string {
  const serialized = JSON.stringify(response);
  if (serialized === undefined) {
    throw new TypeError('Protocol response could not be serialized.');
  }
  return `${serialized}\n`;
}
