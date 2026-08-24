import { lstat, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { ERROR_CODES, WorkflowError, hasErrorCode } from '../core/errors.ts';
import { parseState } from '../core/state.ts';
import type { State } from '../core/state.ts';
import { resolveProjectRoot } from './project-root.ts';

export interface PreflightResult {
  readonly projectRoot: string;
  readonly state: State | null;
}


function invalidState(rule: string): WorkflowError {
  return new WorkflowError({
    code: ERROR_CODES.INVALID_STATE,
    message: 'Workflow state is invalid.',
    details: { path: '$', rule },
  });
}

export async function readProjectState(projectRoot: string): Promise<State | null> {
  const workflowPath = join(projectRoot, '.ntworkflow');
  let workflowMetadata;

  try {
    workflowMetadata = await lstat(workflowPath);
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) return null;
    throw invalidState('readable workflow directory');
  }

  if (!workflowMetadata.isDirectory()) {
    throw invalidState('workflow directory');
  }

  const statePath = join(workflowPath, 'state.json');
  let metadata;

  try {
    metadata = await lstat(statePath);
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) return null;
    throw invalidState('readable regular UTF-8 JSON file');
  }

  if (!metadata.isFile()) {
    throw invalidState('regular UTF-8 JSON file');
  }

  let source: string;
  try {
    const bytes = await readFile(statePath);
    source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw invalidState('readable regular UTF-8 JSON file');
  }

  let value: unknown;
  try {
    value = JSON.parse(source) as unknown;
  } catch {
    throw invalidState('valid JSON document');
  }

  return parseState(value);
}

export async function readPreflight(cwd: string): Promise<PreflightResult> {
  const projectRoot = await resolveProjectRoot(cwd);
  const state = await readProjectState(projectRoot);
  return Object.freeze({ projectRoot, state });
}
