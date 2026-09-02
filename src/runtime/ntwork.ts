import { ERROR_CODES, WorkflowError } from '../core/errors.ts';
import { providerForSessionId } from '../core/invariants.ts';
import type { State } from '../core/state.ts';
import { validateBrief } from './artifacts.ts';
import { readCommitParent, readGitContext } from './git.ts';
import { validatePlanArtifacts } from './plan-artifacts.ts';
import { validateSessionId } from './phase.ts';
import type { InterruptionAuthority } from './phase.ts';
import { readPreflight } from './preflight.ts';
import { runStateTransaction } from './transaction.ts';
import type { TransactionState } from './transaction.ts';

export const NTWORK_ROLES = [
  'implementer',
  'task-reviewer',
  'nyquist-auditor',
  'spec-integration-reviewer',
  'code-reviewer',
] as const;
export type NtworkRole = (typeof NTWORK_ROLES)[number];

export interface BeginNtworkInput {
  readonly sessionId: string;
  readonly interruption?: InterruptionAuthority;
  readonly blockerResolved?: boolean;
  readonly availableRoles: ReadonlySet<NtworkRole>;
  readonly existingChangesConfirmed?: boolean;
  readonly baseBranch?: string;
}

export interface StopNtworkInput {
  readonly sessionId: string;
  readonly blocker: string;
  readonly interruption?: InterruptionAuthority;
}

export interface BeginWorkTaskInput {
  readonly sessionId: string;
  readonly taskId: string;
  readonly existingChangesConfirmed?: boolean;
}

export interface CompleteWorkTaskInput extends BeginWorkTaskInput {
  readonly commitId: string;
}

interface EvidenceFields {
  readonly sessionId: string;
  readonly procedure: string;
  readonly result: string;
  readonly expected: string;
  readonly sourceIds: readonly string[];
}

interface EvidenceInput extends EvidenceFields {
  readonly gate: string;
}

interface TaskReviewInput {
  readonly sessionId: string;
  readonly taskId: string;
  readonly packet: 'pass' | 'block';
  readonly quality: 'pass' | 'block';
  readonly sourceIds: readonly string[];
}

interface FinalGateInput extends EvidenceFields {
  readonly gate: 'whole-plan' | 'nyquist' | 'spec-integration' | 'code-review' | 'ci';
  readonly verdict: 'pass' | 'fail' | 'block' | 'not-required';
}

interface FixCommitInput extends EvidenceFields {
  readonly commitId: string;
  readonly scope: string;
}

interface PullRequestInput {
  readonly sessionId: string;
  readonly id: string;
  readonly url: string;
}

function illegal(state: TransactionState | null, operation: string): never {
  throw new WorkflowError({
    code: ERROR_CODES.ILLEGAL_TRANSITION,
    message: `${operation} is not legal from the current lifecycle.`,
    details: {
      actual_lifecycle: state?.current?.lifecycle ?? null,
      actual_phase: state?.current?.phase ?? null,
    },
  });
}

function ownership(recorded: string, requested: string): never {
  throw new WorkflowError({
    code: ERROR_CODES.OWNERSHIP_CONFLICT,
    message: 'An ntwork owner is already recorded.',
    details: { recorded_owner: recorded, requested_owner: requested },
  });
}

function requireWorkState(state: TransactionState | null, operation: string) {
  if (
    state?.current === null
    || state?.current === undefined
    || (state.current.lifecycle !== 'plan-approved' && state.current.lifecycle !== 'work-active')
    || state.current.work === null
  ) illegal(state, operation);
  return state as State & { current: NonNullable<State['current']> & { work: NonNullable<NonNullable<State['current']>['work']> } };
}

function requireOwner(state: ReturnType<typeof requireWorkState>, input: StopNtworkInput): void {
  if (state.current.phase !== 'ntwork' || state.current.owner === null) {
    illegal(state, 'phase stop ntwork');
  }
  if (state.current.owner.session_id !== input.sessionId && input.interruption === undefined) {
    ownership(state.current.owner.session_id, input.sessionId);
  }
}

function requireActiveOwner(
  state: ReturnType<typeof requireWorkState>,
  sessionId: string,
  operation: string,
): void {
  if (state.current.phase !== 'ntwork' || state.current.owner === null) {
    illegal(state, operation);
  }
  if (state.current.owner.session_id !== sessionId) {
    ownership(state.current.owner.session_id, sessionId);
  }
}

function requireRoles(available: ReadonlySet<NtworkRole>): void {
  for (const role of NTWORK_ROLES) {
    if (!available.has(role)) {
      throw new WorkflowError({
        code: ERROR_CODES.ARTIFACT_FAILURE,
        message: `The required native ntwork ${role} is unavailable.`,
        details: { role },
      });
    }
  }
}

function requireMatchingTaskOrder(recorded: readonly string[], artifact: readonly string[]): void {
  if (
    recorded.length !== artifact.length
    || recorded.some((taskId, index) => taskId !== artifact[index])
  ) {
    throw new WorkflowError({
      code: ERROR_CODES.ARTIFACT_FAILURE,
      message: 'Approved task artifacts do not match recorded ntwork state.',
      details: { recorded_tasks: recorded, artifact_tasks: artifact },
    });
  }
}

export async function beginNtworkPhase(projectRoot: string, input: BeginNtworkInput) {
  validateSessionId(input.sessionId);
  const snapshot = await readPreflight(projectRoot);
  if (
    snapshot.state?.current?.lifecycle !== 'plan-approved'
    && snapshot.state?.current?.lifecycle !== 'work-active'
  ) illegal(snapshot.state, 'phase begin ntwork');
  if (input.baseBranch !== undefined && input.baseBranch.trim().length === 0) {
    throw new WorkflowError({
      code: ERROR_CODES.INVALID_INPUT,
      message: 'The optional base branch must be non-empty.',
      details: { argument: '--base-branch' },
    });
  }
  requireRoles(input.availableRoles);
  const provider = providerForSessionId(input.sessionId);
  const observed = await readGitContext(projectRoot);
  const recordedHead = snapshot.state?.current?.work?.head_commit;
  const observedParent = recordedHead !== null
    && recordedHead !== undefined
    && recordedHead !== observed.head
    ? await readCommitParent(projectRoot, observed.head)
    : null;

  let runId = '';
  let recordedTasks: string[] = [];
  return runStateTransaction(projectRoot, (rawState) => {
    const state = requireWorkState(rawState, 'phase begin ntwork');
    runId = state.current.run_id;
    recordedTasks = state.current.work.tasks.map(task => task.task_id);
    if (state.current.blocker !== null && input.blockerResolved !== true) {
      throw new WorkflowError({
        code: ERROR_CODES.UNRESOLVED_BLOCKER,
        message: 'The recorded blocker must be explicitly resolved before ntwork begins.',
        details: { blocker: state.current.blocker },
      });
    }
    if (state.current.owner !== null && input.interruption === undefined) {
      ownership(state.current.owner.session_id, input.sessionId);
    }
    if (state.current.work.provider !== null && state.current.work.provider !== provider) {
      throw new WorkflowError({
        code: ERROR_CODES.OWNERSHIP_CONFLICT,
        message: 'An active ntwork task may resume only under the recorded provider.',
        details: { recorded_provider: state.current.work.provider, requested_provider: provider },
      });
    }
    if (
      input.baseBranch !== undefined
      && state.current.work.base_branch !== null
      && state.current.work.base_branch !== input.baseBranch
    ) {
      throw new WorkflowError({
        code: ERROR_CODES.ARTIFACT_FAILURE,
        message: 'The supplied base branch does not match recorded ntwork state.',
        details: {
          recorded_base_branch: state.current.work.base_branch,
          supplied_base_branch: input.baseBranch,
        },
      });
    }
    const active = state.current.work.tasks.find((task) => task.status === 'active');
    if (
      observed.projectDirty
      && active === undefined
      && input.existingChangesConfirmed !== true
    ) {
      throw new WorkflowError({
        code: ERROR_CODES.ARTIFACT_FAILURE,
        message: 'Pre-existing project-file changes require explicit user permission before ntwork begins.',
        details: { branch: observed.branch },
      });
    }
    const commitAheadForActiveTask = active !== undefined
      && state.current.work.head_commit !== null
      && observedParent === state.current.work.head_commit;
    if (state.current.work.branch !== null && (
      state.current.work.branch !== observed.branch
      || (state.current.work.head_commit !== observed.head && !commitAheadForActiveTask)
    )) {
      throw new WorkflowError({
        code: ERROR_CODES.ARTIFACT_FAILURE,
        message: 'The active Git context does not match recorded ntwork state.',
        details: {
          recorded_branch: state.current.work.branch,
          actual_branch: observed.branch,
          recorded_head: state.current.work.head_commit,
          actual_head: observed.head,
        },
      });
    }
    return {
      next_work_number: state.next_work_number,
      current: {
        ...state.current,
        lifecycle: 'work-active' as const,
        phase: 'ntwork' as const,
        owner: { session_id: input.sessionId },
        blocker: null,
        work: {
          ...state.current.work,
          provider,
          branch: state.current.work.branch ?? observed.branch,
          base_branch: state.current.work.base_branch ?? input.baseBranch ?? observed.branch,
          head_commit: state.current.work.head_commit ?? observed.head,
        },
      },
    };
  }, {
    prepareCommit: async () => {
      await validateBrief(projectRoot, runId, 'ntgrill');
      requireMatchingTaskOrder(recordedTasks, await validatePlanArtifacts(projectRoot, runId));
      const current = await readGitContext(projectRoot);
      if (
        current.branch !== observed.branch
        || current.head !== observed.head
        || current.projectDirty !== observed.projectDirty
      ) {
        throw new WorkflowError({
          code: ERROR_CODES.ARTIFACT_FAILURE,
          message: 'The Git context changed during ntwork preflight.',
          details: { branch: current.branch, head: current.head },
        });
      }
    },
  });
}

export async function stopNtworkPhase(projectRoot: string, input: StopNtworkInput) {
  validateSessionId(input.sessionId);
  if (input.blocker.trim().length === 0) {
    throw new WorkflowError({
      code: ERROR_CODES.INVALID_INPUT,
      message: 'A controlled phase stop requires a non-empty blocker.',
      details: { argument: '--blocker' },
    });
  }
  return runStateTransaction(projectRoot, (rawState) => {
    const state = requireWorkState(rawState, 'phase stop ntwork');
    requireOwner(state, input);
    return {
      next_work_number: state.next_work_number,
      current: {
        ...state.current,
        phase: null,
        owner: null,
        blocker: input.blocker,
      },
    };
  });
}

export async function beginWorkTask(projectRoot: string, input: BeginWorkTaskInput) {
  validateSessionId(input.sessionId);
  const observed = await readGitContext(projectRoot);
  if (observed.projectDirty && input.existingChangesConfirmed !== true) {
    throw new WorkflowError({
      code: ERROR_CODES.ARTIFACT_FAILURE,
      message: 'A new ntwork task requires a clean project worktree.',
      details: { branch: observed.branch },
    });
  }
  let runId = '';
  let recordedTasks: string[] = [];
  return runStateTransaction(projectRoot, (rawState) => {
    const state = requireWorkState(rawState, 'task begin');
    requireActiveOwner(state, input.sessionId, 'task begin');
    runId = state.current.run_id;
    recordedTasks = state.current.work.tasks.map(task => task.task_id);
    const active = state.current.work.tasks.find((task) => task.status === 'active');
    const next = state.current.work.tasks.find((task) => task.status !== 'completed');
    if (state.current.work.verdicts.ci === 'fail') {
      throw new WorkflowError({
        code: ERROR_CODES.ILLEGAL_TRANSITION,
        message: 'Known failing required CI must be resolved before the next task begins.',
        details: { next_task: next?.task_id ?? null },
      });
    }
    if (active !== undefined || next === undefined || next.task_id !== input.taskId) {
      throw new WorkflowError({
        code: ERROR_CODES.ILLEGAL_TRANSITION,
        message: 'task begin requires the exact next pending task in approved stable order.',
        details: {
          requested_task: input.taskId,
          next_task: next?.task_id ?? null,
          active_task: active?.task_id ?? null,
        },
      });
    }
    if (
      state.current.work.branch !== observed.branch
      || state.current.work.head_commit !== observed.head
    ) {
      throw new WorkflowError({
        code: ERROR_CODES.ARTIFACT_FAILURE,
        message: 'The current Git branch or HEAD does not match recorded ntwork state.',
        details: { actual_branch: observed.branch, actual_head: observed.head },
      });
    }
    return {
      next_work_number: state.next_work_number,
      current: {
        ...state.current,
        work: {
          ...state.current.work,
          tasks: state.current.work.tasks.map((task) => task.task_id === input.taskId
            ? { ...task, status: 'active' as const, start_commit: observed.head }
            : task),
        },
      },
    };
  }, {
    prepareCommit: async () => {
      requireMatchingTaskOrder(recordedTasks, await validatePlanArtifacts(projectRoot, runId));
      const current = await readGitContext(projectRoot);
      if (
        current.branch !== observed.branch
        || current.head !== observed.head
        || current.projectDirty !== observed.projectDirty
      ) {
        throw new WorkflowError({
          code: ERROR_CODES.ARTIFACT_FAILURE,
          message: 'The Git context changed during task begin.',
          details: { branch: current.branch, head: current.head },
        });
      }
    },
  });
}

function requireText(value: string, field: string): void {
  if (value.trim().length === 0) {
    throw new WorkflowError({
      code: ERROR_CODES.INVALID_INPUT,
      message: `work record requires a non-empty ${field}.`,
      details: { argument: field },
    });
  }
}

function validateSourceIds(sourceIds: readonly string[]): string[] {
  if (sourceIds.length === 0 || sourceIds.some((id) => id.length === 0)) {
    throw new WorkflowError({
      code: ERROR_CODES.INVALID_INPUT,
      message: 'work record requires at least one native source ID.',
      details: { argument: '--source-id' },
    });
  }
  return [...new Set(sourceIds)];
}

export async function recordTaskEvidence(projectRoot: string, input: EvidenceInput) {
  validateSessionId(input.sessionId);
  for (const [field, value] of [
    ['gate', input.gate], ['procedure', input.procedure], ['result', input.result],
    ['expected', input.expected],
  ] as const) requireText(value, field);
  const sourceIds = validateSourceIds(input.sourceIds);
  const observed = await readGitContext(projectRoot);
  return runStateTransaction(projectRoot, (rawState) => {
    const state = requireWorkState(rawState, 'work record evidence');
    requireActiveOwner(state, input.sessionId, 'work record evidence');
    const active = state.current.work.tasks.find((task) => task.status === 'active');
    const fixScope = input.gate.startsWith('fix:') ? input.gate.slice(4) : '';
    const isTaskEvidence = active !== undefined && input.gate === `task:${active.task_id}`;
    const isFixEvidence = active === undefined
      && fixScope.length > 0
      && (fixScope === 'integration'
        ? state.current.work.tasks.some(task => task.status === 'completed')
        : state.current.work.tasks.some((task) => (
        task.task_id === fixScope && task.status === 'completed'
        )));
    if (!isTaskEvidence && !isFixEvidence) {
      throw new WorkflowError({
        code: ERROR_CODES.ILLEGAL_TRANSITION,
        message: 'Task evidence must name the current active task gate.',
        details: { gate: input.gate, active_task: active?.task_id ?? null },
      });
    }
    if (state.current.work.branch !== observed.branch || state.current.work.head_commit !== observed.head) {
      throw new WorkflowError({
        code: ERROR_CODES.ARTIFACT_FAILURE,
        message: 'Task evidence does not match the recorded Git context.',
        details: { branch: observed.branch, head: observed.head },
      });
    }
    const evidence = {
      gate: input.gate,
      procedure: input.procedure,
      revision: `worktree@${observed.head}`,
      result: input.result,
      expected: input.expected,
      source_ids: sourceIds,
    };
    const reviewGate = isTaskEvidence
      ? `task-review:${active.task_id}`
      : `fix-review:${fixScope}`;
    return {
      next_work_number: state.next_work_number,
      current: {
        ...state.current,
        work: {
          ...state.current.work,
          tasks: state.current.work.tasks.map(task => isTaskEvidence && task.task_id === active.task_id
            ? { ...task, packet_review: 'pending' as const, quality_review: 'pending' as const }
            : task),
          evidence: [
            ...state.current.work.evidence.filter((item) => (
              item.gate !== input.gate && item.gate !== reviewGate
            )),
            evidence,
          ],
        },
      },
    };
  });
}

export async function recordTaskReview(projectRoot: string, input: TaskReviewInput) {
  validateSessionId(input.sessionId);
  const sourceIds = validateSourceIds(input.sourceIds);
  const observed = await readGitContext(projectRoot);
  return runStateTransaction(projectRoot, (rawState) => {
    const state = requireWorkState(rawState, 'work record task-review');
    requireActiveOwner(state, input.sessionId, 'work record task-review');
    const active = state.current.work.tasks.find((task) => task.status === 'active');
    const isTaskReview = active?.task_id === input.taskId;
    const isFixReview = active === undefined
      && (input.taskId === 'integration'
        ? state.current.work.tasks.some(task => task.status === 'completed')
        : state.current.work.tasks.some((task) => (
        task.task_id === input.taskId && task.status === 'completed'
        )));
    if (!isTaskReview && !isFixReview) {
      throw new WorkflowError({
        code: ERROR_CODES.ILLEGAL_TRANSITION,
        message: 'Task review must name the current active task.',
        details: { requested_task: input.taskId, active_task: active?.task_id ?? null },
      });
    }
    if (state.current.work.branch !== observed.branch || state.current.work.head_commit !== observed.head) {
      throw new WorkflowError({
        code: ERROR_CODES.ARTIFACT_FAILURE,
        message: 'Task review does not match the recorded Git context.',
        details: { branch: observed.branch, head: observed.head },
      });
    }
    const gate = isTaskReview ? `task-review:${input.taskId}` : `fix-review:${input.taskId}`;
    const evidenceGate = isTaskReview ? `task:${input.taskId}` : `fix:${input.taskId}`;
    if (!state.current.work.evidence.some(item => (
      item.gate === evidenceGate
      && item.revision === `worktree@${observed.head}`
    ))) {
      throw new WorkflowError({
        code: ERROR_CODES.ARTIFACT_FAILURE,
        message: 'Task review requires current passing canonical evidence first.',
        details: { gate: evidenceGate },
      });
    }
    return {
      next_work_number: state.next_work_number,
      current: {
        ...state.current,
        work: {
          ...state.current.work,
          tasks: state.current.work.tasks.map((task) => isTaskReview && task.task_id === input.taskId
            ? { ...task, packet_review: input.packet, quality_review: input.quality }
            : task),
          evidence: [
            ...state.current.work.evidence.filter((item) => item.gate !== gate),
            {
              gate,
              procedure: 'Independent native task review.',
              revision: `worktree@${observed.head}`,
              result: `packet=${input.packet}; quality=${input.quality}`,
              expected: 'packet=pass; quality=pass',
              source_ids: sourceIds,
            },
          ],
        },
      },
    };
  });
}

export async function completeWorkTask(projectRoot: string, input: CompleteWorkTaskInput) {
  validateSessionId(input.sessionId);
  requireText(input.commitId, 'commit-id');
  const observed = await readGitContext(projectRoot);
  if (observed.projectDirty || observed.head !== input.commitId) {
    throw new WorkflowError({
      code: ERROR_CODES.ARTIFACT_FAILURE,
      message: 'task complete requires the supplied current commit and a clean project worktree.',
      details: { supplied_commit: input.commitId, actual_head: observed.head },
    });
  }
  const parent = await readCommitParent(projectRoot, input.commitId);
  let runId = '';
  let recordedTasks: string[] = [];
  return runStateTransaction(projectRoot, (rawState) => {
    const state = requireWorkState(rawState, 'task complete');
    requireActiveOwner(state, input.sessionId, 'task complete');
    runId = state.current.run_id;
    recordedTasks = state.current.work.tasks.map(task => task.task_id);
    const active = state.current.work.tasks.find((task) => task.status === 'active');
    if (active?.task_id !== input.taskId) {
      throw new WorkflowError({
        code: ERROR_CODES.ILLEGAL_TRANSITION,
        message: 'task complete must name the current active task.',
        details: { requested_task: input.taskId, active_task: active?.task_id ?? null },
      });
    }
    if (
      active.start_commit === null
      || parent !== active.start_commit
      || active.packet_review !== 'pass'
      || active.quality_review !== 'pass'
    ) {
      throw new WorkflowError({
        code: ERROR_CODES.ARTIFACT_FAILURE,
        message: 'Task completion requires one dedicated commit and both task-review verdicts PASS.',
        details: { task_id: input.taskId, start_commit: active.start_commit, commit_parent: parent },
      });
    }
    const requiredGates = [`task:${input.taskId}`, `task-review:${input.taskId}`];
    if (!requiredGates.every((gate) => state.current.work.evidence.some((item) => (
      item.gate === gate
      && item.revision === `worktree@${parent}`
    )))) {
      throw new WorkflowError({
        code: ERROR_CODES.ARTIFACT_FAILURE,
        message: 'Task completion requires fresh canonical verification and task-review evidence.',
        details: { task_id: input.taskId },
      });
    }
    return {
      next_work_number: state.next_work_number,
      current: {
        ...state.current,
        work: {
          ...state.current.work,
          head_commit: input.commitId,
          tasks: state.current.work.tasks.map((task) => task.task_id === input.taskId
            ? { ...task, status: 'completed' as const, commit_id: input.commitId }
            : task),
          evidence: state.current.work.evidence.map((item) => requiredGates.includes(item.gate)
            ? { ...item, revision: input.commitId }
            : item),
        },
      },
    };
  }, {
    prepareCommit: async () => {
      requireMatchingTaskOrder(recordedTasks, await validatePlanArtifacts(projectRoot, runId));
      const current = await readGitContext(projectRoot);
      if (
        current.branch !== observed.branch
        || current.head !== observed.head
        || current.projectDirty
      ) {
        throw new WorkflowError({
          code: ERROR_CODES.ARTIFACT_FAILURE,
          message: 'The Git context changed during task completion.',
          details: { branch: current.branch, head: current.head },
        });
      }
    },
  });
}

const FINAL_GATES = ['whole-plan', 'nyquist', 'spec-integration', 'code-review', 'ci'] as const;

function verdictKey(gate: FinalGateInput['gate']) {
  return gate === 'whole-plan' ? 'whole_plan'
    : gate === 'spec-integration' ? 'spec_integration'
      : gate === 'code-review' ? 'code_review'
      : gate;
}

function validateGateVerdict(input: FinalGateInput): void {
  const valid = input.gate === 'whole-plan'
    ? input.verdict === 'pass' || input.verdict === 'fail'
    : input.gate === 'ci'
      ? input.verdict === 'pass' || input.verdict === 'fail' || input.verdict === 'not-required'
      : input.verdict === 'pass' || input.verdict === 'block';
  if (!valid) {
    throw new WorkflowError({
      code: ERROR_CODES.INVALID_INPUT,
      message: `Verdict ${input.verdict} is invalid for ${input.gate}.`,
      details: { gate: input.gate, verdict: input.verdict },
    });
  }
}

export async function recordFinalGate(projectRoot: string, input: FinalGateInput) {
  validateSessionId(input.sessionId);
  validateGateVerdict(input);
  for (const [field, value] of [
    ['procedure', input.procedure], ['result', input.result], ['expected', input.expected],
  ] as const) requireText(value, field);
  const sourceIds = validateSourceIds(input.sourceIds);
  const observed = await readGitContext(projectRoot);
  if (observed.projectDirty) {
    throw new WorkflowError({
      code: ERROR_CODES.ARTIFACT_FAILURE,
      message: 'Final gate evidence requires a clean project worktree.',
      details: { gate: input.gate },
    });
  }
  return runStateTransaction(projectRoot, (rawState) => {
    const state = requireWorkState(rawState, `work record ${input.gate}`);
    requireActiveOwner(state, input.sessionId, `work record ${input.gate}`);
    const allTasksCompleted = state.current.work.tasks.every((task) => task.status === 'completed');
    const workStarted = state.current.work.tasks.some((task) => task.status !== 'pending');
    if (input.gate === 'ci' && !workStarted) {
      throw new WorkflowError({
        code: ERROR_CODES.ILLEGAL_TRANSITION,
        message: 'CI evidence requires an active or completed task boundary.',
        details: { gate: input.gate },
      });
    }
    if (input.gate !== 'ci' && !allTasksCompleted) {
      throw new WorkflowError({
        code: ERROR_CODES.ILLEGAL_TRANSITION,
        message: 'Final gates require every approved task to be completed.',
        details: { gate: input.gate },
      });
    }
    if (state.current.work.branch !== observed.branch || state.current.work.head_commit !== observed.head) {
      throw new WorkflowError({
        code: ERROR_CODES.ARTIFACT_FAILURE,
        message: 'Final gate evidence does not match recorded Git state.',
        details: { gate: input.gate, branch: observed.branch, head: observed.head },
      });
    }
    if (
      input.gate !== 'whole-plan'
      && input.gate !== 'ci'
      && state.current.work.verdicts.whole_plan !== 'pass'
    ) {
      throw new WorkflowError({
        code: ERROR_CODES.ILLEGAL_TRANSITION,
        message: 'Independent final reviews require whole-plan validation PASS.',
        details: { gate: input.gate },
      });
    }
    if (input.gate === 'ci' && allTasksCompleted && !(
      state.current.work.verdicts.nyquist === 'pass'
      && state.current.work.verdicts.spec_integration === 'pass'
      && state.current.work.verdicts.code_review === 'pass'
    )) {
      throw new WorkflowError({
        code: ERROR_CODES.ILLEGAL_TRANSITION,
        message: 'The CI decision follows all three independent final review passes.',
        details: { gate: input.gate },
      });
    }

    const key = verdictKey(input.gate);
    const previous = state.current.work.verdicts[key];
    const previousEvidence = state.current.work.evidence.find(item => item.gate === input.gate);
    if (
      (previous === 'fail' || previous === 'block')
      && (input.verdict === 'pass' || input.verdict === 'not-required')
      && previousEvidence?.revision === observed.head
    ) {
      throw new WorkflowError({
        code: ERROR_CODES.ARTIFACT_FAILURE,
        message: 'A failing gate cannot become passing on the same revision without a recorded fix commit.',
        details: { gate: input.gate, revision: observed.head },
      });
    }
    const resetAfterWholePlan = input.gate === 'whole-plan';
    const verdicts = {
      ...state.current.work.verdicts,
      ...(resetAfterWholePlan ? {
        nyquist: 'pending' as const,
        spec_integration: 'pending' as const,
        code_review: 'pending' as const,
        ci: 'pending' as const,
      } : {}),
      [key]: input.verdict,
    };
    const invalidatedGates: readonly string[] = resetAfterWholePlan ? FINAL_GATES : [input.gate];
    return {
      next_work_number: state.next_work_number,
      current: {
        ...state.current,
        work: {
          ...state.current.work,
          verdicts,
          evidence: [
            ...state.current.work.evidence.filter((item) => !invalidatedGates.includes(item.gate)),
            {
              gate: input.gate,
              procedure: input.procedure,
              revision: observed.head,
              result: input.result,
              expected: input.expected,
              source_ids: sourceIds,
            },
          ],
        },
      },
    };
  });
}

export async function completeNtworkPhase(
  projectRoot: string,
  input: { readonly sessionId: string },
) {
  validateSessionId(input.sessionId);
  const observed = await readGitContext(projectRoot);
  if (observed.projectDirty) {
    throw new WorkflowError({
      code: ERROR_CODES.ARTIFACT_FAILURE,
      message: 'ntwork completion requires a clean project worktree.',
      details: { branch: observed.branch },
    });
  }
  let runId = '';
  let recordedTasks: string[] = [];
  return runStateTransaction(projectRoot, (rawState) => {
    const state = requireWorkState(rawState, 'phase complete ntwork');
    requireActiveOwner(state, input.sessionId, 'phase complete ntwork');
    runId = state.current.run_id;
    recordedTasks = state.current.work.tasks.map(task => task.task_id);
    const work = state.current.work;
    const gatesPass = work.tasks.every((task) => task.status === 'completed')
      && work.verdicts.whole_plan === 'pass'
      && work.verdicts.nyquist === 'pass'
      && work.verdicts.spec_integration === 'pass'
      && work.verdicts.code_review === 'pass'
      && (work.verdicts.ci === 'pass' || work.verdicts.ci === 'not-required')
      && FINAL_GATES.every((gate) => work.evidence.some((item) => (
        item.gate === gate && item.revision === observed.head
      )));
    if (!gatesPass) {
      throw new WorkflowError({
        code: ERROR_CODES.ARTIFACT_FAILURE,
        message: 'ntwork completion requires every task and current-revision final gate to pass.',
        details: { revision: observed.head },
      });
    }
    if (work.branch !== observed.branch || work.head_commit !== observed.head) {
      throw new WorkflowError({
        code: ERROR_CODES.ARTIFACT_FAILURE,
        message: 'The final Git context does not match recorded ntwork state.',
        details: { branch: observed.branch, head: observed.head },
      });
    }
    return {
      next_work_number: state.next_work_number,
      current: {
        ...state.current,
        lifecycle: 'delivery-ready' as const,
        phase: 'delivery-ready' as const,
        owner: null,
        blocker: null,
      },
    };
  }, {
    prepareCommit: async () => {
      await validateBrief(projectRoot, runId, 'ntgrill');
      requireMatchingTaskOrder(recordedTasks, await validatePlanArtifacts(projectRoot, runId));
      const current = await readGitContext(projectRoot);
      if (
        current.branch !== observed.branch
        || current.head !== observed.head
        || current.projectDirty
      ) {
        throw new WorkflowError({
          code: ERROR_CODES.ARTIFACT_FAILURE,
          message: 'The Git context changed during ntwork completion.',
          details: { branch: current.branch, head: current.head },
        });
      }
    },
  });
}

export async function recordFixCommit(projectRoot: string, input: FixCommitInput) {
  validateSessionId(input.sessionId);
  requireText(input.commitId, 'commit-id');
  requireText(input.scope, 'scope');
  for (const [field, value] of [
    ['procedure', input.procedure], ['result', input.result], ['expected', input.expected],
  ] as const) requireText(value, field);
  const sourceIds = validateSourceIds(input.sourceIds);
  const observed = await readGitContext(projectRoot);
  if (observed.projectDirty || observed.head !== input.commitId) {
    throw new WorkflowError({
      code: ERROR_CODES.ARTIFACT_FAILURE,
      message: 'A fix record requires the supplied current commit and a clean project worktree.',
      details: { supplied_commit: input.commitId, actual_head: observed.head },
    });
  }
  const parent = await readCommitParent(projectRoot, input.commitId);
  return runStateTransaction(projectRoot, (rawState) => {
    const state = requireWorkState(rawState, 'work record fix-commit');
    requireActiveOwner(state, input.sessionId, 'work record fix-commit');
    if (state.current.work.tasks.some((task) => task.status === 'active')) {
      throw new WorkflowError({
        code: ERROR_CODES.ILLEGAL_TRANSITION,
        message: 'Fix work cannot be recorded in parallel with an active task.',
        details: null,
      });
    }
    if (
      state.current.work.branch !== observed.branch
      || state.current.work.head_commit === null
      || parent !== state.current.work.head_commit
    ) {
      throw new WorkflowError({
        code: ERROR_CODES.ARTIFACT_FAILURE,
        message: 'A fix commit must be one direct commit after the recorded ntwork HEAD.',
        details: { recorded_head: state.current.work.head_commit, commit_parent: parent },
      });
    }
    const requiredGates = [`fix:${input.scope}`, `fix-review:${input.scope}`];
    if (!requiredGates.every((gate) => state.current.work.evidence.some((item) => (
      item.gate === gate
      && item.revision === `worktree@${parent}`
      && (gate.startsWith('fix-review:')
        ? item.result === 'packet=pass; quality=pass'
        : true)
    )))) {
      throw new WorkflowError({
        code: ERROR_CODES.ARTIFACT_FAILURE,
        message: 'A fix commit requires fresh passing verification and independent review of the same tree.',
        details: { scope: input.scope },
      });
    }
    return {
      next_work_number: state.next_work_number,
      current: {
        ...state.current,
        work: {
          ...state.current.work,
          head_commit: input.commitId,
          fix_commits: [...state.current.work.fix_commits, input.commitId],
          evidence: [
            ...state.current.work.evidence
              .filter((item) => !FINAL_GATES.includes(item.gate as typeof FINAL_GATES[number]))
              .map((item) => requiredGates.includes(item.gate) ? { ...item, revision: input.commitId } : item),
            {
              gate: `fix-commit:${input.commitId}`,
              procedure: input.procedure,
              revision: input.commitId,
              result: input.result,
              expected: input.expected,
              source_ids: sourceIds,
            },
          ],
          verdicts: {
            whole_plan: 'pending',
            nyquist: 'pending',
            spec_integration: 'pending',
            code_review: 'pending',
            ci: 'pending',
          },
        },
      },
    };
  });
}

export async function recordPullRequest(projectRoot: string, input: PullRequestInput) {
  validateSessionId(input.sessionId);
  requireText(input.id, 'id');
  requireText(input.url, 'url');
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(input.url);
  } catch {
    throw new WorkflowError({
      code: ERROR_CODES.INVALID_INPUT,
      message: 'The pull-request URL must be an absolute HTTP(S) URL.',
      details: { argument: '--url' },
    });
  }
  if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
    throw new WorkflowError({
      code: ERROR_CODES.INVALID_INPUT,
      message: 'The pull-request URL must be an absolute HTTP(S) URL.',
      details: { argument: '--url' },
    });
  }
  const observed = await readGitContext(projectRoot);
  return runStateTransaction(projectRoot, (rawState) => {
    const state = requireWorkState(rawState, 'work record pull-request');
    requireActiveOwner(state, input.sessionId, 'work record pull-request');
    if (
      state.current.work.branch !== observed.branch
      || state.current.work.head_commit !== observed.head
      || observed.projectDirty
    ) {
      throw new WorkflowError({
        code: ERROR_CODES.ARTIFACT_FAILURE,
        message: 'Pull-request identity requires the clean recorded Git revision.',
        details: { branch: observed.branch, head: observed.head },
      });
    }
    const recorded = state.current.work.pull_request;
    if (recorded !== null && (recorded.id !== input.id || recorded.url !== input.url)) {
      throw new WorkflowError({
        code: ERROR_CODES.ARTIFACT_FAILURE,
        message: 'The pull-request identity does not match recorded ntwork state.',
        details: { recorded_id: recorded.id, supplied_id: input.id },
      });
    }
    return {
      next_work_number: state.next_work_number,
      current: {
        ...state.current,
        work: {
          ...state.current.work,
          pull_request: recorded ?? { id: input.id, url: input.url },
        },
      },
    };
  });
}
