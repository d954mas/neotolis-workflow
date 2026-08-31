import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { startRun } from '../../src/runtime/run.ts';
import { withProviders } from './harness.ts';

const BRIEF = readFileSync('tests/fixtures/briefs/valid.md', 'utf8');
const READY = {
  next_work_number: 2,
  current: {
    run_id: 'NT-001', lifecycle: 'brief-ready', phase: null,
    owner: null, blocker: null, work: null,
  },
};

test('E2E: empty intake, first start, native ownership, Unicode completion and fresh re-entry', async () => {
  await withProviders((fixture) => {
    const initial = fixture.tree();
    const session = fixture.session();
    assert.equal(session.intake(' \t\n'), null);
    assert.equal(fixture.results.length, 0);
    assert.deepEqual(fixture.tree(), initial);

    assert.equal(session.intake('Экспорт https://example.com/отчёты')?.state, null);
    const started = session.cli('run', 'start', '--session-id', session.owner);
    assert.deepEqual(started.state, {
      next_work_number: 2,
      current: {
        run_id: 'NT-001', lifecycle: 'intake-active', phase: null,
        owner: null, blocker: null, work: null,
      },
    });
    assert.deepEqual(Object.keys(fixture.tree()).filter((path) => !(path in initial)), [
      '.ntworkflow/', '.ntworkflow/runs/', '.ntworkflow/runs/NT-001/', '.ntworkflow/state.json',
    ]);
    const begun = session.cli('phase', 'begin', 'nttask', '--session-id', session.owner);
    assert.deepEqual(begun.state?.current?.owner, { session_id: session.owner });
    assert.equal(begun.state?.current?.phase, 'nttask');

    fixture.write('.ntworkflow/runs/NT-001/BRIEF.md', BRIEF);
    const completed = session.cli('phase', 'complete', 'nttask', '--session-id', session.owner);
    assert.deepEqual(completed.state, READY);
    assert.equal(completed.next_action.skill, 'ntgrill');
    assert.equal(fixture.read('.ntworkflow/runs/NT-001/BRIEF.md'), BRIEF);
    assert.deepEqual(JSON.parse(fixture.read('.ntworkflow/state.json')), READY);

    const beforeReentry = fixture.tree();
    const fresh = fixture.session('fresh');
    assert.notEqual(fresh.owner, session.owner);
    const reentry = fresh.intake('Продолжить задачу');
    assert.deepEqual(reentry?.state, READY);
    assert.equal(reentry?.next_action.skill, 'ntgrill');
    fresh.reject(11, 'ILLEGAL_TRANSITION', 'phase', 'begin', 'nttask', '--session-id', fresh.owner);
    assert.deepEqual(fixture.tree(), beforeReentry);
  });
});

test('E2E: competing owner, confirmed cross-provider takeover and cancellation preserve the run', async () => {
  await withProviders((fixture) => {
    const session = fixture.session();
    session.cli('run', 'start', '--session-id', session.owner);
    session.cli('phase', 'begin', 'nttask', '--session-id', session.owner);
    fixture.write('.ntworkflow/runs/NT-001/BRIEF.md', '# Незаконченный brief\n');

    const competitor = fixture.session('competitor');
    competitor.reject(12, 'OWNERSHIP_CONFLICT', 'phase', 'begin', 'nttask', '--session-id', competitor.owner);
    const other = fixture.otherSession();
    assert.notEqual(other.owner.split(':')[0], session.owner.split(':')[0]);
    other.reject(12, 'OWNERSHIP_CONFLICT', 'phase', 'begin', 'nttask', '--session-id', other.owner);
    const takeover = other.cli(
      'phase', 'begin', 'nttask', '--session-id', other.owner, '--interruption', 'user-confirmed',
    );
    assert.deepEqual(takeover.state?.current?.owner, { session_id: other.owner });
    assert.equal(takeover.state?.current?.phase, 'nttask');
    session.reject(12, 'OWNERSHIP_CONFLICT', 'phase', 'complete', 'nttask', '--session-id', session.owner);
    other.reject(2, 'INVALID_INPUT', 'run', 'cancel', '--session-id', other.owner);
    const beforeCancel = fixture.tree();
    const canceled = other.cli('run', 'cancel', '--session-id', other.owner, '--user-confirmed');
    assert.deepEqual(canceled.state, { next_work_number: 2, current: null });
    assert.deepEqual(fixture.tree(), {
      ...beforeCancel, '.ntworkflow/state.json': Buffer.from(fixture.read('.ntworkflow/state.json')),
    });
    const restarted = other.cli('run', 'start', '--session-id', other.owner);
    assert.equal(restarted.state?.current?.run_id, 'NT-002');
    assert.equal(fixture.read('.ntworkflow/runs/NT-001/BRIEF.md'), '# Незаконченный brief\n');
  });
});

for (const failure of ['corruption', 'invalid BRIEF', 'held lock', 'partial directory'] as const) {
  test(`E2E: ${failure} stops without repair`, async () => {
    await withProviders((fixture) => {
      const session = fixture.session();
      if (failure === 'partial directory') {
        fixture.write('.ntworkflow/state.json', '{"next_work_number":1,"current":null}\n');
        fixture.write('.ntworkflow/runs/NT-001/sentinel.txt', 'Не удалять.\n');
        session.reject(15, 'PARTIAL_RUN', 'run', 'start', '--session-id', session.owner);
        return;
      }
      session.cli('run', 'start', '--session-id', session.owner);
      if (failure === 'corruption') {
        fixture.write('.ntworkflow/state.json', '{not-json}\n');
        session.reject(10, 'INVALID_STATE', 'status');
        session.reject(10, 'INVALID_STATE', 'run', 'start', '--session-id', session.owner);
      } else if (failure === 'held lock') {
        fixture.write('.ntworkflow/.state.lock', '{"pid":123,"token":"held-by-fixture"}\n');
        session.reject(15, 'LOCK_CONFLICT', 'phase', 'begin', 'nttask', '--session-id', session.owner);
      } else {
        session.cli('phase', 'begin', 'nttask', '--session-id', session.owner);
        fixture.write('.ntworkflow/runs/NT-001/BRIEF.md', '# Некорректный BRIEF\n');
        session.reject(14, 'ARTIFACT_FAILURE', 'phase', 'complete', 'nttask', '--session-id', session.owner);
      }
    });
  });
}

const DELIVERY = readFileSync('tests/fixtures/states/delivery-ready.json', 'utf8');

test('E2E: delivery-ready replacement selects the next run and preserves the delivered artifacts', async () => {
  await withProviders((fixture) => {
    fixture.write('.ntworkflow/state.json', DELIVERY);
    fixture.write('.ntworkflow/runs/NT-1000/BRIEF.md', BRIEF);
    const session = fixture.session();
    const before = fixture.tree();
    assert.equal(session.intake(' \n'), null);
    assert.deepEqual(fixture.tree(), before);
    assert.equal(session.intake('Следующая задача')?.state?.current?.lifecycle, 'delivery-ready');
    const replacement = session.cli('run', 'start', '--session-id', session.owner);
    assert.deepEqual(replacement.state, {
      next_work_number: 1002,
      current: {
        run_id: 'NT-1001', lifecycle: 'intake-active', phase: null,
        owner: null, blocker: null, work: null,
      },
    });
    assert.equal(fixture.read('.ntworkflow/runs/NT-1000/BRIEF.md'), BRIEF);
    assert.deepEqual(fixture.tree(), {
      ...before,
      '.ntworkflow/runs/NT-1001/': 'directory',
      '.ntworkflow/state.json': Buffer.from(fixture.read('.ntworkflow/state.json')),
    });
    session.cli('phase', 'begin', 'nttask', '--session-id', session.owner);
  });
});

for (const failCommit of [false, true]) {
  test(`E2E: delivery replacement commit boundary (injected failure: ${String(failCommit)})`, async () => {
    await withProviders(async (fixture) => {
      fixture.write('.ntworkflow/state.json', DELIVERY);
      fixture.write('.ntworkflow/runs/NT-1000/BRIEF.md', BRIEF);
      const session = fixture.session();
      let commits = 0;
      let beforeRename: { state: string; directory: Buffer | 'directory' | undefined } | undefined;
      // Use the existing transaction seam; the public CLI has no fault/repair option.
      const operation = startRun(fixture.root, { sessionId: session.owner }, {
        faultInjector: (point) => {
          if (point !== 'before-rename') return;
          commits += 1;
          beforeRename = {
            state: fixture.read('.ntworkflow/state.json'),
            directory: fixture.tree()['.ntworkflow/runs/NT-1001/'],
          };
          if (failCommit) throw new Error('recorded replacement failure');
        },
      });
      if (failCommit) {
        await assert.rejects(operation, { code: 'COMMIT_FAILURE', exitCode: 16 });
        assert.equal(fixture.read('.ntworkflow/state.json'), DELIVERY);
        session.reject(15, 'PARTIAL_RUN', 'run', 'start', '--session-id', session.owner);
      } else {
        const result = await operation;
        assert.equal(result.state.current?.run_id, 'NT-1001');
        assert.deepEqual(result.warnings, []);
      }
      assert.equal(commits, 1);
      assert.deepEqual(beforeRename, { state: DELIVERY, directory: 'directory' });
      assert.equal(fixture.read('.ntworkflow/runs/NT-1000/BRIEF.md'), BRIEF);
      session.cli('status');
      assert.deepEqual(Object.keys(fixture.tree()).filter((path) => path.startsWith('.ntworkflow/')), [
        '.ntworkflow/', '.ntworkflow/runs/', '.ntworkflow/runs/NT-1000/',
        '.ntworkflow/runs/NT-1000/BRIEF.md', '.ntworkflow/runs/NT-1001/', '.ntworkflow/state.json',
      ]);
    });
  });
}
