import { ERROR_CODES, WorkflowError } from '../core/errors.ts';
import { validateBrief } from './artifacts.ts';
import { requireActivePhase, requireOwner, validateSessionId } from './phase.ts';
import { validatePlanArtifacts } from './plan-artifacts.ts';
import { readPreflight } from './preflight.ts';
import { runStateTransaction } from './transaction.ts';
import type { TransactionFaultInjector } from './transaction.ts';

export async function validatePlan(projectRoot: string, sessionId: string) {
  validateSessionId(sessionId);
  const { state } = await readPreflight(projectRoot);
  let runId: string;
  if (state?.current?.lifecycle === 'plan-approved') {
    runId = state.current.run_id;
  } else {
    requireActivePhase(state, 'plan validate', 'ntplan');
    requireOwner(state, sessionId);
    runId = state.current.run_id;
  }
  await validateBrief(projectRoot, runId, 'ntgrill');
  await validatePlanArtifacts(projectRoot, runId);
  return { state, warnings: [] };
}

export async function completeNtplanPhase(
  projectRoot: string,
  input: { readonly sessionId: string; readonly criticPassed: boolean; readonly userConfirmed: boolean },
  options: { readonly faultInjector?: TransactionFaultInjector } = {},
) {
  validateSessionId(input.sessionId);
  if (input.criticPassed !== true || input.userConfirmed !== true) throw new WorkflowError({
    code: ERROR_CODES.INVALID_INPUT,
    message: 'ntplan completion requires current independent critic PASS and explicit user approval.',
    details: { arguments: ['--critic-pass', '--user-confirmed'] },
  });
  return runStateTransaction(projectRoot, async state => {
    requireActivePhase(state, 'phase complete ntplan', 'ntplan');
    requireOwner(state, input.sessionId);
    const runId = state.current.run_id;
    await validateBrief(projectRoot, runId, 'ntgrill');
    const taskIds = await validatePlanArtifacts(projectRoot, runId);
    return {
      next_work_number: state.next_work_number,
      current: {
        run_id: runId, lifecycle: 'plan-approved', phase: null, owner: null, blocker: null,
        work: {
          tasks: taskIds.map(task_id => ({
            task_id, status: 'pending', start_commit: null, commit_id: null,
            packet_review: 'pending', quality_review: 'pending',
          })),
          provider: null, branch: null, base_branch: null, pull_request: null, head_commit: null,
          fix_commits: [], evidence: [],
          verdicts: { whole_plan: 'pending', nyquist: 'pending', spec_integration: 'pending', code_review: 'pending', ci: 'pending' },
        },
      },
    };
  }, options);
}
