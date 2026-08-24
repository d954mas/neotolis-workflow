import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { ERROR_CODES, WorkflowError } from '../../src/core/errors.ts';
import { validateNttaskBrief } from '../../src/runtime/artifacts.ts';

function runFixture(name: string): { root: string; brief: string } {
  const root = mkdtempSync(join(tmpdir(), `ntworkflow-artifact-${name}-`));
  const run = join(root, '.ntworkflow', 'runs', 'NT-001');
  mkdirSync(run, { recursive: true });
  return { root, brief: join(run, 'BRIEF.md') };
}

const REQUIRED_BRIEF = `# Task

## Brief
Intent.

## Repository context
Context.

## Success
Outcome.
`;

test('Open questions is optional and fenced headings are content', async () => {
  const fixture = runFixture('required-only');
  const markdown = REQUIRED_BRIEF.replace(
    'Intent.',
    'Intent.\n\n```md\n## Notes\n# Example title\n```',
  );
  try {
    writeFileSync(fixture.brief, markdown);
    await validateNttaskBrief(fixture.root, 'NT-001');
    assert.equal(readFileSync(fixture.brief, 'utf8'), markdown);
  } finally {
    rmSync(fixture.root, { force: true, recursive: true });
  }
});

test('BRIEF must be a regular file', async () => {
  const fixture = runFixture('directory');
  try {
    mkdirSync(fixture.brief);
    await assert.rejects(
      validateNttaskBrief(fixture.root, 'NT-001'),
      (error: unknown) => {
        assert.ok(error instanceof WorkflowError);
        assert.equal(error.code, ERROR_CODES.ARTIFACT_FAILURE);
        return true;
      },
    );
  } finally {
    rmSync(fixture.root, { force: true, recursive: true });
  }
});

test('invalid UTF-8 is rejected instead of replacement-decoded', async () => {
  const fixture = runFixture('invalid-utf8');
  try {
    const valid = Buffer.from(REQUIRED_BRIEF, 'utf8');
    const success = valid.indexOf(Buffer.from('Outcome.'));
    const corrupted = Buffer.concat([
      valid.subarray(0, success),
      Buffer.from([0xc3, 0x28]),
      valid.subarray(success),
    ]);
    writeFileSync(fixture.brief, corrupted);
    const before = readFileSync(fixture.brief);

    await assert.rejects(
      validateNttaskBrief(fixture.root, 'NT-001'),
      (error: unknown) => {
        assert.ok(error instanceof WorkflowError);
        assert.equal(error.code, ERROR_CODES.ARTIFACT_FAILURE);
        return true;
      },
    );
    assert.deepEqual(readFileSync(fixture.brief), before);
  } finally {
    rmSync(fixture.root, { force: true, recursive: true });
  }
});
