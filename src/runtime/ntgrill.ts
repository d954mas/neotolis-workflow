import { ERROR_CODES, WorkflowError } from '../core/errors.ts';
import { validateBrief } from './artifacts.ts';
import { requireActivePhase, requireOwner, validateSessionId } from './phase.ts';
import { runStateTransaction } from './transaction.ts';
import type { TransactionFaultInjector } from './transaction.ts';

export async function completeNtgrillPhase(
  projectRoot: string,
  input: { readonly sessionId: string; readonly userConfirmed: boolean },
  options: { readonly faultInjector?: TransactionFaultInjector } = {},
) {
  validateSessionId(input.sessionId);
  if (input.userConfirmed !== true) {
    throw new WorkflowError({
      code: ERROR_CODES.INVALID_INPUT,
      message: 'ntgrill completion requires explicit user confirmation of shared understanding.',
      details: { argument: '--user-confirmed' },
    });
  }
  let runId: string;
  return runStateTransaction(projectRoot, (state) => {
    requireActivePhase(state, 'phase complete ntgrill', 'ntgrill');
    requireOwner(state, input.sessionId);
    runId = state.current.run_id;
    return {
      next_work_number: state.next_work_number,
      current: {
        run_id: runId, lifecycle: 'plan-ready', phase: null,
        owner: null, blocker: null, work: null,
      },
    };
  }, {
    ...options,
    prepareCommit: () => validateBrief(projectRoot, runId, 'ntgrill'),
  });
}
