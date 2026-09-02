import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('package metadata locks the Node and provider CLI contract', async () => {
  const packageJson = JSON.parse(await readFile('package.json', 'utf8')) as {
    name: string;
    type: string;
    engines: { node: string };
    dependencies?: Record<string, string>;
    devDependencies: Record<string, string>;
  };

  assert.equal(packageJson.name, '@neotolis/workflow');
  assert.equal(packageJson.type, 'module');
  assert.equal(packageJson.engines.node, '^24.0.0');
  assert.equal(packageJson.dependencies, undefined);
  assert.deepEqual(packageJson.devDependencies, {
    '@anthropic-ai/claude-code': '2.1.220',
    '@eslint/js': '10.0.1',
    '@openai/codex': '0.144.6',
    '@types/node': '24.13.3',
    esbuild: '0.28.2',
    eslint: '10.8.1',
    typescript: '6.0.3',
    'typescript-eslint': '8.67.0',
  });
  assert.equal((await readFile('.nvmrc', 'utf8')).replaceAll('\r\n', '\n'), '24\n');
});

test('lockfile root exactly matches the package development dependencies', async () => {
  const packageJson = JSON.parse(await readFile('package.json', 'utf8')) as {
    devDependencies: Record<string, string>;
  };
  const lockfile = JSON.parse(await readFile('package-lock.json', 'utf8')) as {
    packages: { '': { devDependencies: Record<string, string> } };
  };

  assert.deepEqual(lockfile.packages[''].devDependencies, packageJson.devDependencies);
});
