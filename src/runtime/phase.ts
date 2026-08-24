import { SESSION_ID_FORMAT } from '../core/domain.ts';
import { ERROR_CODES, WorkflowError } from '../core/errors.ts';
import { providerForSessionId } from '../core/invariants.ts';
import type { State } from '../core/state.ts';
import { runStateTransaction } from './transaction.ts';
import type {
  StateTransactionResult,
  TransactionState,
} from './transaction.ts';

export const INTERRUPTION_AUTHORITIES = Object.freeze([
  'provider-ended',
  'user-confirmed',
] as const);

export type InterruptionAuthority = (typeof INTERRUPTION_AUTHORITIES)[number];

export function isInterruptionAuthority(value: unknown): value is InterruptionAuthority {
  return INTERRUPTION_AUTHORITIES.some((authority) => authority === value);
}

export interface BeginNttaskPhaseInput {
  readonly sessionId: string;
  readonly interruption?: InterruptionAuthority;
  readonly blockerResolved?: boolean;
}

export interface StopNttaskPhaseInput {
  readonly sessionId: string;
  readonly blocker: string;
  readonly interruption?: InterruptionAuthority;
}

export { completeNttaskPhase } from './nttask.ts';

type ActiveNttaskState = TransactionState & {
  readonly current: NonNullable<TransactionState['current']> & {
    readonly lifecycle: 'intake-active';
    readonly phase: 'nttask';
    readonly owner: { readonly session_id: string };
  };
};

function invalidInput(message: string, argument: string, expected?: string): never {
  throw new WorkflowError({
    code: ERROR_CODES.INVALID_INPUT,
    message,
    details: expected === undefined ? { argument } : { argument, expected },
  });
}

function validateSessionId(sessionId: string): void {
  if (providerForSessionId(sessionId) === null) {
    invalidInput(
      'A canonical provider session ID is required.',
      '--session-id',
      SESSION_ID_FORMAT,
    );
  }
}

function validateInterruption(interruption: unknown): void {
  if (interruption !== undefined && !isInterruptionAuthority(interruption)) {
    invalidInput(
      'Interruption authority is invalid.',
      '--interruption',
      'provider-ended or user-confirmed',
    );
  }
}

function requireBlocker(blocker: string): void {
  if (blocker.trim().length === 0) {
    invalidInput('A controlled phase stop requires a non-empty blocker.', '--blocker');
  }
}

function illegalTransition(
  operation: string,
  state: TransactionState | null,
): never {
  throw new WorkflowError({
    code: ERROR_CODES.ILLEGAL_TRANSITION,
    message: `${operation} is not legal from the current lifecycle.`,
    details: {
      actual_lifecycle: state?.current?.lifecycle ?? null,
      actual_phase: state?.current?.phase ?? null,
    },
  });
}

function ownershipConflict(recordedOwner: string, requestedOwner: string): never {
  throw new WorkflowError({
    code: ERROR_CODES.OWNERSHIP_CONFLICT,
    message: 'An nttask owner is already recorded.',
    details: {
      recorded_owner: recordedOwner,
      requested_owner: requestedOwner,
    },
  });
}

function unresolvedBlocker(blocker: string): never {
  throw new WorkflowError({
    code: ERROR_CODES.UNRESOLVED_BLOCKER,
    message: 'The recorded blocker must be explicitly resolved before nttask begins.',
    details: { blocker },
  });
}

function requireActiveNttask(
  state: TransactionState | null,
  operation: string,
): asserts state is ActiveNttaskState {
  if (
    state?.current?.lifecycle !== 'intake-active'
    || state.current.phase !== 'nttask'
    || state.current.owner === null
  ) {
    throw new WorkflowError({
      code: ERROR_CODES.ILLEGAL_TRANSITION,
      message: `${operation} requires an active nttask phase.`,
      details: {
        actual_lifecycle: state?.current?.lifecycle ?? null,
        actual_phase: state?.current?.phase ?? null,
      },
    });
  }
}

function requireOwner(
  state: ActiveNttaskState,
  sessionId: string,
  interruption?: InterruptionAuthority,
): void {
  if (
    state.current.owner.session_id !== sessionId
    && interruption === undefined
  ) {
    ownershipConflict(state.current.owner.session_id, sessionId);
  }
}

function beginTransition(
  state: TransactionState | null,
  input: BeginNttaskPhaseInput,
): State {
  if (state?.current?.lifecycle !== 'intake-active') {
    illegalTransition('phase begin nttask', state);
  }
  if (state.current.blocker !== null && input.blockerResolved !== true) {
    unresolvedBlocker(state.current.blocker);
  }
  if (state.current.owner !== null && input.interruption === undefined) {
    ownershipConflict(state.current.owner.session_id, input.sessionId);
  }

  return {
    next_work_number: state.next_work_number,
    current: {
      run_id: state.current.run_id,
      lifecycle: 'intake-active',
      phase: 'nttask',
      owner: { session_id: input.sessionId },
      blocker: null,
      work: null,
    },
  };
}

function stopTransition(
  state: TransactionState | null,
  input: StopNttaskPhaseInput,
): State {
  requireActiveNttask(state, 'phase stop nttask');
  requireOwner(state, input.sessionId, input.interruption);

  return {
    next_work_number: state.next_work_number,
    current: {
      run_id: state.current.run_id,
      lifecycle: 'intake-active',
      phase: null,
      owner: null,
      blocker: input.blocker,
      work: null,
    },
  };
}

export async function beginNttaskPhase(
  projectRoot: string,
  input: BeginNttaskPhaseInput,
): Promise<StateTransactionResult> {
  validateSessionId(input.sessionId);
  validateInterruption(input.interruption);
  return runStateTransaction(projectRoot, (state) => beginTransition(state, input));
}


export async function stopNttaskPhase(
  projectRoot: string,
  input: StopNttaskPhaseInput,
): Promise<StateTransactionResult> {
  validateSessionId(input.sessionId);
  validateInterruption(input.interruption);
  requireBlocker(input.blocker);
  return runStateTransaction(projectRoot, (state) => stopTransition(state, input));
}
