import {
  FINAL_REVIEW_KEYS,
  LIFECYCLES,
  PHASES,
  PROVIDERS,
} from './domain.ts';
import type { FinalReviewKey, PHASE_SKILLS } from './domain.ts';
import { validateStateInvariants, workflowStateError } from './invariants.ts';

export {
  FINAL_REVIEW_KEYS,
  LIFECYCLES,
  PHASES,
  PHASE_SKILLS,
  PROVIDERS,
} from './domain.ts';
export type Provider = (typeof PROVIDERS)[number];
export type Lifecycle = (typeof LIFECYCLES)[number];
export type PhaseSkill = (typeof PHASE_SKILLS)[number];
export type Phase = (typeof PHASES)[number];
export type TaskStatus = 'pending' | 'active' | 'completed';
export type ReviewVerdict = 'pending' | 'pass' | 'block';
export type ValidationVerdict = 'pending' | 'pass' | 'fail';
export type CiVerdict = ValidationVerdict | 'not-required';

export interface Owner {
  session_id: string;
}

export interface PullRequest {
  id: string;
  url: string;
}

export interface Evidence {
  gate: string;
  procedure: string;
  revision: string;
  result: string;
  expected: string;
  source_ids: string[];
}

export type Verdicts = {
  whole_plan: ValidationVerdict;
  ci: CiVerdict;
} & Record<FinalReviewKey, ReviewVerdict>;

export interface Task {
  task_id: string;
  status: TaskStatus;
  start_commit: string | null;
  commit_id: string | null;
  packet_review: ReviewVerdict;
  quality_review: ReviewVerdict;
}

export interface Work {
  tasks: Task[];
  provider: Provider | null;
  branch: string | null;
  base_branch: string | null;
  pull_request: PullRequest | null;
  head_commit: string | null;
  fix_commits: string[];
  evidence: Evidence[];
  verdicts: Verdicts;
}

export interface Current {
  run_id: string;
  lifecycle: Lifecycle;
  phase: Phase | null;
  owner: Owner | null;
  blocker: string | null;
  work: Work | null;
}

export interface State {
  next_work_number: number;
  current: Current | null;
}

type RecordValue = Record<string, unknown>;

function field(record: RecordValue, key: string): unknown {
  if (!Object.hasOwn(record, key)) {
    workflowStateError(`$.${key}`, 'required');
  }
  return record[key];
}

function childPath(path: string, key: string): string {
  return path === '$' ? `$.${key}` : `${path}.${key}`;
}

function assertExactObject(
  value: unknown,
  path: string,
  expectedFields: readonly string[],
): asserts value is RecordValue {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    workflowStateError(path, 'object');
  }

  for (const expectedField of expectedFields) {
    if (!Object.hasOwn(value, expectedField)) {
      workflowStateError(childPath(path, expectedField), 'required');
    }
  }
  for (const key of Object.keys(value)) {
    if (!expectedFields.includes(key)) {
      workflowStateError(childPath(path, key), 'unknown field');
    }
  }
}

function assertArray(value: unknown, path: string): asserts value is unknown[] {
  if (!Array.isArray(value)) {
    workflowStateError(path, 'array');
  }
}

function assertString(value: unknown, path: string): asserts value is string {
  if (typeof value !== 'string') {
    workflowStateError(path, 'string');
  }
}

function assertNullableString(value: unknown, path: string): asserts value is string | null {
  if (value !== null) assertString(value, path);
}

function assertEnum<const T extends string>(
  value: unknown,
  path: string,
  values: readonly T[],
): asserts value is T {
  if (typeof value !== 'string' || !values.includes(value as T)) {
    workflowStateError(path, `one of: ${values.join(', ')}`);
  }
}

function parseStringArray(value: unknown, path: string): string[] {
  assertArray(value, path);
  for (let index = 0; index < value.length; index += 1) {
    assertString(value[index], `${path}[${index}]`);
  }
  return value as string[];
}

function parseOwner(value: unknown, path: string): Owner {
  assertExactObject(value, path, ['session_id']);
  const sessionId = field(value, 'session_id');
  assertString(sessionId, `${path}.session_id`);
  return value as unknown as Owner;
}

function parsePullRequest(value: unknown, path: string): PullRequest {
  assertExactObject(value, path, ['id', 'url']);
  assertString(field(value, 'id'), `${path}.id`);
  assertString(field(value, 'url'), `${path}.url`);
  return value as unknown as PullRequest;
}

function parseEvidence(value: unknown, path: string): Evidence {
  assertExactObject(value, path, [
    'gate',
    'procedure',
    'revision',
    'result',
    'expected',
    'source_ids',
  ]);
  assertString(field(value, 'gate'), `${path}.gate`);
  assertString(field(value, 'procedure'), `${path}.procedure`);
  assertString(field(value, 'revision'), `${path}.revision`);
  assertString(field(value, 'result'), `${path}.result`);
  assertString(field(value, 'expected'), `${path}.expected`);
  parseStringArray(field(value, 'source_ids'), `${path}.source_ids`);
  return value as unknown as Evidence;
}

function parseVerdicts(value: unknown, path: string): Verdicts {
  assertExactObject(value, path, ['whole_plan', ...FINAL_REVIEW_KEYS, 'ci']);
  assertEnum(field(value, 'whole_plan'), `${path}.whole_plan`, ['pending', 'pass', 'fail']);
  for (const key of FINAL_REVIEW_KEYS) {
    assertEnum(field(value, key), `${path}.${key}`, ['pending', 'pass', 'block']);
  }
  assertEnum(field(value, 'ci'), `${path}.ci`, ['pending', 'pass', 'fail', 'not-required']);
  return value as unknown as Verdicts;
}

function parseTask(value: unknown, path: string): Task {
  assertExactObject(value, path, [
    'task_id',
    'status',
    'start_commit',
    'commit_id',
    'packet_review',
    'quality_review',
  ]);
  assertString(field(value, 'task_id'), `${path}.task_id`);
  assertEnum(field(value, 'status'), `${path}.status`, ['pending', 'active', 'completed']);
  assertNullableString(field(value, 'start_commit'), `${path}.start_commit`);
  assertNullableString(field(value, 'commit_id'), `${path}.commit_id`);
  assertEnum(field(value, 'packet_review'), `${path}.packet_review`, ['pending', 'pass', 'block']);
  assertEnum(field(value, 'quality_review'), `${path}.quality_review`, ['pending', 'pass', 'block']);
  return value as unknown as Task;
}

function parseWork(value: unknown, path: string): Work {
  assertExactObject(value, path, [
    'tasks',
    'provider',
    'branch',
    'base_branch',
    'pull_request',
    'head_commit',
    'fix_commits',
    'evidence',
    'verdicts',
  ]);

  const tasks = field(value, 'tasks');
  assertArray(tasks, `${path}.tasks`);
  for (let index = 0; index < tasks.length; index += 1) {
    parseTask(tasks[index], `${path}.tasks[${index}]`);
  }

  const provider = field(value, 'provider');
  if (provider !== null) {
    assertEnum(provider, `${path}.provider`, PROVIDERS);
  }
  assertNullableString(field(value, 'branch'), `${path}.branch`);
  assertNullableString(field(value, 'base_branch'), `${path}.base_branch`);
  const pullRequest = field(value, 'pull_request');
  if (pullRequest !== null) parsePullRequest(pullRequest, `${path}.pull_request`);
  assertNullableString(field(value, 'head_commit'), `${path}.head_commit`);
  parseStringArray(field(value, 'fix_commits'), `${path}.fix_commits`);

  const evidence = field(value, 'evidence');
  assertArray(evidence, `${path}.evidence`);
  for (let index = 0; index < evidence.length; index += 1) {
    parseEvidence(evidence[index], `${path}.evidence[${index}]`);
  }
  parseVerdicts(field(value, 'verdicts'), `${path}.verdicts`);
  return value as unknown as Work;
}

function parseCurrent(value: unknown, path: string): Current {
  assertExactObject(value, path, [
    'run_id',
    'lifecycle',
    'phase',
    'owner',
    'blocker',
    'work',
  ]);
  assertString(field(value, 'run_id'), `${path}.run_id`);
  assertEnum(field(value, 'lifecycle'), `${path}.lifecycle`, LIFECYCLES);
  const phase = field(value, 'phase');
  if (phase !== null) {
    assertEnum(phase, `${path}.phase`, PHASES);
  }
  const owner = field(value, 'owner');
  if (owner !== null) parseOwner(owner, `${path}.owner`);
  assertNullableString(field(value, 'blocker'), `${path}.blocker`);
  const work = field(value, 'work');
  if (work !== null) parseWork(work, `${path}.work`);
  return value as unknown as Current;
}

export function parseState(value: unknown): State {
  assertExactObject(value, '$', ['next_work_number', 'current']);
  const nextWorkNumber = field(value, 'next_work_number');
  if (!Number.isSafeInteger(nextWorkNumber) || (nextWorkNumber as number) < 1) {
    workflowStateError(
      '$.next_work_number',
      'integer greater than or equal to 1',
    );
  }

  const current = field(value, 'current');
  if (current !== null) parseCurrent(current, '$.current');

  const state = value as unknown as State;
  validateStateInvariants(state);
  return state;
}
