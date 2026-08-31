import { SESSION_ID_FORMAT } from '../core/domain.ts';
import { ERROR_CODES, WorkflowError } from '../core/errors.ts';
import { providerForSessionId } from '../core/invariants.ts';
import type { State } from '../core/state.ts';
import { validateNttaskBrief } from './artifacts.ts';
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

export type IntakePhase = 'nttask' | 'ntgrill';

export interface BeginPhaseInput {
  readonly sessionId: string;
  readonly interruption?: InterruptionAuthority;
  readonly blockerResolved?: boolean;
}

export interface StopPhaseInput {
  readonly sessionId: string;
  readonly blocker: string;
  readonly interruption?: InterruptionAuthority;
}

type ActivePhaseState = TransactionState & {
  readonly current: NonNullable<TransactionState['current']> & {
    readonly lifecycle: 'intake-active' | 'brief-ready';
    readonly phase: IntakePhase;
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

export function validateSessionId(sessionId: string): void {
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

function ownershipConflict(recordedOwner: string, requestedOwner: string, phase: IntakePhase): never {
  throw new WorkflowError({
    code: ERROR_CODES.OWNERSHIP_CONFLICT,
    message: `An ${phase} owner is already recorded.`,
    details: {
      recorded_owner: recordedOwner,
      requested_owner: requestedOwner,
    },
  });
}

function unresolvedBlocker(blocker: string, phase: IntakePhase): never {
  throw new WorkflowError({
    code: ERROR_CODES.UNRESOLVED_BLOCKER,
    message: `The recorded blocker must be explicitly resolved before ${phase} begins.`,
    details: { blocker },
  });
}

export function requireActivePhase(
  state: TransactionState | null,
  operation: string,
  phase: IntakePhase,
): asserts state is ActivePhaseState {
  if (
    state?.current?.lifecycle !== (phase === 'nttask' ? 'intake-active' : 'brief-ready')
    || state.current.phase !== phase
    || state.current.owner === null
  ) {
    throw new WorkflowError({
      code: ERROR_CODES.ILLEGAL_TRANSITION,
      message: `${operation} requires an active ${phase} phase.`,
      details: {
        actual_lifecycle: state?.current?.lifecycle ?? null,
        actual_phase: state?.current?.phase ?? null,
      },
    });
  }
}

export function requireOwner(
  state: ActivePhaseState,
  sessionId: string,
  interruption?: InterruptionAuthority,
): void {
  if (
    state.current.owner.session_id !== sessionId
    && interruption === undefined
  ) {
    ownershipConflict(state.current.owner.session_id, sessionId, state.current.phase);
  }
}

function beginTransition(
  state: TransactionState | null,
  input: BeginPhaseInput,
  phase: IntakePhase,
): State & { current: NonNullable<State['current']> } {
  if (state?.current?.lifecycle !== (phase === 'nttask' ? 'intake-active' : 'brief-ready')) {
    illegalTransition(`phase begin ${phase}`, state);
  }
  if (state.current.blocker !== null && input.blockerResolved !== true) {
    unresolvedBlocker(state.current.blocker, phase);
  }
  if (state.current.owner !== null && input.interruption === undefined) {
    ownershipConflict(state.current.owner.session_id, input.sessionId, phase);
  }

  return {
    next_work_number: state.next_work_number,
    current: {
      run_id: state.current.run_id,
      lifecycle: state.current.lifecycle,
      phase,
      owner: { session_id: input.sessionId },
      blocker: null,
      work: null,
    },
  };
}

function stopTransition(
  state: TransactionState | null,
  input: StopPhaseInput,
  phase: IntakePhase,
): State {
  requireActivePhase(state, `phase stop ${phase}`, phase);
  requireOwner(state, input.sessionId, input.interruption);

  return {
    next_work_number: state.next_work_number,
    current: {
      run_id: state.current.run_id,
      lifecycle: state.current.lifecycle,
      phase: null,
      owner: null,
      blocker: input.blocker,
      work: null,
    },
  };
}

export async function beginPhase(
  projectRoot: string,
  phase: IntakePhase,
  input: BeginPhaseInput,
): Promise<StateTransactionResult> {
  validateSessionId(input.sessionId);
  validateInterruption(input.interruption);
  let runId: string;
  return runStateTransaction(projectRoot, (state) => {
    const next = beginTransition(state, input, phase);
    runId = next.current.run_id;
    return next;
  }, {
    ...(phase === 'ntgrill' ? {
      prepareCommit: () => validateNttaskBrief(projectRoot, runId),
    } : {}),
  });
}


export async function stopPhase(
  projectRoot: string,
  phase: IntakePhase,
  input: StopPhaseInput,
): Promise<StateTransactionResult> {
  validateSessionId(input.sessionId);
  validateInterruption(input.interruption);
  requireBlocker(input.blocker);
  return runStateTransaction(projectRoot, (state) => stopTransition(state, input, phase));
}

export function beginNttaskPhase(projectRoot: string, input: BeginPhaseInput) {
  return beginPhase(projectRoot, 'nttask', input);
}

export function stopNttaskPhase(projectRoot: string, input: StopPhaseInput) {
  return stopPhase(projectRoot, 'nttask', input);
}
