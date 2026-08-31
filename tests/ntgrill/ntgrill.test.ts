import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { cliResponse, runCli } from '../phase/helpers.ts';
import { tree } from '../e2e/harness.ts';
import { completeNtgrillPhase } from '../../src/runtime/ntgrill.ts';
import { beginPhase } from '../../src/runtime/phase.ts';

const OWNER = 'codex:grill-primary';
const INTAKE = readFileSync('tests/fixtures/briefs/valid.md', 'utf8');
const AGREED = '# Экспорт\n\n## Brief\nТолько JSON, без зависимостей.\n\n## Repository context\nКаталог: src/catalog.mjs.\n\n## Success\nПартнёр получает файл.\n';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'ntworkflow-grill пробел '));
  mkdirSync(join(root, '.git'));
  writeFileSync(join(root, 'user.bin'), Buffer.from([0, 128, 255]));
  assert.equal(runCli(root, 'run', 'start', '--session-id', 'claude:intake').status, 0);
  assert.equal(runCli(root, 'phase', 'begin', 'nttask', '--session-id', 'claude:intake').status, 0);
  const brief = join(root, '.ntworkflow/runs/NT-001/BRIEF.md');
  writeFileSync(brief, INTAKE);
  assert.equal(runCli(root, 'phase', 'complete', 'nttask', '--session-id', 'claude:intake').status, 0);
  return { root, brief };
}

test('ntgrill claims brief-ready, preserves intake, and completes only an agreed brief', () => {
  const { root, brief } = fixture();
  try {
    const before = tree(root);
    const begun = runCli(root, 'phase', 'begin', 'ntgrill', '--session-id', OWNER);
    assert.equal(begun.status, 0, begun.stdout);
    assert.equal(cliResponse(begun).state.current?.phase, 'ntgrill');
    assert.equal(cliResponse(begun).state.current?.lifecycle, 'brief-ready');
    assert.equal(readFileSync(brief, 'utf8'), INTAKE);
    const active = tree(root);
    assert.equal(runCli(root, 'phase', 'complete', 'ntgrill', '--session-id', OWNER).status, 2);
    assert.deepEqual(tree(root), active);
    assert.equal(runCli(root, 'phase', 'complete', 'ntgrill', '--session-id', OWNER, '--user-confirmed').status, 14);
    assert.deepEqual(tree(root), active);
    writeFileSync(brief, AGREED);
    const completed = runCli(root, 'phase', 'complete', 'ntgrill', '--session-id', OWNER, '--user-confirmed');
    assert.equal(completed.status, 0, completed.stdout);
    assert.deepEqual(cliResponse(completed).state.current, {
      run_id: 'NT-001', lifecycle: 'plan-ready', phase: null,
      owner: null, blocker: null, work: null,
    });
    assert.equal(cliResponse(completed).next_action.skill, 'ntplan');
    assert.deepEqual(tree(root), {
      ...before,
      '.ntworkflow/state.json': readFileSync(join(root, '.ntworkflow/state.json')),
      '.ntworkflow/runs/NT-001/BRIEF.md': Buffer.from(AGREED),
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

for (const [lifecycle, next] of [
  ['intake-active', 'nttask'], ['plan-ready', 'ntplan'],
  ['plan-approved', 'ntwork'], ['work-active', 'ntwork'], ['delivery-ready', 'nttask'],
  ['no-active-run', 'nttask'],
]) {
  test(`ntgrill rejects ${lifecycle} without changing state or artifacts`, () => {
    const { root } = fixture();
    try {
      writeFileSync(join(root, '.ntworkflow/state.json'), readFileSync(`tests/fixtures/states/${lifecycle}.json`));
      for (const operation of ['begin', 'complete', 'stop']) {
        const before = tree(root);
        const result = runCli(root, 'phase', operation, 'ntgrill', '--session-id', OWNER,
          ...(operation === 'complete' ? ['--user-confirmed'] : operation === 'stop' ? ['--blocker', 'Stop.'] : []));
        assert.equal(result.status, 11, result.stdout);
        assert.equal(cliResponse(result).next_action.skill, next);
        assert.deepEqual(tree(root), before);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

test('ntgrill refuses corrupt state and held locks without repairing either', () => {
  const { root } = fixture();
  try {
    const statePath = join(root, '.ntworkflow/state.json');
    const valid = readFileSync(statePath);
    writeFileSync(statePath, '{broken');
    const corrupt = tree(root);
    assert.equal(runCli(root, 'phase', 'begin', 'ntgrill', '--session-id', OWNER).status, 10);
    assert.deepEqual(tree(root), corrupt);
    writeFileSync(statePath, valid);
    writeFileSync(join(root, '.ntworkflow/.state.lock'), 'fixture lock');
    const locked = tree(root);
    assert.equal(runCli(root, 'phase', 'begin', 'ntgrill', '--session-id', OWNER).status, 15);
    assert.deepEqual(tree(root), locked);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('ntgrill revalidates current BRIEF on completion, including an empty Open questions', () => {
  const { root, brief } = fixture();
  try {
    assert.equal(runCli(root, 'phase', 'begin', 'ntgrill', '--session-id', OWNER).status, 0);
    for (const content of [null, '# Partial\n', AGREED + '\n## Open questions\n', AGREED + '\n## Open questions\nNone.\n']) {
      if (content === null) rmSync(brief);
      else writeFileSync(brief, content);
      const before = tree(root);
      const result = runCli(root, 'phase', 'complete', 'ntgrill', '--session-id', OWNER, '--user-confirmed');
      assert.equal(result.status, 14, result.stdout);
      assert.deepEqual(tree(root), before);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('ntgrill rejects owners, supports explicit restart and blocker resolution', () => {
  const { root, brief } = fixture();
  const call = (operation: string, owner = OWNER, ...args: string[]) => runCli(
    root, 'phase', operation, 'ntgrill', '--session-id', owner, ...args,
  );
  const reject = (expected: number, operation: string, owner = OWNER, ...args: string[]) => {
    const before = tree(root);
    const result = call(operation, owner, ...args);
    assert.equal(result.status, expected, result.stdout);
    assert.equal(cliResponse(result).next_action.skill, 'ntgrill');
    assert.deepEqual(tree(root), before);
    return cliResponse(result);
  };
  try {
    assert.equal(call('begin').status, 0);
    reject(12, 'begin'); // Native disk resume does not silently reacquire the same owner.
    reject(12, 'begin', 'claude:other');
    reject(12, 'stop', 'claude:other', '--blocker', 'Not mine.');
    const conflict = reject(12, 'complete', 'claude:other', '--user-confirmed');
    assert.match(conflict.next_action.instruction, /phase begin ntgrill --interruption/);
    assert.equal(call('begin', OWNER, '--interruption', 'user-confirmed').status, 0);
    assert.equal(call('begin', 'claude:other', '--interruption', 'provider-ended').status, 0);
    assert.equal(call('stop', 'claude:other', '--blocker', 'Нужен ответ.').status, 0);
    reject(13, 'begin');
    const status = cliResponse(runCli(root, 'status'));
    assert.equal(status.next_action.skill, 'ntgrill');
    assert.match(status.next_action.instruction, /--blocker-resolved/);
    assert.equal(call('begin', OWNER, '--blocker-resolved').status, 0);
    assert.equal(readFileSync(brief, 'utf8'), INTAKE);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('ntgrill validates BRIEF before claiming ownership and rejects missing or invalid artifacts', () => {
  const { root, brief } = fixture();
  try {
    for (const content of [null, '# Partial\n', Buffer.from([255]), AGREED.replace('## Success', '## Unknown')]) {
      if (content === null) rmSync(brief);
      else writeFileSync(brief, content);
      const before = tree(root);
      const result = runCli(root, 'phase', 'begin', 'ntgrill', '--session-id', OWNER);
      assert.equal(result.status, 14, result.stdout);
      assert.equal(cliResponse(result).next_action.skill, 'ntgrill');
      assert.deepEqual(tree(root), before);
    }
    writeFileSync(brief, AGREED); // A brief without questions still enters mandatory grilling.
    assert.equal(runCli(root, 'phase', 'begin', 'ntgrill', '--session-id', OWNER).status, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a failed ntgrill state commit preserves the rewritten brief and the old state', async () => {
  const { root, brief } = fixture();
  try {
    await beginPhase(root, 'ntgrill', { sessionId: OWNER });
    writeFileSync(brief, AGREED);
    const before = tree(root);
    await assert.rejects(completeNtgrillPhase(root, { sessionId: OWNER, userConfirmed: false }));
    assert.deepEqual(tree(root), before);
    await assert.rejects(completeNtgrillPhase(root, { sessionId: OWNER, userConfirmed: true }, {
      faultInjector(point) {
        assert.deepEqual(tree(root)['.ntworkflow/state.json'], before['.ntworkflow/state.json']);
        if (point === 'before-rename') throw new Error('Injected commit failure.');
      },
    }), { code: 'COMMIT_FAILURE' });
    assert.deepEqual(tree(root), before);
    const completed = await completeNtgrillPhase(root, { sessionId: OWNER, userConfirmed: true });
    assert.equal(completed.state.current?.lifecycle, 'plan-ready');
    assert.equal(readFileSync(brief, 'utf8'), AGREED);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
