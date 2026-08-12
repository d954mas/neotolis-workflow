import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { WorkflowError } from '../../src/core/errors.ts';
import type { State } from '../../src/core/state.ts';

export const FIRST_OWNER = 'claude:first-primary';
export const SECOND_CLAUDE_OWNER = 'claude:second-primary';
export const CODEX_OWNER = 'codex:replacement-primary';

export function intakeState(options: {
  readonly owner?: string;
  readonly blocker?: string;
  readonly lifecycle?: 'intake-active' | 'brief-ready';
} = {}): State {
  const owner = options.owner;
  return {
    next_work_number: 2,
    current: {
      run_id: 'NT-001',
      lifecycle: options.lifecycle ?? 'intake-active',
      phase: owner === undefined ? null : 'nttask',
      owner: owner === undefined ? null : { session_id: owner },
      blocker: options.blocker ?? null,
      work: null,
    },
  };
}

export function temporaryProject(name: string, state: State): string {
  const project = mkdtempSync(join(tmpdir(), `ntworkflow-phase-${name}-`));
  mkdirSync(join(project, '.ntworkflow'));
  writeFileSync(
    join(project, '.ntworkflow', 'state.json'),
    `${JSON.stringify(state, null, 2)}\n`,
  );
  return project;
}

export function stateBytes(project: string): Buffer {
  return readFileSync(join(project, '.ntworkflow', 'state.json'));
}

export async function expectRejectedWithoutMutation(
  project: string,
  operation: () => Promise<unknown>,
  code: string,
  exitCode: number,
): Promise<WorkflowError> {
  const before = stateBytes(project);
  try {
    await operation();
  } catch (error) {
    assert.ok(error instanceof WorkflowError);
    assert.equal(error.code, code);
    assert.equal(error.exitCode, exitCode);
    assert.deepEqual(stateBytes(project), before);
    return error;
  }
  assert.fail(`Expected ${code}.`);
}

export function runCli(project: string, ...command: string[]) {
  return spawnSync(
    process.execPath,
    ['src/cli/main.ts', '--cwd', project, ...command],
    { encoding: 'utf8' },
  );
}

export function cliResponse(result: ReturnType<typeof runCli>) {
  assert.equal(result.stderr, '');
  assert.equal(result.stdout.endsWith('\n'), true);
  assert.equal(result.stdout.slice(0, -1).includes('\n'), false);
  return JSON.parse(result.stdout) as {
    ok: boolean;
    operation: string;
    state: State;
    next_action: { skill: string | null; instruction: string };
    error?: { code: string; exit_code: number };
  };
}
