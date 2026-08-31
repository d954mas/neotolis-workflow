import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { loadCorpus, runProviderCorpus } from './harness.ts';

test('conformance hashes preserve different invalid UTF-8 bytes', () => {
  const root = mkdtempSync(join(tmpdir(), 'ntworkflow-binary-corpus-'));
  try {
    const first = join(root, 'first.bin');
    const second = join(root, 'second.bin');
    writeFileSync(first, Buffer.from([0x80]));
    writeFileSync(second, Buffer.from([0x81]));
    const corpus = loadCorpus('tests/conformance/scenarios.json');
    const scenarios = [{
      name: 'binary preservation', git: false,
      steps: [
        { write: { path: 'asset.bin', fixture: first } }, { cli: ['status'] },
        { write: { path: 'asset.bin', fixture: second } }, { cli: ['status'] },
      ],
    }];
    for (const adapter of corpus.adapters) {
      const result = runProviderCorpus({ ...corpus, scenarios }, adapter);
      assert.deepEqual(result.scenarios[0]?.steps.map((step) => step.filesystem_hashes['asset.bin']),
        [0x80, 0x81].map((byte) => createHash('sha256').update(Buffer.from([byte])).digest('hex')));
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
