import type { PhaseSkill } from './state.ts';
import { normalizeCaughtError } from './errors.ts';
import type {
  ErrorCode,
  ErrorDetails,
  FailureExitCode,
  JsonValue,
} from './errors.ts';

export type NextSkill = PhaseSkill | null;

export interface NextAction {
  readonly skill: NextSkill;
  readonly instruction: string;
}

interface ResponseContext<TState> {
  operation: string;
  projectRoot: string;
  state: TState;
  nextAction: NextAction;
  warnings: readonly string[];
}

export interface SuccessResponse<TState = JsonValue> {
  readonly ok: true;
  readonly operation: string;
  readonly project_root: string;
  readonly state: TState;
  readonly next_action: NextAction;
  readonly warnings: readonly string[];
}

export interface FailureResponse<TState = JsonValue> {
  readonly ok: false;
  readonly operation: string;
  readonly project_root: string;
  readonly state: TState;
  readonly next_action: NextAction;
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

export function createSuccessResponse<TState>(
  context: ResponseContext<TState>,
): SuccessResponse<TState> {
  return {
    ok: true,
    operation: context.operation,
    project_root: context.projectRoot,
    state: context.state,
    next_action: context.nextAction,
    warnings: context.warnings,
  };
}

export function createFailureResponse<TState>(
  context: ResponseContext<TState> & { error: unknown },
): FailureResponse<TState> {
  const error = normalizeCaughtError(context.error);

  return {
    ok: false,
    operation: context.operation,
    project_root: context.projectRoot,
    state: context.state,
    next_action: context.nextAction,
    warnings: context.warnings,
    error: {
      code: error.code,
      exit_code: error.exitCode,
      message: error.message,
      details: error.details,
    },
  };
}

export function serializeResponse<TState>(
  response: ProtocolResponse<TState>,
): string {
  return JSON.stringify(response) + '\n';
}