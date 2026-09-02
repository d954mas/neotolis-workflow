import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { withProviders } from './harness.ts';

const RUN = '.ntworkflow/runs/NT-001/';
const ROLES = [
  '--implementer-available', '--task-reviewer-available',
  '--nyquist-auditor-available', '--spec-integration-reviewer-available',
  '--code-reviewer-available',
];

test('E2E: approved tasks execute sequentially through independent final gates with provider parity', async () => {
  await withProviders((fixture) => {
    const git = (...arguments_: string[]) => {
      const result = spawnSync('git', arguments_, {
        cwd: fixture.root,
        encoding: 'utf8',
        env: {
          ...process.env,
          GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z',
          GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z',
        },
      });
      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
      return result.stdout.trim();
    };
    git('config', 'user.name', 'Neotolis E2E');
    git('config', 'user.email', 'e2e@example.invalid');
    fixture.write('implementation.txt', 'baseline\n');
    git('add', '.gitignore', 'user.txt', 'user.bin', 'implementation.txt');
    git('commit', '--quiet', '-m', 'baseline');

    fixture.write('.ntworkflow/state.json', readFileSync('tests/fixtures/states/plan-approved.json'));
    fixture.write(RUN + 'BRIEF.md', readFileSync('tests/fixtures/briefs/grilled.md'));
    for (const file of ['SPEC.md', 'PLAN.md', 'NT-001-01.md', 'NT-001-02.md']) {
      fixture.write(
        RUN + (file.startsWith('NT-') ? 'tasks/' : '') + file,
        readFileSync(`tests/fixtures/plans/${file}`),
      );
    }

    const work = fixture.session('work');
    work.reject(14, 'ARTIFACT_FAILURE',
      'phase', 'begin', 'ntwork', '--session-id', work.owner, ...ROLES.slice(1));
    work.cli('phase', 'begin', 'ntwork', '--session-id', work.owner, ...ROLES);
    work.reject(11, 'ILLEGAL_TRANSITION',
      'task', 'begin', 'NT-001-02', '--session-id', work.owner);

    for (const taskId of ['NT-001-01', 'NT-001-02']) {
      work.cli('task', 'begin', taskId, '--session-id', work.owner);
      fixture.write('implementation.txt', fixture.read('implementation.txt') + `${taskId}\n`);
      work.cli(
        'work', 'record', 'evidence', '--session-id', work.owner,
        '--gate', `task:${taskId}`, '--procedure', `verify ${taskId}`,
        '--result', 'pass', '--expected', 'pass', '--source-id', `primary:${taskId}`,
      );
      work.cli(
        'work', 'record', 'task-review', taskId, '--session-id', work.owner,
        '--packet', 'pass', '--quality', 'pass', '--source-id', `reviewer:${taskId}`,
      );
      git('add', 'implementation.txt');
      git('commit', '--quiet', '-m', `complete ${taskId}`);
      work.cli(
        'task', 'complete', taskId, '--session-id', work.owner,
        '--commit-id', git('rev-parse', 'HEAD'),
      );
    }

    for (const [gate, verdict] of [
      ['whole-plan', 'pass'], ['nyquist', 'pass'], ['spec-integration', 'pass'],
      ['code-review', 'pass'], ['ci', 'not-required'],
    ]) {
      work.cli(
        'work', 'record', 'gate', gate as string, '--session-id', work.owner,
        '--verdict', verdict as string, '--procedure', `check ${gate}`,
        '--result', verdict as string, '--expected', 'pass or not-required',
        '--source-id', `native:${gate}`,
      );
    }
    const complete = work.cli('phase', 'complete', 'ntwork', '--session-id', work.owner);
    assert.equal(complete.state?.current?.lifecycle, 'delivery-ready');
    const late = fixture.session('late');
    late.reject(11, 'ILLEGAL_TRANSITION',
      'phase', 'begin', 'ntwork', '--session-id', late.owner, ...ROLES);
  });
});
