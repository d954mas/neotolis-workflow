import { globSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const [suite, ...extraArguments] = process.argv.slice(2);
const pattern = suite === undefined
  ? 'tests/**/*.test.ts'
  : suite === 'provider-claude'
    ? 'tests/providers/claude-code/**/*.test.ts'
    : suite === 'provider-codex'
      ? 'tests/providers/codex/**/*.test.ts'
    : `tests/${suite}/**/*.test.ts`;
const testFiles = globSync(pattern).sort();

if (testFiles.length === 0) {
  console.error(`No tests found for ${suite === undefined ? 'the full suite' : `suite "${suite}"`}.`);
  process.exitCode = 2;
} else {
  const result = spawnSync(
    process.execPath,
    ['--test', ...extraArguments, ...testFiles],
    { stdio: 'inherit' },
  );

  process.exitCode = result.status ?? 70;
}
