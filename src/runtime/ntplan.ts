import { ERROR_CODES, WorkflowError } from '../core/errors.ts';
import { providerForSessionId } from '../core/invariants.ts';
import { validateBrief } from './artifacts.ts';
import { readGitContext } from './git.ts';
import { requireActivePhase, requireOwner, validateSessionId } from './phase.ts';
import { validatePlanArtifacts } from './plan-artifacts.ts';
import { readPreflight } from './preflight.ts';
import { runStateTransaction } from './transaction.ts';
import type { TransactionFaultInjector } from './transaction.ts';

export async function validatePlan(
  projectRoot: string,
  sessionId: string,
  amendmentRecovery = false,
) {
  validateSessionId(sessionId);
  const { state } = await readPreflight(projectRoot);
  let runId: string;
  if (state?.current?.lifecycle === 'plan-approved') {
    runId = state.current.run_id;
  } else if (
    state?.current?.lifecycle === 'work-active'
    && state.current.phase === 'ntwork'
    && state.current.owner?.session_id === sessionId
  ) {
    runId = state.current.run_id;
  } else if (
    amendmentRecovery
    && state?.current?.lifecycle === 'work-active'
    && state.current.phase === null
    && state.current.owner === null
    && state.current.work !== null
    && state.current.blocker !== null
  ) {
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

export async function amendWorkPlan(
  projectRoot: string,
  input: {
    readonly sessionId: string;
    readonly criticPassed: boolean;
    readonly userConfirmed: boolean;
    readonly amendmentRecovery: boolean;
  },
) {
  validateSessionId(input.sessionId);
  if (!input.criticPassed || !input.userConfirmed) {
    throw new WorkflowError({
      code: ERROR_CODES.INVALID_INPUT,
      message: 'A work amendment requires current critic PASS and explicit user reapproval.',
      details: { arguments: ['--critic-pass', '--user-confirmed'] },
    });
  }
  const observed = await readGitContext(projectRoot);
  return runStateTransaction(projectRoot, async state => {
    if (state?.current?.lifecycle !== 'work-active') {
      throw new WorkflowError({
        code: ERROR_CODES.ILLEGAL_TRANSITION,
        message: 'Approved amendment validation is legal only for active ntwork.',
        details: { actual_lifecycle: state?.current?.lifecycle ?? null },
      });
    }
    const current = state.current;
    if (current.work === null) {
      throw new WorkflowError({
        code: ERROR_CODES.ILLEGAL_TRANSITION,
        message: 'Approved amendment validation requires ntwork state.',
        details: { actual_lifecycle: current.lifecycle },
      });
    }
    const work = current.work;
    const ownedActive = current.phase === 'ntwork' && current.owner !== null;
    const stoppedRecovery = input.amendmentRecovery
      && current.phase === null
      && current.owner === null
      && current.blocker !== null;
    if (!ownedActive && !stoppedRecovery) {
      throw new WorkflowError({
        code: ERROR_CODES.ILLEGAL_TRANSITION,
        message: 'Approved amendment validation is legal only for owned active ntwork.',
        details: { actual_lifecycle: current.lifecycle },
      });
    }
    if (ownedActive && current.owner?.session_id !== input.sessionId) {
      throw new WorkflowError({
        code: ERROR_CODES.OWNERSHIP_CONFLICT,
        message: 'An ntwork owner is already recorded.',
        details: {
          recorded_owner: current.owner?.session_id ?? null,
          requested_owner: input.sessionId,
        },
      });
    }
    const provider = providerForSessionId(input.sessionId);
    if (
      stoppedRecovery
      && work.provider !== provider
    ) {
      throw new WorkflowError({
        code: ERROR_CODES.OWNERSHIP_CONFLICT,
        message: 'An interrupted ntwork amendment must restart under the recorded provider.',
        details: { recorded_provider: work.provider, requested_provider: provider },
      });
    }
    if (
      work.branch !== observed.branch
      || work.head_commit !== observed.head
    ) {
      throw new WorkflowError({
        code: ERROR_CODES.ARTIFACT_FAILURE,
        message: 'Amendment validation requires the recorded ntwork Git boundary.',
        details: {
          recorded_branch: work.branch,
          actual_branch: observed.branch,
          recorded_head: work.head_commit,
          actual_head: observed.head,
        },
      });
    }
    await validateBrief(projectRoot, current.run_id, 'ntgrill');
    const taskIds = await validatePlanArtifacts(projectRoot, current.run_id);
    const completed = work.tasks.filter(task => task.status === 'completed');
    if (!completed.every((task, index) => task.task_id === taskIds[index])) {
      throw new WorkflowError({
        code: ERROR_CODES.ARTIFACT_FAILURE,
        message: 'A reapproved work amendment must preserve the completed task prefix.',
        details: { completed_tasks: completed.map(task => task.task_id) },
      });
    }
    const completedIds = new Set(completed.map(task => task.task_id));
    return {
      next_work_number: state.next_work_number,
      current: {
        ...current,
        phase: 'ntwork' as const,
        owner: { session_id: input.sessionId },
        blocker: null,
        work: {
          ...work,
          provider: work.provider,
          tasks: taskIds.map(taskId => {
            const historical = completed.find(task => task.task_id === taskId);
            return historical ?? {
              task_id: taskId, status: 'pending' as const, start_commit: null,
              commit_id: null, packet_review: 'pending' as const, quality_review: 'pending' as const,
            };
          }),
          evidence: work.evidence.filter(item => (
            !item.gate.startsWith('task:') || completedIds.has(item.gate.slice(5))
          ) && (
            !item.gate.startsWith('task-review:') || completedIds.has(item.gate.slice(12))
          ) && !['whole-plan', 'nyquist', 'spec-integration', 'code-review', 'ci'].includes(item.gate)),
          verdicts: {
            whole_plan: 'pending' as const,
            nyquist: 'pending' as const,
            spec_integration: 'pending' as const,
            code_review: 'pending' as const,
            ci: 'pending' as const,
          },
        },
      },
    };
  });
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
