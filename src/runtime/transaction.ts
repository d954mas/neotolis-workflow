import { randomUUID } from 'node:crypto';
import {
  lstat,
  open,
  rename,
  link,
  unlink,
} from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { join } from 'node:path';

import { ERROR_CODES, WorkflowError, hasErrorCode } from '../core/errors.ts';
import { parseState } from '../core/state.ts';
import type { State } from '../core/state.ts';
import { readProjectState } from './preflight.ts';

export const TRANSACTION_FAULT_POINTS = Object.freeze([
  'before-write',
  'after-temp-sync',
  'before-rename',
] as const);

const DIRECTORY_DURABILITY_WARNING =
  'Workflow state committed, but parent directory durability could not be confirmed.';
const LOCK_RELEASE_WARNING =
  'Workflow state committed, but its state lock could not be safely released.';

export type TransactionFaultPoint = (typeof TRANSACTION_FAULT_POINTS)[number];
export type TransactionFaultInjector = (
  point: TransactionFaultPoint,
) => void | Promise<void>;
export type TransactionState = State;
export type StateTransition = (state: TransactionState | null) => State | Promise<State>;
export type StateCommitPreparation = (
  currentState: TransactionState | null,
  nextState: TransactionState,
) => void | Promise<void>;

export interface StateTransactionOptions {
  readonly prepareCommit?: StateCommitPreparation;
  readonly faultInjector?: TransactionFaultInjector;
}

export interface StateTransactionResult {
  readonly state: State;
  readonly warnings: readonly string[];
}

interface LockOwnership {
  readonly path: string;
  readonly token: string;
  readonly releasePath: string;
}

function commitFailure(stage: string, path: string): WorkflowError {
  return new WorkflowError({
    code: ERROR_CODES.COMMIT_FAILURE,
    message: 'Workflow state could not be committed.',
    details: { stage, path },
  });
}

function serializeState(state: State): string {
  return `${JSON.stringify(state, null, 2)}\n`;
}

async function closeQuietly(handle: FileHandle | null): Promise<void> {
  if (handle === null) return;
  try {
    await handle.close();
  } catch {
    // Cleanup must not replace the transaction's primary result.
  }
}

async function releaseOwnedLock(lock: LockOwnership): Promise<boolean> {
  let handle: FileHandle | null = null;

  try {
    await rename(lock.path, lock.releasePath);
  } catch {
    return false;
  }

  const restoreClaimedLock = async (): Promise<void> => {
    try {
      await link(lock.releasePath, lock.path);
      await unlink(lock.releasePath);
    } catch {
      // Preserve the claimed file when the canonical path cannot be restored safely.
    }
  };

  try {
    handle = await open(lock.releasePath, 'r');
    const value = JSON.parse(await handle.readFile('utf8')) as unknown;
    await handle.close();
    handle = null;

    if (
      value === null
      || typeof value !== 'object'
      || Array.isArray(value)
      || (value as { readonly token?: unknown }).token !== lock.token
    ) {
      await restoreClaimedLock();
      return false;
    }

    await unlink(lock.releasePath);
    return true;
  } catch {
    await closeQuietly(handle);
    await restoreClaimedLock();
    return false;
  }
}

async function assertWorkflowDirectory(workflowPath: string): Promise<void> {
  try {
    if (!(await lstat(workflowPath)).isDirectory()) {
      throw commitFailure('workflow-directory', workflowPath);
    }
  } catch (error) {
    if (error instanceof WorkflowError) throw error;
    if (hasErrorCode(error, 'ENOENT')) {
      throw new WorkflowError({
        code: ERROR_CODES.ILLEGAL_TRANSITION,
        message: 'A run must be started before this operation.',
        details: { actual_lifecycle: null },
      });
    }
    throw commitFailure('workflow-directory', workflowPath);
  }
}

async function acquireLock(workflowPath: string): Promise<LockOwnership> {
  const lockPath = join(workflowPath, '.state.lock');
  const token = randomUUID();
  const lock = {
    path: lockPath,
    releasePath: join(workflowPath, `.state.lock.${token}.release`),
    token,
  };
  let handle: FileHandle;

  try {
    handle = await open(lockPath, 'wx', 0o600);
  } catch (error) {
    if (hasErrorCode(error, 'EEXIST')) {
      throw new WorkflowError({
        code: ERROR_CODES.LOCK_CONFLICT,
        message: 'Workflow state is locked by another mutator.',
        details: { path: lockPath },
      });
    }
    throw commitFailure('lock-create', lockPath);
  }

  try {
    await handle.writeFile(`${JSON.stringify({ pid: process.pid, token }, null, 2)}\n`, 'utf8');
    await handle.sync();
    await handle.close();
  } catch {
    await closeQuietly(handle);
    try {
      await unlink(lockPath);
    } catch {
      // The failed lock never became shared workflow state.
    }
    throw commitFailure('lock-write', lockPath);
  }
  return lock;
}

async function syncParentDirectory(workflowPath: string): Promise<string | null> {
  if (process.platform === 'win32') return null;

  let handle: FileHandle | null = null;
  let warning: string | null = null;
  try {
    handle = await open(workflowPath, 'r');
    await handle.sync();
  } catch (error) {
    const unsupported = ['EBADF', 'EINVAL', 'EISDIR', 'ENOSYS', 'ENOTSUP', 'EPERM']
      .some((code) => hasErrorCode(error, code));
    if (!unsupported) warning = DIRECTORY_DURABILITY_WARNING;
  } finally {
    if (handle !== null) {
      try {
        await handle.close();
      } catch {
        warning = DIRECTORY_DURABILITY_WARNING;
      }
    }
  }
  return warning;
}

async function commitState(
  workflowPath: string,
  serializedState: string,
  lockToken: string,
  faultInjector?: TransactionFaultInjector,
): Promise<string | null> {
  const statePath = join(workflowPath, 'state.json');
  const temporaryPath = join(workflowPath, `.state.${lockToken}.tmp`);
  let handle: FileHandle | null = null;
  let renamed = false;

  try {
    handle = await open(temporaryPath, 'wx', 0o600);
    await faultInjector?.('before-write');
    await handle.writeFile(serializedState, 'utf8');
    await handle.sync();
    await faultInjector?.('after-temp-sync');
    await handle.close();
    handle = null;
    await faultInjector?.('before-rename');
    await rename(temporaryPath, statePath);
    renamed = true;
    return syncParentDirectory(workflowPath);
  } catch (error) {
    if (error instanceof WorkflowError) throw error;
    throw commitFailure('state-replace', statePath);
  } finally {
    await closeQuietly(handle);
    if (!renamed) {
      try {
        await unlink(temporaryPath);
      } catch {
        // A failed or absent temporary file requires no repair.
      }
    }
  }
}

export async function runStateTransaction(
  projectRoot: string,
  transition: StateTransition,
  options: StateTransactionOptions = {},
): Promise<StateTransactionResult> {
  const workflowPath = join(projectRoot, '.ntworkflow');
  await assertWorkflowDirectory(workflowPath);
  const lock = await acquireLock(workflowPath);
  let state: State;
  const warnings: string[] = [];

  try {
    const currentState = await readProjectState(projectRoot);
    const nextState = parseState(await transition(currentState));
    const serializedState = serializeState(nextState);
    await options.prepareCommit?.(currentState, nextState);
    const durabilityWarning = await commitState(
      workflowPath,
      serializedState,
      lock.token,
      options.faultInjector,
    );
    if (durabilityWarning !== null) warnings.push(durabilityWarning);
    state = nextState;
  } catch (error) {
    await releaseOwnedLock(lock);
    throw error;
  }

  if (!(await releaseOwnedLock(lock))) warnings.push(LOCK_RELEASE_WARNING);
  return { state, warnings };
}
