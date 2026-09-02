import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { completeNtplanPhase } from '../../src/runtime/ntplan.ts';
import { cliResponse, runCli } from '../phase/helpers.ts';
import { tree } from '../e2e/harness.ts';

test('ntplan validates current artifacts at both gates and commits approval last', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ntworkflow-plan-complete-'));
  const run = join(root, '.ntworkflow/runs/NT-001');
  const owner = 'codex:planning-primary';
  const statePath = join(root, '.ntworkflow/state.json');
  mkdirSync(join(root, '.git'));
  mkdirSync(join(run, 'tasks'), { recursive: true });
  const state = JSON.parse(readFileSync('tests/fixtures/states/plan-ready.json', 'utf8'));
  state.current.owner.session_id = owner;
  writeFileSync(statePath, JSON.stringify(state));
  cpSync('tests/fixtures/briefs/grilled.md', join(run, 'BRIEF.md'));
  for (const file of ['SPEC.md', 'PLAN.md', 'NT-001-01.md', 'NT-001-02.md']) {
    cpSync(join('tests/fixtures/plans', file), join(run, file.startsWith('NT-') ? 'tasks' : '', file));
  }
  const complete = (...flags: string[]) => runCli(root, 'phase', 'complete', 'ntplan', '--session-id', owner, ...flags);
  try {
    const before = tree(root);
    assert.equal(runCli(root, 'plan', 'validate', '--session-id', owner).status, 0);
    assert.equal(runCli(root, 'plan', 'validate', '--session-id', 'claude:other').status, 12);
    assert.equal(complete().status, 2);
    assert.equal(complete('--user-confirmed').status, 2);
    assert.equal(complete('--critic-pass').status, 2);
    assert.deepEqual(tree(root), before);
    const packet = join(run, 'tasks/NT-001-02.md');
    const bytes = readFileSync(packet);
    writeFileSync(packet, bytes.toString().replace('AC-2', 'AC-1'));
    const invalid = tree(root);
    assert.equal(complete('--critic-pass', '--user-confirmed').status, 14);
    assert.deepEqual(tree(root), invalid);
    writeFileSync(packet, bytes);
    await assert.rejects(completeNtplanPhase(root, { sessionId: owner, criticPassed: false, userConfirmed: true }), { code: 'INVALID_INPUT' });
    await assert.rejects(completeNtplanPhase(root, { sessionId: owner, criticPassed: true, userConfirmed: true }, {
      faultInjector(point) {
        assert.deepEqual(readFileSync(statePath), before['.ntworkflow/state.json']);
        if (point === 'before-rename') throw Error('Injected state replacement failure.');
      },
    }), { code: 'COMMIT_FAILURE' });
    assert.deepEqual(tree(root), before);
    const result = complete('--critic-pass', '--user-confirmed');
    assert.equal(result.status, 0, result.stdout);
    const current = cliResponse(result).state.current;
    assert.equal(current?.lifecycle, 'plan-approved');
    assert.equal(current?.owner, null);
    assert.equal(current?.phase, null);
    assert.deepEqual(current?.work, JSON.parse(readFileSync('tests/fixtures/states/plan-approved.json', 'utf8')).current.work);
    assert.equal(cliResponse(result).next_action.skill, 'ntwork');
    const approved = tree(root);
    assert.equal(runCli(root, 'plan', 'validate', '--session-id', 'claude:reader').status, 0);
    assert.equal(complete('--critic-pass', '--user-confirmed').status, 11);
    assert.equal(runCli(root, 'phase', 'begin', 'ntplan', '--session-id', owner, '--researcher-available', '--critic-available').status, 11);
    assert.deepEqual(tree(root), approved);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
