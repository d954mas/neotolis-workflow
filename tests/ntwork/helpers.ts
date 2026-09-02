import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { State } from '../../src/core/state.ts';
import { cliResponse, runCli } from '../phase/helpers.ts';

export const WORK_OWNER = 'codex:work-primary';
export const WORK_ROLES = [
  '--implementer-available',
  '--task-reviewer-available',
  '--nyquist-auditor-available',
  '--spec-integration-reviewer-available',
  '--code-reviewer-available',
] as const;

export function git(project: string, ...arguments_: string[]): string {
  const result = spawnSync('git', arguments_, { cwd: project, encoding: 'utf8' });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  return result.stdout.trim();
}

export function workFixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'ntworkflow-work пробел '));
  git(root, 'init', '--quiet', '--initial-branch=main');
  git(root, 'config', 'user.name', 'Neotolis Test');
  git(root, 'config', 'user.email', 'neotolis@example.invalid');
  writeFileSync(join(root, 'project.txt'), 'baseline\n');
  git(root, 'add', 'project.txt');
  git(root, 'commit', '--quiet', '-m', 'baseline');

  const run = join(root, '.ntworkflow', 'runs', 'NT-001');
  mkdirSync(join(run, 'tasks'), { recursive: true });
  const state = JSON.parse(
    readFileSync('tests/fixtures/states/plan-approved.json', 'utf8'),
  ) as State;
  writeFileSync(join(root, '.ntworkflow', 'state.json'), `${JSON.stringify(state, null, 2)}\n`);
  cpSync('tests/fixtures/briefs/grilled.md', join(run, 'BRIEF.md'));
  for (const file of ['SPEC.md', 'PLAN.md', 'NT-001-01.md', 'NT-001-02.md']) {
    cpSync(
      join('tests/fixtures/plans', file),
      join(run, file.startsWith('NT-') ? 'tasks' : '', file),
    );
  }
  return root;
}

export function beginWork(root: string, owner = WORK_OWNER) {
  const result = runCli(
    root,
    'phase', 'begin', 'ntwork', '--session-id', owner,
    ...WORK_ROLES,
  );
  assert.equal(result.status, 0, result.stdout);
  return cliResponse(result);
}
