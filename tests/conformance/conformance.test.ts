import assert from 'node:assert/strict';
import test from 'node:test';

import { loadCorpus, runProviderCorpus } from './harness.ts';

test('recorded Claude and Codex adapters have equivalent runtime semantics', () => {
  const corpus = loadCorpus('tests/conformance/scenarios.json');
  const results = corpus.adapters.map((adapter) => runProviderCorpus(corpus, adapter));

  assert.deepEqual(corpus.adapters.map((adapter) => adapter.provider), ['claude', 'codex']);
  assert.equal(results[0]?.scenarios.length, 4);
  assert.deepEqual(results[1]?.scenarios, results[0]?.scenarios);
});
