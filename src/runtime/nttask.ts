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

export interface CompleteNttaskPhaseInput {
  readonly sessionId: string;
}

type ActiveNttaskState = TransactionState & {
  readonly current: NonNullable<TransactionState['current']> & {
    readonly lifecycle: 'intake-active';
    readonly phase: 'nttask';
    readonly owner: { readonly session_id: string };
  };
};

function validateNttaskSessionId(sessionId: string): void {
  if (providerForSessionId(sessionId) === null) {
    throw new WorkflowError({
      code: ERROR_CODES.INVALID_INPUT,
      message: 'A canonical provider session ID is required.',
      details: { argument: '--session-id', expected: SESSION_ID_FORMAT },
    });
  }
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

function requireNttaskCompletionAuthority(
  state: TransactionState | null,
  input: CompleteNttaskPhaseInput,
): asserts state is ActiveNttaskState {
  if (
    state?.current?.lifecycle !== 'intake-active'
    || state.current.phase !== 'nttask'
    || state.current.owner === null
  ) {
    throw new WorkflowError({
      code: ERROR_CODES.ILLEGAL_TRANSITION,
      message: 'phase complete nttask requires an active nttask phase.',
      details: {
        actual_lifecycle: state?.current?.lifecycle ?? null,
        actual_phase: state?.current?.phase ?? null,
      },
    });
  }
  if (state.current.owner.session_id !== input.sessionId) {
    ownershipConflict(state.current.owner.session_id, input.sessionId);
  }
}

function completedState(state: ActiveNttaskState): State {
  return {
    next_work_number: state.next_work_number,
    current: {
      run_id: state.current.run_id,
      lifecycle: 'brief-ready',
      phase: null,
      owner: null,
      blocker: null,
      work: null,
    },
  };
}

export async function completeNttaskPhase(
  projectRoot: string,
  input: CompleteNttaskPhaseInput,
): Promise<StateTransactionResult> {
  validateNttaskSessionId(input.sessionId);
  let runId: string;
  return runStateTransaction(
    projectRoot,
    (state) => {
      requireNttaskCompletionAuthority(state, input);
      runId = state.current.run_id;
      return completedState(state);
    },
    {
      prepareCommit: () => validateNttaskBrief(projectRoot, runId),
    },
  );
}
