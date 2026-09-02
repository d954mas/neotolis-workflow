import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { withProviders } from './harness.ts';

const RUN = '.ntworkflow/runs/NT-001/';
const ROLES = ['--researcher-available', '--critic-available'];

test('E2E: researched planning boundary validates, rejects premature approval and completes with full provider parity', async () => {
  await withProviders(fixture => {
    const intake = fixture.session('intake');
    intake.cli('run', 'start', '--session-id', intake.owner);
    intake.cli('phase', 'begin', 'nttask', '--session-id', intake.owner);
    fixture.write(RUN + 'BRIEF.md', readFileSync('tests/fixtures/briefs/grilled.md'));
    intake.cli('phase', 'complete', 'nttask', '--session-id', intake.owner);
    const grill = fixture.session('grill');
    grill.cli('phase', 'begin', 'ntgrill', '--session-id', grill.owner);
    grill.cli('phase', 'complete', 'ntgrill', '--session-id', grill.owner, '--user-confirmed');
    const planner = fixture.session('planner');
    planner.reject(14, 'ARTIFACT_FAILURE', 'phase', 'begin', 'ntplan', '--session-id', planner.owner);
    planner.cli('phase', 'begin', 'ntplan', '--session-id', planner.owner, ...ROLES);
    // Recorded primary synthesis and native role outcomes, not model reasoning evidence.
    for (const file of ['SPEC.md', 'PLAN.md', 'NT-001-01.md', 'NT-001-02.md']) {
      fixture.write(RUN + (file.startsWith('NT-') ? 'tasks/' : '') + file, readFileSync('tests/fixtures/plans/' + file));
    }
    planner.cli('plan', 'validate', '--session-id', planner.owner);
    planner.reject(2, 'INVALID_INPUT', 'phase', 'complete', 'ntplan', '--session-id', planner.owner, '--user-confirmed');
    planner.reject(2, 'INVALID_INPUT', 'phase', 'complete', 'ntplan', '--session-id', planner.owner, '--critic-pass');
    const packet = readFileSync('tests/fixtures/plans/NT-001-02.md', 'utf8');
    fixture.write(RUN + 'tasks/NT-001-02.md', packet.replace('AC-2', 'AC-1'));
    planner.reject(14, 'ARTIFACT_FAILURE', 'plan', 'validate', '--session-id', planner.owner);
    planner.reject(14, 'ARTIFACT_FAILURE', 'phase', 'complete', 'ntplan', '--session-id', planner.owner, '--critic-pass', '--user-confirmed');
    fixture.write(RUN + 'tasks/NT-001-02.md', packet);
    planner.cli('plan', 'validate', '--session-id', planner.owner);
    const completed = planner.cli('phase', 'complete', 'ntplan', '--session-id', planner.owner, '--critic-pass', '--user-confirmed');
    assert.equal(completed.state?.current?.lifecycle, 'plan-approved');
    assert.equal(completed.state.current.owner, null);
    assert.deepEqual(completed.state.current.work?.tasks.map(t => t.task_id), ['NT-001-01', 'NT-001-02']);
    const late = fixture.session('late');
    late.reject(11, 'ILLEGAL_TRANSITION', 'phase', 'begin', 'ntplan', '--session-id', late.owner, ...ROLES);
    late.cli('plan', 'validate', '--session-id', late.owner);
  });
});

test('E2E: planning interruption, cross-provider takeover, missing role and cancellation preserve drafts', async () => {
  await withProviders(fixture => {
    const state = JSON.parse(readFileSync('tests/fixtures/states/plan-ready.json', 'utf8'));
    state.current.phase = null;
    state.current.owner = null;
    fixture.write('.ntworkflow/state.json', JSON.stringify(state));
    fixture.write(RUN + 'BRIEF.md', readFileSync('tests/fixtures/briefs/grilled.md'));
    const primary = fixture.session();
    primary.cli('phase', 'begin', 'ntplan', '--session-id', primary.owner, ...ROLES);
    fixture.write(RUN + 'SPEC.md', '# Partial research-backed draft\n');
    primary.reject(12, 'OWNERSHIP_CONFLICT', 'phase', 'begin', 'ntplan', '--session-id', primary.owner, ...ROLES);
    const other = fixture.otherSession();
    other.reject(12, 'OWNERSHIP_CONFLICT', 'phase', 'begin', 'ntplan', '--session-id', other.owner, ...ROLES);
    other.cli('phase', 'begin', 'ntplan', '--session-id', other.owner, ...ROLES, '--interruption', 'user-confirmed');
    primary.reject(12, 'OWNERSHIP_CONFLICT', 'plan', 'validate', '--session-id', primary.owner);
    other.cli('phase', 'stop', 'ntplan', '--session-id', other.owner, '--blocker', 'Required critic is unavailable.');
    other.reject(13, 'UNRESOLVED_BLOCKER', 'phase', 'begin', 'ntplan', '--session-id', other.owner, ...ROLES);
    other.reject(14, 'ARTIFACT_FAILURE', 'phase', 'begin', 'ntplan', '--session-id', other.owner, '--researcher-available', '--blocker-resolved');
    other.cli('phase', 'begin', 'ntplan', '--session-id', other.owner, ...ROLES, '--blocker-resolved');
    other.cli('run', 'cancel', '--session-id', other.owner, '--user-confirmed');
    assert.equal(fixture.read(RUN + 'SPEC.md'), '# Partial research-backed draft\n');
  });
});
