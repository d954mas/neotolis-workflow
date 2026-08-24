import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { ERROR_CODES, WorkflowError } from '../../src/core/errors.ts';
import { parseState } from '../../src/core/state.ts';
import type { Current, State, Task, Work } from '../../src/core/state.ts';

const FIXTURE_DIRECTORY = join('tests', 'fixtures', 'states');
const LEGAL_FIXTURES = [
  'no-active-run.json',
  'intake-active.json',
  'brief-ready.json',
  'plan-ready.json',
  'plan-approved.json',
  'work-active.json',
  'delivery-ready.json',
] as const;

function readFixture(name: (typeof LEGAL_FIXTURES)[number]): unknown {
  return JSON.parse(readFileSync(join(FIXTURE_DIRECTORY, name), 'utf8'));
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function currentOf(state: State): Current {
  assert.ok(state.current !== null);
  return state.current;
}

function workOf(state: State): Work {
  const current = currentOf(state);
  assert.ok(current.work !== null);
  return current.work;
}

function taskOf(state: State, index: number): Task {
  const task = workOf(state).tasks[index];
  assert.ok(task !== undefined);
  return task;
}

function expectInvalidState(
  value: unknown,
  details?: { path: string; rule: string },
): WorkflowError {
  assert.throws(
    () => parseState(value),
    (error: unknown) => {
      assert.ok(error instanceof WorkflowError);
      assert.equal(error.code, ERROR_CODES.INVALID_STATE);
      assert.equal(error.exitCode, 10);
      assert.equal(error.message, 'Workflow state is invalid.');
      if (details !== undefined) {
        assert.deepEqual(error.details, details);
      } else {
        assert.deepEqual(Object.keys(error.details as object), ['path', 'rule']);
      }
      return true;
    },
  );

  try {
    parseState(value);
  } catch (error) {
    assert.ok(error instanceof WorkflowError);
    return error;
  }
  assert.fail('Expected parseState to throw.');
}

function valueAt(root: unknown, path: readonly (string | number)[]): unknown {
  let value = root;
  for (const segment of path) {
    assert.ok(value !== null && typeof value === 'object');
    value = (value as Record<string | number, unknown>)[segment];
  }
  return value;
}

function parentAt(root: unknown, path: readonly (string | number)[]): Record<string | number, unknown> {
  return valueAt(root, path.slice(0, -1)) as Record<string | number, unknown>;
}

function collectFieldPaths(value: unknown, path: readonly (string | number)[] = []): (string | number)[][] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return [];
  }

  const paths: (string | number)[][] = [];
  for (const [key, child] of Object.entries(value)) {
    const childPath = [...path, key];
    paths.push(childPath);
    if (Array.isArray(child)) {
      for (let index = 0; index < child.length; index += 1) {
        paths.push(...collectFieldPaths(child[index], [...childPath, index]));
      }
    } else {
      paths.push(...collectFieldPaths(child, childPath));
    }
  }
  return paths;
}

function mutationFor(value: unknown): unknown {
  if (value === null) return false;
  if (typeof value === 'string') return 1;
  if (typeof value === 'number') return 'wrong';
  if (Array.isArray(value)) return {};
  return [];
}

test('parses fixtures for no active run and every confirmed lifecycle', () => {
  const lifecycles = new Set<string>();

  for (const fixture of LEGAL_FIXTURES) {
    const input = readFixture(fixture);
    const parsed = parseState(input);
    assert.strictEqual(parsed, input);
    if (parsed.current !== null) lifecycles.add(parsed.current.lifecycle);
  }

  assert.deepEqual([...lifecycles].sort(), [
    'brief-ready',
    'delivery-ready',
    'intake-active',
    'plan-approved',
    'plan-ready',
    'work-active',
  ]);
});

test('exports the complete state type for future legal states', () => {
  const state: State = readFixture('delivery-ready.json') as State;
  assert.equal(state.current?.work?.tasks[0]?.task_id, 'NT-1000-01');
  assert.equal(state.current?.work?.evidence[0]?.source_ids[0], 'ci-1000');
  assert.equal(state.current?.work?.verdicts.spec_integration, 'pass');
  assert.equal(state.current?.owner, null);
});

test('rejects every missing field in the complete nested shape', () => {
  const fixture = readFixture('delivery-ready.json');
  for (const path of collectFieldPaths(fixture)) {
    const mutated = clone(fixture);
    Reflect.deleteProperty(parentAt(mutated, path), path.at(-1) as string | number);
    expectInvalidState(mutated);
  }
});

test('rejects unknown fields at every object layer', () => {
  const cases: [unknown, readonly (string | number)[]][] = [
    [readFixture('delivery-ready.json'), []],
    [readFixture('delivery-ready.json'), ['current']],
    [readFixture('work-active.json'), ['current', 'owner']],
    [readFixture('delivery-ready.json'), ['current', 'work']],
    [readFixture('delivery-ready.json'), ['current', 'work', 'tasks', 0]],
    [readFixture('delivery-ready.json'), ['current', 'work', 'pull_request']],
    [readFixture('delivery-ready.json'), ['current', 'work', 'evidence', 0]],
    [readFixture('delivery-ready.json'), ['current', 'work', 'verdicts']],
  ];

  for (const [fixture, path] of cases) {
    const mutated = clone(fixture);
    const target = valueAt(mutated, path) as Record<string, unknown>;
    target.unexpected = true;
    expectInvalidState(mutated);
  }
});

test('rejects wrong types for every field in the complete nested shape', () => {
  const fixture = readFixture('delivery-ready.json');
  for (const path of collectFieldPaths(fixture)) {
    const mutated = clone(fixture);
    const parent = parentAt(mutated, path);
    const key = path.at(-1) as string | number;
    parent[key] = mutationFor(parent[key]);
    expectInvalidState(mutated);
  }
});

test('reports stable details for shape and invariant failures', () => {
  expectInvalidState(
    { current: null },
    { path: '$.next_work_number', rule: 'required' },
  );
  expectInvalidState(
    { next_work_number: 1, current: null, extra: true },
    { path: '$.extra', rule: 'unknown field' },
  );
  expectInvalidState(
    { next_work_number: '1', current: null },
    { path: '$.next_work_number', rule: 'integer greater than or equal to 1' },
  );

  const invalid = readFixture('brief-ready.json') as State;
  assert.ok(invalid.current !== null);
  invalid.current.phase = 'nttask';
  expectInvalidState(
    invalid,
    { path: '$.current.phase', rule: 'phase is not legal for lifecycle brief-ready' },
  );
});

test('validates canonical run, task, and session identifiers', () => {
  const badRun = readFixture('brief-ready.json') as State;
  assert.ok(badRun.current !== null);
  badRun.current.run_id = 'NT-01';
  expectInvalidState(badRun);

  const zeroRun = readFixture('brief-ready.json') as State;
  assert.ok(zeroRun.current !== null);
  zeroRun.current.run_id = 'NT-000';
  expectInvalidState(zeroRun);

  const skippedWorkNumber = readFixture('brief-ready.json') as State;
  skippedWorkNumber.next_work_number = 3;
  expectInvalidState(skippedWorkNumber);

  const badTask = readFixture('plan-approved.json') as State;
  taskOf(badTask, 0).task_id = 'NT-001-1';
  expectInvalidState(badTask);

  const wrongRunTask = readFixture('plan-approved.json') as State;
  taskOf(wrongRunTask, 0).task_id = 'NT-002-01';
  expectInvalidState(wrongRunTask);

  const badSession = readFixture('intake-active.json') as State;
  const badSessionOwner = currentOf(badSession).owner;
  assert.ok(badSessionOwner !== null);
  badSessionOwner.session_id = 'other:session';
  expectInvalidState(badSession);
});

test('enforces lifecycle, phase, owner, blocker, and provider combinations', () => {
  const missingOwner = readFixture('intake-active.json') as State;
  assert.ok(missingOwner.current !== null);
  missingOwner.current.owner = null;
  expectInvalidState(missingOwner);

  const ownerWithoutPhase = readFixture('brief-ready.json') as State;
  assert.ok(ownerWithoutPhase.current !== null);
  ownerWithoutPhase.current.owner = { session_id: 'claude:session' };
  expectInvalidState(ownerWithoutPhase);

  const blockerWithOwner = readFixture('intake-active.json') as State;
  assert.ok(blockerWithOwner.current !== null);
  blockerWithOwner.current.blocker = 'source unavailable';
  expectInvalidState(blockerWithOwner);

  const providerMismatch = readFixture('work-active.json') as State;
  workOf(providerMismatch).provider = 'claude';
  expectInvalidState(providerMismatch);

  const stoppedWork = readFixture('work-active.json') as State;
  assert.ok(stoppedWork.current !== null);
  stoppedWork.current.phase = null;
  stoppedWork.current.owner = null;
  stoppedWork.current.blocker = 'waiting for explicit resolution';
  parseState(stoppedWork);
});

test('reads legal phase-owned and interrupted future-state boundaries', () => {
  const activeGrill = readFixture('brief-ready.json') as State;
  currentOf(activeGrill).phase = 'ntgrill';
  currentOf(activeGrill).owner = { session_id: 'claude:grill-session' };
  parseState(activeGrill);

  const startingWork = readFixture('plan-approved.json') as State;
  currentOf(startingWork).phase = 'ntwork';
  currentOf(startingWork).owner = { session_id: 'codex:work-session' };
  parseState(startingWork);

  const initialWork = readFixture('plan-approved.json') as State;
  currentOf(initialWork).lifecycle = 'work-active';
  currentOf(initialWork).phase = 'ntwork';
  currentOf(initialWork).owner = { session_id: 'codex:work-session' };
  workOf(initialWork).provider = 'codex';
  parseState(initialWork);

  const committedActiveTask = readFixture('work-active.json') as State;
  const activeTask = taskOf(committedActiveTask, 1);
  activeTask.packet_review = 'pass';
  activeTask.quality_review = 'pass';
  activeTask.commit_id = 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
  workOf(committedActiveTask).head_commit = activeTask.commit_id;
  parseState(committedActiveTask);

  const blockedFinalReview = readFixture('delivery-ready.json') as State;
  currentOf(blockedFinalReview).lifecycle = 'work-active';
  currentOf(blockedFinalReview).phase = 'ntwork';
  currentOf(blockedFinalReview).owner = { session_id: 'claude:final-review' };
  workOf(blockedFinalReview).verdicts.spec_integration = 'block';
  workOf(blockedFinalReview).verdicts.code_review = 'pending';
  parseState(blockedFinalReview);
});

test('reads independent final review verdicts after whole-plan validation passes', () => {
  const reviewing = readFixture('delivery-ready.json') as State;
  const current = currentOf(reviewing);
  current.lifecycle = 'work-active';
  current.phase = 'ntwork';
  current.owner = { session_id: 'claude:parallel-review' };

  const verdicts = workOf(reviewing).verdicts;
  verdicts.nyquist = 'pending';
  verdicts.spec_integration = 'pass';
  verdicts.code_review = 'pending';
  verdicts.ci = 'pending';

  parseState(reviewing);
});

test('reads delivery-ready without an optional pull request', () => {
  const delivery = readFixture('delivery-ready.json') as State;
  workOf(delivery).pull_request = null;

  parseState(delivery);
});

test('reads delivery-ready when hosted CI is not required', () => {
  const delivery = readFixture('delivery-ready.json') as State;
  Reflect.set(workOf(delivery).verdicts, 'ci', 'not-required');

  parseState(delivery);
});

test('enforces work presence and the pristine plan-approved boundary', () => {
  const earlyWork = readFixture('brief-ready.json') as State;
  const planApproved = readFixture('plan-approved.json') as State;
  currentOf(earlyWork).work = clone(workOf(planApproved));
  expectInvalidState(earlyWork);

  const missingWork = readFixture('plan-approved.json') as State;
  assert.ok(missingWork.current !== null);
  missingWork.current.work = null;
  expectInvalidState(missingWork);

  const initializedTooEarly = readFixture('plan-approved.json') as State;
  workOf(initializedTooEarly).provider = 'codex';
  expectInvalidState(initializedTooEarly);

  const changedTask = readFixture('plan-approved.json') as State;
  taskOf(changedTask, 0).status = 'active';
  expectInvalidState(changedTask);
});

test('enforces ordered task status and task review/commit invariants', () => {
  const duplicate = readFixture('work-active.json') as State;
  taskOf(duplicate, 1).task_id = 'NT-001-01';
  expectInvalidState(duplicate);

  const outOfOrder = readFixture('work-active.json') as State;
  const firstOutOfOrderTask = taskOf(outOfOrder, 0);
  firstOutOfOrderTask.status = 'pending';
  firstOutOfOrderTask.start_commit = null;
  firstOutOfOrderTask.commit_id = null;
  firstOutOfOrderTask.packet_review = 'pending';
  firstOutOfOrderTask.quality_review = 'pending';
  expectInvalidState(outOfOrder);

  const pendingMetadata = readFixture('plan-approved.json') as State;
  taskOf(pendingMetadata, 0).start_commit = 'abc';
  expectInvalidState(pendingMetadata);

  const completedWithoutCommit = readFixture('delivery-ready.json') as State;
  taskOf(completedWithoutCommit, 0).commit_id = null;
  expectInvalidState(completedWithoutCommit);

  const committedBeforePass = readFixture('work-active.json') as State;
  taskOf(committedBeforePass, 1).commit_id = 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
  expectInvalidState(committedBeforePass);
});

test('enforces work identity, final-gate sequencing, and delivery readiness', () => {
  const halfBranch = readFixture('work-active.json') as State;
  workOf(halfBranch).base_branch = null;
  expectInvalidState(halfBranch);

  const finalGateTooSoon = readFixture('work-active.json') as State;
  workOf(finalGateTooSoon).verdicts.whole_plan = 'pass';
  expectInvalidState(finalGateTooSoon);

  const nyquistTooSoon = readFixture('delivery-ready.json') as State;
  workOf(nyquistTooSoon).verdicts.whole_plan = 'fail';
  expectInvalidState(nyquistTooSoon);

  const reviewTooSoon = readFixture('delivery-ready.json') as State;
  workOf(reviewTooSoon).verdicts.whole_plan = 'fail';
  workOf(reviewTooSoon).verdicts.nyquist = 'pending';
  expectInvalidState(reviewTooSoon);

  const incompleteDelivery = readFixture('delivery-ready.json') as State;
  workOf(incompleteDelivery).verdicts.code_review = 'block';
  expectInvalidState(incompleteDelivery);

  for (const ci of ['pending', 'fail'] as const) {
    const incompleteCi = readFixture('delivery-ready.json') as State;
    workOf(incompleteCi).verdicts.ci = ci;
    expectInvalidState(incompleteCi);
  }
});

test('does not mutate parsed inputs or fixture files', () => {
  for (const fixture of LEGAL_FIXTURES) {
    const path = join(FIXTURE_DIRECTORY, fixture);
    const textBefore = readFileSync(path, 'utf8');
    const input = JSON.parse(textBefore) as unknown;
    const valueBefore = structuredClone(input);

    parseState(input);

    assert.deepEqual(input, valueBefore);
    assert.equal(readFileSync(path, 'utf8'), textBefore);
  }
});
