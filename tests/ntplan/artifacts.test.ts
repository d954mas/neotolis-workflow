import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { validatePlanArtifacts } from '../../src/runtime/plan-artifacts.ts';
import { tree } from '../e2e/harness.ts';

test('complete planning artifacts derive stable task order without changing files', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ntworkflow-plan-artifacts-'));
  const run = join(root, '.ntworkflow/runs/NT-001');
  mkdirSync(join(run, 'tasks'), { recursive: true });
  for (const file of ['SPEC.md', 'PLAN.md', 'NT-001-01.md', 'NT-001-02.md']) {
    cpSync(join('tests/fixtures/plans', file), join(run, file.startsWith('NT-') ? 'tasks' : '', file));
  }
  const before = tree(root);
  try {
    assert.deepEqual(await validatePlanArtifacts(root, 'NT-001'), ['NT-001-01', 'NT-001-02']);
    assert.deepEqual(tree(root), before);
    const cases: Array<[string, (source: string) => string | Buffer]> = [
      ['SPEC.md', s => s.replace('AC-2:', 'AC-1:')],
      ['SPEC.md', s => s + '\n- AC-4: Unowned outcome.\n'],
      ['SPEC.md', s => s.replace('## Scope', '## Other')],
      ['SPEC.md', () => Buffer.from([255])],
      ['PLAN.md', s => s.replace('2. NT-001-02', '2. NT-001-01')],
      ['PLAN.md', s => s.replace('1. NT-001-01\n2. NT-001-02', '1. NT-001-02\n2. NT-001-01')],
      ['PLAN.md', s => s.replace('- NT-001-02: NT-001-01', '- NT-001-02: none')],
      ['PLAN.md', s => s.replace('- NT-001-01: Verified serializer.', '- NT-001-02: Duplicate task.')],
      ['PLAN.md', s => s.replace('AC-3:', 'AC-9:')],
      ['PLAN.md', s => s.replace('- AC-3: Run', '```md\n- AC-3: Run').replace('final task.', 'final task.\n```')],
      ['tasks/NT-001-02.md', s => s.replace('## Verification', '## Notes')],
      ['tasks/NT-001-02.md', s => s.replace('## Dependencies\nNT-001-01', '## Dependencies\nNT-001-09')],
      ['tasks/NT-001-02.md', s => s.replace('AC-2', 'AC-1')],
      ['tasks/NT-001-02.md', s => s.replace('# NT-001-02:', '# NT-001-01:')],
      ['tasks/NT-001-01.md', s => s.replace('## Dependencies\nnone', '## Dependencies\nNT-001-02')],
      ['tasks/NT-001-01.md', s => s.replace('## Goal\nProduce deterministic catalog JSON.', '## Goal\n<!-- empty -->')],
    ];
    for (const [file, change] of cases) {
      const path = join(run, file);
      const original = readFileSync(path);
      writeFileSync(path, change(original.toString()));
      const invalid = tree(root);
      await assert.rejects(validatePlanArtifacts(root, 'NT-001'), { code: 'ARTIFACT_FAILURE' }, file);
      assert.deepEqual(tree(root), invalid);
      writeFileSync(path, original);
    }
    rmSync(join(run, 'tasks/NT-001-02.md'));
    await assert.rejects(validatePlanArtifacts(root, 'NT-001'), { code: 'ARTIFACT_FAILURE' });
    rmSync(join(run, 'tasks/NT-001-01.md'));
    await assert.rejects(validatePlanArtifacts(root, 'NT-001'), { code: 'ARTIFACT_FAILURE' });
  } finally { rmSync(root, { recursive: true, force: true }); }
});
