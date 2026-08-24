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

for (const title of ['# #', '# ###   '] as const) {
  test(`closing hashes do not make an empty H1 non-empty: ${title}`, async () => {
    const root = mkdtempSync(join(tmpdir(), 'ntworkflow-empty-h1-'));
    const run = join(root, '.ntworkflow', 'runs', 'NT-001');
    const briefPath = join(run, 'BRIEF.md');
    const brief = `${title}

## Brief
Intent.

## Repository context
Context.

## Success
Outcome.
`;

    try {
      mkdirSync(run, { recursive: true });
      writeFileSync(briefPath, brief);
      const before = readFileSync(briefPath);

      await assert.rejects(
        validateNttaskBrief(root, 'NT-001'),
        (error: unknown) => {
          assert.ok(error instanceof WorkflowError);
          assert.equal(error.code, ERROR_CODES.ARTIFACT_FAILURE);
          return true;
        },
      );
      assert.deepEqual(readFileSync(briefPath), before);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
}
