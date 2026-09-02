import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { cliResponse, runCli } from '../phase/helpers.ts';
import { tree } from '../e2e/harness.ts';

export const OWNER = 'codex:planning-primary';
export const ROLES = ['--researcher-available', '--critic-available'];
export function planningFixture() {
  const root = mkdtempSync(join(tmpdir(), 'ntworkflow-plan пробел '));
  mkdirSync(join(root, '.git'));
  mkdirSync(join(root, '.ntworkflow/runs/NT-001'), { recursive: true });
  const state = JSON.parse(readFileSync('tests/fixtures/states/plan-ready.json', 'utf8'));
  state.current.phase = null;
  state.current.owner = null;
  writeFileSync(join(root, '.ntworkflow/state.json'), JSON.stringify(state));
  writeFileSync(join(root, '.ntworkflow/runs/NT-001/BRIEF.md'), readFileSync('tests/fixtures/briefs/grilled.md'));
  return root;
}

test('planning requires both native roles before acquiring ownership; restart remains explicit', () => {
  const root = planningFixture();
  const call = (operation: string, owner = OWNER, ...args: string[]) =>
    runCli(root, 'phase', operation, 'ntplan', '--session-id', owner, ...args);
  const reject = (exit: number, operation: string, owner = OWNER, ...args: string[]) => {
    const before = tree(root);
    const result = call(operation, owner, ...args);
    assert.equal(result.status, exit, result.stdout);
    assert.deepEqual(tree(root), before);
    return cliResponse(result);
  };
  try {
    reject(14, 'begin');
    reject(14, 'begin', OWNER, '--researcher-available');
    reject(14, 'begin', OWNER, '--critic-available');
    assert.equal(call('begin', OWNER, ...ROLES).status, 0);
    const active = cliResponse(runCli(root, 'status'));
    assert.equal(active.state.current?.lifecycle, 'plan-ready');
    assert.equal(active.state.current?.phase, 'ntplan');
    assert.equal(active.next_action.instruction, 'Continue the active ntplan phase.');
    reject(12, 'begin', OWNER, ...ROLES);
    reject(12, 'begin', 'claude:other', ...ROLES);
    assert.equal(call('begin', 'claude:other', ...ROLES, '--interruption', 'user-confirmed').status, 0);
    reject(12, 'stop', OWNER, '--blocker', 'Not mine.');
    assert.equal(call('stop', 'claude:other', '--blocker', 'Required source unavailable.').status, 0);
    reject(13, 'begin', OWNER, ...ROLES);
    assert.match(cliResponse(runCli(root, 'status')).next_action.instruction, /--blocker-resolved/);
    assert.equal(call('begin', OWNER, ...ROLES, '--blocker-resolved').status, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('planning refuses invalid state, confirmed brief and held lock without touching drafts', () => {
  const root = planningFixture();
  const statePath = join(root, '.ntworkflow/state.json');
  const brief = join(root, '.ntworkflow/runs/NT-001/BRIEF.md');
  const call = () => runCli(root, 'phase', 'begin', 'ntplan', '--session-id', OWNER, ...ROLES);
  try {
    const state = readFileSync(statePath);
    const agreed = readFileSync(brief);
    for (const content of [null, '# Partial', agreed.toString() + '\n## Open questions\nNone.\n', Buffer.from([255])]) {
      if (content === null) rmSync(brief); else writeFileSync(brief, content);
      const before = tree(root);
      assert.equal(call().status, 14);
      assert.deepEqual(tree(root), before);
    }
    writeFileSync(brief, agreed);
    writeFileSync(statePath, '{broken');
    const corrupt = tree(root);
    assert.equal(call().status, 10);
    assert.deepEqual(tree(root), corrupt);
    writeFileSync(statePath, state);
    writeFileSync(join(root, '.ntworkflow/.state.lock'), 'held');
    const locked = tree(root);
    assert.equal(call().status, 15);
    assert.deepEqual(tree(root), locked);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

for (const [lifecycle, next] of [
  ['intake-active', 'nttask'], ['brief-ready', 'ntgrill'], ['plan-approved', 'ntwork'],
  ['work-active', 'ntwork'], ['delivery-ready', 'nttask'], ['no-active-run', 'nttask'],
]) {
  test(`ntplan rejects ${lifecycle} with the state-specific next action and no mutation`, () => {
    const root = planningFixture();
    try {
      writeFileSync(join(root, '.ntworkflow/state.json'), readFileSync(`tests/fixtures/states/${lifecycle}.json`));
      for (const operation of ['begin', 'complete', 'stop']) {
        const before = tree(root);
        const result = runCli(root, 'phase', operation, 'ntplan', '--session-id', OWNER,
          ...(operation === 'begin' ? ROLES : operation === 'complete' ? ['--critic-pass', '--user-confirmed'] : ['--blocker', 'Stop.']));
        assert.equal(result.status, 11, result.stdout);
        assert.equal(cliResponse(result).next_action.skill, next);
        assert.deepEqual(tree(root), before);
      }
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
}
