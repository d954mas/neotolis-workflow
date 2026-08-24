import { lstat, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import { SESSION_ID_FORMAT } from '../core/domain.ts';
import { ERROR_CODES, WorkflowError, hasErrorCode } from '../core/errors.ts';
import { providerForSessionId } from '../core/invariants.ts';
import type { Lifecycle, State } from '../core/state.ts';
import { isGitProjectRoot } from './project-root.ts';
import { runStateTransaction } from './transaction.ts';
import type {
  StateTransactionResult,
  TransactionFaultInjector,
  TransactionState,
} from './transaction.ts';

const CANCELABLE_LIFECYCLES = new Set<Lifecycle>([
  'intake-active',
  'brief-ready',
  'plan-ready',
  'plan-approved',
  'work-active',
]);

export interface StartRunInput {
  readonly sessionId: string;
}

export interface AuthorizedRunInput extends StartRunInput {
  readonly userConfirmed: boolean;
}

export interface RunTransactionOptions {
  readonly faultInjector?: TransactionFaultInjector;
}

function validateSessionId(sessionId: string): void {
  if (providerForSessionId(sessionId) === null) {
    throw new WorkflowError({
      code: ERROR_CODES.INVALID_INPUT,
      message: 'A canonical provider session ID is required.',
      details: {
        argument: '--session-id',
        expected: SESSION_ID_FORMAT,
      },
    });
  }
}

function requireUserConfirmation(userConfirmed: boolean, operation: string): void {
  if (!userConfirmed) {
    throw new WorkflowError({
      code: ERROR_CODES.INVALID_INPUT,
      message: `${operation} requires explicit user authority.`,
      details: { argument: '--user-confirmed' },
    });
  }
}

function illegalTransition(
  operation: string,
  state: TransactionState | null,
  allowed: readonly string[],
): never {
  throw new WorkflowError({
    code: ERROR_CODES.ILLEGAL_TRANSITION,
    message: `${operation} is not legal from the current lifecycle.`,
    details: {
      actual: state?.current?.lifecycle ?? null,
      allowed,
    },
  });
}

function commitFailure(stage: string, path: string): WorkflowError {
  return new WorkflowError({
    code: ERROR_CODES.COMMIT_FAILURE,
    message: 'The run directory could not be prepared.',
    details: { stage, path },
  });
}

async function ensureDirectory(path: string, stage: string): Promise<void> {
  try {
    await mkdir(path);
    return;
  } catch (error) {
    if (!hasErrorCode(error, 'EEXIST')) throw commitFailure(stage, path);
  }

  try {
    if ((await lstat(path)).isDirectory()) return;
  } catch {
    // Report one stable failure for an unusable workflow path.
  }
  throw commitFailure(stage, path);
}

async function requireGitProject(projectRoot: string): Promise<void> {
  if (await isGitProjectRoot(projectRoot)) return;

  throw new WorkflowError({
    code: ERROR_CODES.INVALID_INPUT,
    message: 'Run start requires a Git repository.',
    details: { project_root: projectRoot },
  });
}

async function ensureWorkflowDirectory(projectRoot: string): Promise<void> {
  await ensureDirectory(join(projectRoot, '.ntworkflow'), 'workflow-directory');
}

async function prepareRunDirectory(projectRoot: string, runId: string): Promise<void> {
  const runsPath = join(projectRoot, '.ntworkflow', 'runs');
  await ensureDirectory(runsPath, 'runs-directory');

  const runPath = join(runsPath, runId);
  try {
    await mkdir(runPath);
  } catch (error) {
    if (hasErrorCode(error, 'EEXIST')) {
      throw new WorkflowError({
        code: ERROR_CODES.PARTIAL_RUN,
        message: 'The target run path already exists.',
        details: { path: runPath },
      });
    }
    throw commitFailure('run-directory', runPath);
  }
}

function formatRunId(number: number): string {
  return `NT-${String(number).padStart(3, '0')}`;
}

function newCurrent(runId: string): NonNullable<State['current']> {
  return {
    run_id: runId,
    lifecycle: 'intake-active',
    phase: null,
    owner: null,
    blocker: null,
    work: null,
  };
}

export async function startRun(
  projectRoot: string,
  input: StartRunInput,
  transactionOptions: RunTransactionOptions = {},
): Promise<StateTransactionResult> {
  validateSessionId(input.sessionId);
  await requireGitProject(projectRoot);
  await ensureWorkflowDirectory(projectRoot);

  return runStateTransaction(
    projectRoot,
    (state) => {
      if (
        state !== null
        && state.current !== null
        && state.current.lifecycle !== 'delivery-ready'
      ) {
        illegalTransition('run start', state, ['no active run', 'delivery-ready']);
      }

      const nextWorkNumber = state?.next_work_number ?? 1;
      return {
        next_work_number: nextWorkNumber + 1,
        current: newCurrent(formatRunId(nextWorkNumber)),
      };
    },
    {
      ...transactionOptions,
      prepareCommit: async (_current, next) => {
        const current = next.current as NonNullable<State['current']>;
        await prepareRunDirectory(projectRoot, current.run_id);
      },
    },
  );
}

async function requireWorkflowDirectory(
  projectRoot: string,
  operation: string,
  allowed: readonly string[],
): Promise<void> {
  const workflowPath = join(projectRoot, '.ntworkflow');
  try {
    if ((await lstat(workflowPath)).isDirectory()) return;
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) {
      illegalTransition(operation, null, allowed);
    }
  }
  throw commitFailure('workflow-directory', workflowPath);
}

export async function cancelRun(
  projectRoot: string,
  input: AuthorizedRunInput,
  transactionOptions: RunTransactionOptions = {},
): Promise<StateTransactionResult> {
  validateSessionId(input.sessionId);
  requireUserConfirmation(input.userConfirmed, 'run cancel');
  const allowed = [...CANCELABLE_LIFECYCLES];
  await requireWorkflowDirectory(projectRoot, 'run cancel', allowed);

  return runStateTransaction(
    projectRoot,
    (state) => {
      if (state === null || state.current === null
        || !CANCELABLE_LIFECYCLES.has(state.current.lifecycle)) {
        illegalTransition('run cancel', state, allowed);
      }
      return {
        next_work_number: state.next_work_number,
        current: null,
      };
    },
    transactionOptions,
  );
}

export async function completeRun(
  projectRoot: string,
  input: AuthorizedRunInput,
  transactionOptions: RunTransactionOptions = {},
): Promise<StateTransactionResult> {
  validateSessionId(input.sessionId);
  requireUserConfirmation(input.userConfirmed, 'run complete');
  const allowed = ['delivery-ready'] as const;
  await requireWorkflowDirectory(projectRoot, 'run complete', allowed);

  return runStateTransaction(
    projectRoot,
    (state) => {
      if (state?.current?.lifecycle !== 'delivery-ready') {
        illegalTransition('run complete', state, allowed);
      }
      return {
        next_work_number: state.next_work_number,
        current: null,
      };
    },
    transactionOptions,
  );
}
