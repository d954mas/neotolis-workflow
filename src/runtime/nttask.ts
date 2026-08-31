import { validateNttaskBrief } from './artifacts.ts';
import { requireActivePhase, requireOwner, validateSessionId } from './phase.ts';
import { runStateTransaction } from './transaction.ts';
import type { StateTransactionResult } from './transaction.ts';

export interface CompleteNttaskPhaseInput {
  readonly sessionId: string;
}

export async function completeNttaskPhase(
  projectRoot: string,
  input: CompleteNttaskPhaseInput,
): Promise<StateTransactionResult> {
  validateSessionId(input.sessionId);
  let runId: string;
  return runStateTransaction(projectRoot, (state) => {
    requireActivePhase(state, 'phase complete nttask', 'nttask');
    requireOwner(state, input.sessionId);
    runId = state.current.run_id;
    return {
      next_work_number: state.next_work_number,
      current: {
        run_id: runId, lifecycle: 'brief-ready', phase: null,
        owner: null, blocker: null, work: null,
      },
    };
  }, {
    prepareCommit: () => validateNttaskBrief(projectRoot, runId),
  });
}
