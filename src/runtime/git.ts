import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { ERROR_CODES, WorkflowError } from '../core/errors.ts';

const execFileAsync = promisify(execFile);

function gitFailure(message: string, operation: string): WorkflowError {
  return new WorkflowError({
    code: ERROR_CODES.ARTIFACT_FAILURE,
    message,
    details: { operation },
  });
}

async function git(projectRoot: string, arguments_: readonly string[]): Promise<string> {
  try {
    const result = await execFileAsync('git', arguments_, {
      cwd: projectRoot,
      encoding: 'utf8',
      windowsHide: true,
    });
    return result.stdout.trim();
  } catch {
    throw gitFailure('The active Git context could not be inspected.', arguments_.join(' '));
  }
}

export interface GitContext {
  readonly branch: string;
  readonly head: string;
  readonly projectDirty: boolean;
}

export async function readGitContext(projectRoot: string): Promise<GitContext> {
  const branch = await git(projectRoot, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
  if (branch.length === 0) {
    throw gitFailure('ntwork requires a normal branch; detached HEAD is not allowed.', 'symbolic-ref');
  }
  const head = await git(projectRoot, ['rev-parse', '--verify', 'HEAD']);
  const status = await git(projectRoot, [
    'status', '--porcelain=v1', '-z', '--untracked-files=all', '--', '.',
    ':(exclude).ntworkflow',
  ]);
  return { branch, head, projectDirty: status.length > 0 };
}

export async function readCommitParent(projectRoot: string, commit: string): Promise<string> {
  return git(projectRoot, ['rev-parse', '--verify', `${commit}^`]);
}
