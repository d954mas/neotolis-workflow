import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { withProviders } from './harness.ts';

const BRIEF = readFileSync('tests/fixtures/briefs/valid.md', 'utf8');
const AGREED = readFileSync('tests/fixtures/briefs/grilled.md', 'utf8');
const PATH = '.ntworkflow/runs/NT-001/BRIEF.md';

test('E2E: intake → fresh grilling → confirmed brief → plan-ready with full provider parity', async () => {
  await withProviders((fixture) => {
    const intake = fixture.session('intake');
    intake.cli('run', 'start', '--session-id', intake.owner);
    intake.cli('phase', 'begin', 'nttask', '--session-id', intake.owner);
    fixture.write(PATH, BRIEF);
    intake.cli('phase', 'complete', 'nttask', '--session-id', intake.owner);
    const grill = fixture.session('grill');
    grill.cli('phase', 'begin', 'ntgrill', '--session-id', grill.owner);
    assert.equal(fixture.read(PATH), BRIEF);
    grill.reject(2, 'INVALID_INPUT', 'phase', 'complete', 'ntgrill', '--session-id', grill.owner);
    grill.reject(14, 'ARTIFACT_FAILURE', 'phase', 'complete', 'ntgrill', '--session-id', grill.owner, '--user-confirmed');
    // Recorded confirmed synthesis, not evidence of a live model's interview quality.
    fixture.write(PATH, AGREED);
    const result = grill.cli('phase', 'complete', 'ntgrill', '--session-id', grill.owner, '--user-confirmed');
    assert.deepEqual(result.state?.current, {
      run_id: 'NT-001', lifecycle: 'plan-ready', phase: null,
      owner: null, blocker: null, work: null,
    });
    assert.equal(result.next_action.skill, 'ntplan');
    const fresh = fixture.session('later');
    const invalid = fresh.reject(11, 'ILLEGAL_TRANSITION', 'phase', 'begin', 'ntgrill', '--session-id', fresh.owner);
    assert.equal(invalid.next_action.skill, 'ntplan');
    assert.equal(fixture.read(PATH), AGREED);
  });
});

test('E2E: grilling restart, takeover, blocker and cancel preserve the canonical brief', async () => {
  await withProviders((fixture) => {
    fixture.write('.ntworkflow/state.json', JSON.stringify({
      next_work_number: 2,
      current: { run_id: 'NT-001', lifecycle: 'brief-ready', phase: null, owner: null, blocker: null, work: null },
    }));
    fixture.write(PATH, BRIEF);
    const grill = fixture.session('grill');
    grill.cli('phase', 'begin', 'ntgrill', '--session-id', grill.owner);
    const resumed = fixture.session('grill'); // Recorded native identity reuse.
    resumed.reject(12, 'OWNERSHIP_CONFLICT', 'phase', 'begin', 'ntgrill', '--session-id', resumed.owner);
    resumed.cli('phase', 'begin', 'ntgrill', '--session-id', resumed.owner, '--interruption', 'user-confirmed');
    const other = fixture.otherSession();
    other.reject(12, 'OWNERSHIP_CONFLICT', 'phase', 'begin', 'ntgrill', '--session-id', other.owner);
    other.cli('phase', 'begin', 'ntgrill', '--session-id', other.owner, '--interruption', 'provider-ended');
    resumed.reject(12, 'OWNERSHIP_CONFLICT', 'phase', 'complete', 'ntgrill', '--session-id', resumed.owner, '--user-confirmed');
    other.cli('phase', 'stop', 'ntgrill', '--session-id', other.owner, '--blocker', 'Недоступен источник.');
    other.reject(13, 'UNRESOLVED_BLOCKER', 'phase', 'begin', 'ntgrill', '--session-id', other.owner);
    other.cli('phase', 'begin', 'ntgrill', '--session-id', other.owner, '--blocker-resolved');
    other.cli('run', 'cancel', '--session-id', other.owner, '--user-confirmed');
    assert.equal(fixture.read(PATH), BRIEF);
    assert.equal(JSON.parse(fixture.read('.ntworkflow/state.json')).current, null);
  });
});
