import { constants } from 'node:fs';
import { access, lstat, readFile, realpath, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import { ERROR_CODES, WorkflowError, hasErrorCode } from '../core/errors.ts';

function invalidCwd(cwd: string): WorkflowError {
  return new WorkflowError({
    code: ERROR_CODES.INVALID_INPUT,
    message: 'The supplied cwd must be an accessible directory.',
    details: { cwd },
  });
}

export async function canonicalizeCwd(cwd: string): Promise<string> {
  if (cwd.length === 0) throw invalidCwd(cwd);

  try {
    const canonical = await realpath(resolve(cwd));
    const metadata = await stat(canonical);
    if (!metadata.isDirectory()) throw invalidCwd(cwd);
    await access(canonical, constants.X_OK);
    return canonical;
  } catch (error) {
    if (error instanceof WorkflowError) throw error;
    throw invalidCwd(cwd);
  }
}

export async function isGitProjectRoot(directory: string): Promise<boolean> {
  const markerPath = join(directory, '.git');
  try {
    const marker = await lstat(markerPath);
    if (marker.isDirectory()) return true;
    if (!marker.isFile()) return false;

    try {
      const source = await readFile(markerPath, 'utf8');
      return /^gitdir: .+(?:\r?\n)?$/u.test(source);
    } catch {
      throw new WorkflowError({
        code: ERROR_CODES.ARTIFACT_FAILURE,
        message: 'The Git worktree marker is unreadable.',
        details: { path: markerPath },
      });
    }
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) return false;
    if (error instanceof WorkflowError) throw error;
    throw new WorkflowError({
      code: ERROR_CODES.ARTIFACT_FAILURE,
      message: 'The Git marker could not be inspected.',
      details: { path: markerPath },
    });
  }
}

export async function resolveProjectRoot(cwd: string): Promise<string> {
  const canonicalCwd = await canonicalizeCwd(cwd);
  let candidate = canonicalCwd;

  while (true) {
    if (await isGitProjectRoot(candidate)) return candidate;
    const parent = dirname(candidate);
    if (parent === candidate) return canonicalCwd;
    candidate = parent;
  }
}
