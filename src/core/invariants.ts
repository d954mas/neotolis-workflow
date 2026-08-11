import { ERROR_CODES, WorkflowError } from './errors.ts';
import type {
  Current,
  Lifecycle,
  Phase,
  Provider,
  State,
  Task,
  Verdicts,
  Work,
} from './state.ts';

const RUN_ID_PATTERN = /^NT-(\d{3,})$/u;
const TASK_ID_PATTERN = /^NT-(\d{3,})-(\d{2,})$/u;
const SESSION_ID_PATTERN = /^(claude|codex):([^\s:]+)$/u;

const LEGAL_PHASES: Readonly<Record<Lifecycle, Phase | null>> = Object.freeze({
  'intake-active': 'nttask',
  'brief-ready': 'ntgrill',
  'plan-ready': 'ntplan',
  'plan-approved': 'ntwork',
  'work-active': 'ntwork',
  'delivery-ready': 'delivery-ready',
});

export function workflowStateError(path: string, rule: string): never {
  throw new WorkflowError({
    code: ERROR_CODES.INVALID_STATE,
    message: 'Workflow state is invalid.',
    details: { path, rule },
  });
}

function requireNonEmpty(value: string, path: string): void {
  if (value.length === 0) workflowStateError(path, 'non-empty string');
}

export function providerForSessionId(sessionId: string): Provider | null {
  const match = SESSION_ID_PATTERN.exec(sessionId);
  return match === null ? null : match[1] as Provider;
}

function sessionProvider(sessionId: string, path: string): Provider {
  const provider = providerForSessionId(sessionId);
  if (provider === null) {
    workflowStateError(path, 'canonical claude:<native-id> or codex:<native-id> session ID');
  }
  return provider;
}

function validateRunIdentity(state: State, current: Current): void {
  const match = RUN_ID_PATTERN.exec(current.run_id);
  if (match === null || Number(match[1]) < 1) {
    workflowStateError('$.current.run_id', 'canonical NT-xxx run ID with a positive number');
  }
  if (state.next_work_number !== Number(match[1]) + 1) {
    workflowStateError(
      '$.next_work_number',
      'exactly one greater than the active run number',
    );
  }
}

function validatePhaseAndOwner(current: Current): void {
  const legalPhase = LEGAL_PHASES[current.lifecycle];
  if (current.lifecycle === 'delivery-ready') {
    if (current.phase !== 'delivery-ready') {
      workflowStateError(
        '$.current.phase',
        'delivery-ready lifecycle requires delivery-ready phase',
      );
    }
    if (current.owner !== null) {
      workflowStateError('$.current.owner', 'delivery-ready phase has no owner');
    }
  } else {
    if (current.phase !== null && current.phase !== legalPhase) {
      workflowStateError(
        '$.current.phase',
        `phase is not legal for lifecycle ${current.lifecycle}`,
      );
    }
    if ((current.phase === null) !== (current.owner === null)) {
      workflowStateError(
        current.phase === null ? '$.current.owner' : '$.current.phase',
        'state-changing phase and owner must both be set or both be null',
      );
    }
  }

  if (current.owner !== null) {
    sessionProvider(current.owner.session_id, '$.current.owner.session_id');
  }
  if (current.blocker !== null) {
    requireNonEmpty(current.blocker, '$.current.blocker');
    if (current.phase !== null || current.owner !== null) {
      workflowStateError(
        '$.current.blocker',
        'a blocked current run cannot have an active phase owner',
      );
    }
  }
}

function validateTaskIdentity(task: Task, index: number, runId: string): void {
  const path = `$.current.work.tasks[${index}].task_id`;
  const match = TASK_ID_PATTERN.exec(task.task_id);
  if (match === null || Number(match[1]) < 1 || Number(match[2]) < 1) {
    workflowStateError(path, 'canonical NT-xxx-yy task ID with positive numbers');
  }
  if (`NT-${match[1]}` !== runId) {
    workflowStateError(path, 'task ID must use the active run ID');
  }
}

function validateTaskState(task: Task, index: number): void {
  const path = `$.current.work.tasks[${index}]`;
  if (task.start_commit !== null) requireNonEmpty(task.start_commit, `${path}.start_commit`);
  if (task.commit_id !== null) requireNonEmpty(task.commit_id, `${path}.commit_id`);

  if (task.status === 'pending') {
    if (
      task.start_commit !== null
      || task.commit_id !== null
      || task.packet_review !== 'pending'
      || task.quality_review !== 'pending'
    ) {
      workflowStateError(path, 'pending task has no commits and pending reviews');
    }
    return;
  }

  if (task.start_commit === null) {
    workflowStateError(`${path}.start_commit`, `${task.status} task requires a start commit`);
  }
  if (task.commit_id !== null && (
    task.packet_review !== 'pass' || task.quality_review !== 'pass'
  )) {
    workflowStateError(
      `${path}.commit_id`,
      'task commit requires both task reviews to pass',
    );
  }
  if (task.status === 'completed' && (
    task.commit_id === null
    || task.packet_review !== 'pass'
    || task.quality_review !== 'pass'
  )) {
    workflowStateError(
      path,
      'completed task requires a commit and both task reviews to pass',
    );
  }
}

function validateTasks(work: Work, runId: string): void {
  if (work.tasks.length === 0) {
    workflowStateError('$.current.work.tasks', 'at least one task');
  }

  const taskIds = new Set<string>();
  let position: 'completed' | 'active' | 'pending' = 'completed';
  for (const [index, task] of work.tasks.entries()) {
    validateTaskIdentity(task, index, runId);
    if (taskIds.has(task.task_id)) {
      workflowStateError(`$.current.work.tasks[${index}].task_id`, 'unique task ID');
    }
    taskIds.add(task.task_id);
    validateTaskState(task, index);

    if (task.status === 'completed') {
      if (position !== 'completed') {
        workflowStateError(
          `$.current.work.tasks[${index}].status`,
          'completed tasks form the first contiguous task prefix',
        );
      }
    } else if (task.status === 'active') {
      if (position !== 'completed') {
        workflowStateError(
          `$.current.work.tasks[${index}].status`,
          'at most one active task follows completed tasks',
        );
      }
      position = 'active';
    } else {
      position = 'pending';
    }
  }
}

function allTasksCompleted(work: Work): boolean {
  return work.tasks.every((task) => task.status === 'completed');
}

function allVerdictsPending(verdicts: Verdicts): boolean {
  return Object.values(verdicts).every((verdict) => verdict === 'pending');
}

function validateVerdictSequence(work: Work): void {
  const { verdicts } = work;
  if (verdicts.whole_plan !== 'pending' && !allTasksCompleted(work)) {
    workflowStateError(
      '$.current.work.verdicts.whole_plan',
      'whole-plan validation requires every task to be completed',
    );
  }
  if (verdicts.nyquist !== 'pending' && verdicts.whole_plan !== 'pass') {
    workflowStateError(
      '$.current.work.verdicts.nyquist',
      'Nyquist verdict requires whole-plan validation to pass',
    );
  }
  if (
    (verdicts.spec_integration !== 'pending' || verdicts.code_review !== 'pending')
    && verdicts.nyquist !== 'pass'
  ) {
    workflowStateError(
      '$.current.work.verdicts',
      'final reviews require Nyquist to pass',
    );
  }
}

function validateWorkIdentity(current: Current, work: Work): void {
  if ((work.branch === null) !== (work.base_branch === null)) {
    workflowStateError(
      '$.current.work.base_branch',
      'branch and base_branch must both be set or both be null',
    );
  }
  if (work.branch !== null) requireNonEmpty(work.branch, '$.current.work.branch');
  if (work.base_branch !== null) requireNonEmpty(work.base_branch, '$.current.work.base_branch');
  if (work.head_commit !== null) requireNonEmpty(work.head_commit, '$.current.work.head_commit');
  if (work.pull_request !== null) {
    requireNonEmpty(work.pull_request.id, '$.current.work.pull_request.id');
    requireNonEmpty(work.pull_request.url, '$.current.work.pull_request.url');
    if (work.branch === null || work.head_commit === null) {
      workflowStateError(
        '$.current.work.pull_request',
        'pull request requires an assigned branch and head commit',
      );
    }
  }
  for (const [index, fixCommit] of work.fix_commits.entries()) {
    requireNonEmpty(fixCommit, `$.current.work.fix_commits[${index}]`);
  }
  if (work.fix_commits.length > 0 && work.head_commit === null) {
    workflowStateError('$.current.work.fix_commits', 'fix commits require a head commit');
  }

  const hasTaskCommit = work.tasks.some((task) => task.commit_id !== null);
  if (hasTaskCommit && (work.branch === null || work.head_commit === null)) {
    workflowStateError(
      '$.current.work.head_commit',
      'recorded task commits require an assigned branch and head commit',
    );
  }
  const hasStartedTask = work.tasks.some((task) => task.status !== 'pending');
  if (hasStartedTask && work.branch === null) {
    workflowStateError(
      '$.current.work.branch',
      'started work requires an assigned branch and base branch',
    );
  }

  if (work.provider !== null && current.owner !== null) {
    const ownerProvider = sessionProvider(
      current.owner.session_id,
      '$.current.owner.session_id',
    );
    if (ownerProvider !== work.provider) {
      workflowStateError(
        '$.current.work.provider',
        'work provider must match the active ntwork owner provider',
      );
    }
  }
}

function validateEvidence(work: Work): void {
  for (const [index, evidence] of work.evidence.entries()) {
    const path = `$.current.work.evidence[${index}]`;
    requireNonEmpty(evidence.gate, `${path}.gate`);
    requireNonEmpty(evidence.procedure, `${path}.procedure`);
    requireNonEmpty(evidence.revision, `${path}.revision`);
    requireNonEmpty(evidence.result, `${path}.result`);
    requireNonEmpty(evidence.expected, `${path}.expected`);
    if (evidence.source_ids.length === 0) {
      workflowStateError(`${path}.source_ids`, 'at least one native source ID');
    }
    for (const [sourceIndex, sourceId] of evidence.source_ids.entries()) {
      requireNonEmpty(
        sourceId,
        `${path}.source_ids[${sourceIndex}]`,
      );
    }
  }
}

function validatePlanApproved(work: Work): void {
  if (
    work.provider !== null
    || work.branch !== null
    || work.base_branch !== null
    || work.pull_request !== null
    || work.head_commit !== null
    || work.fix_commits.length !== 0
    || work.evidence.length !== 0
    || work.tasks.some((task) => task.status !== 'pending')
    || !allVerdictsPending(work.verdicts)
  ) {
    workflowStateError(
      '$.current.work',
      'plan-approved work is initialized with pending tasks and no execution data',
    );
  }
}

function validateDeliveryReady(current: Current, work: Work): void {
  if (
    current.blocker !== null
    || work.provider === null
    || work.branch === null
    || work.base_branch === null
    || work.pull_request === null
    || work.head_commit === null
    || !allTasksCompleted(work)
    || work.evidence.length === 0
    || work.verdicts.whole_plan !== 'pass'
    || work.verdicts.nyquist !== 'pass'
    || work.verdicts.spec_integration !== 'pass'
    || work.verdicts.code_review !== 'pass'
    || work.verdicts.ci !== 'pass'
  ) {
    workflowStateError(
      '$.current.work',
      'delivery-ready requires completed tasks, delivery identity, evidence, and all gates passing',
    );
  }
}

function validateWork(current: Current, work: Work): void {
  validateTasks(work, current.run_id);
  validateWorkIdentity(current, work);
  validateEvidence(work);
  validateVerdictSequence(work);

  if (current.lifecycle === 'plan-approved') {
    validatePlanApproved(work);
  } else if (current.lifecycle === 'work-active') {
    if (work.provider === null) {
      workflowStateError('$.current.work.provider', 'work-active requires a provider');
    }
  } else if (current.lifecycle === 'delivery-ready') {
    validateDeliveryReady(current, work);
  }
}

export function validateStateInvariants(state: State): void {
  if (state.current === null) return;

  const { current } = state;
  validateRunIdentity(state, current);
  validatePhaseAndOwner(current);

  const requiresWork = current.lifecycle === 'plan-approved'
    || current.lifecycle === 'work-active'
    || current.lifecycle === 'delivery-ready';
  if (requiresWork !== (current.work !== null)) {
    workflowStateError(
      '$.current.work',
      requiresWork
        ? `work is required for lifecycle ${current.lifecycle}`
        : `work must be null for lifecycle ${current.lifecycle}`,
    );
  }
  if (current.work !== null) validateWork(current, current.work);
}
