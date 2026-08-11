import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import test, { before } from 'node:test';

interface BuiltErrors {
  ERROR_CODES: Record<string, string>;
  EXIT_CODES: Record<string, number>;
  WorkflowError: new (options: {
    code: string;
    message: string;
  }) => Error;
}

interface BuiltProtocol {
  createFailureResponse: (context: {
    operation: string;
    projectRoot: string;
    state: null;
    nextAction: string;
    warnings: string[];
    error: Error;
  }) => {
    error: { code: string; exit_code: number };
  };
}

function listFiles(root: string, directory = root): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFiles(root, absolutePath));
    } else {
      files.push(relative(root, absolutePath).replaceAll('\\', '/'));
    }
  }
  return files.sort();
}

before(() => {
  const buildResult = spawnSync(process.execPath, ['scripts/build.mjs'], {
    encoding: 'utf8',
  });
  assert.equal(buildResult.status, 0, buildResult.stderr);
});

test('built modules preserve workflow error identity and stable exit codes', async () => {
  const cacheKey = `review-fix-${Date.now()}`;
  const errors = await import(
    `${pathToFileURL(resolve('build/core/errors.mjs')).href}?${cacheKey}`
  ) as BuiltErrors;
  const protocol = await import(
    `${pathToFileURL(resolve('build/core/protocol.mjs')).href}?${cacheKey}`
  ) as BuiltProtocol;

  for (const [name, code] of Object.entries(errors.ERROR_CODES)) {
    const response = protocol.createFailureResponse({
      operation: 'test',
      projectRoot: '/work/project',
      state: null,
      nextAction: 'None.',
      warnings: [],
      error: new errors.WorkflowError({ code, message: name }),
    });

    assert.deepEqual(response.error, {
      code,
      exit_code: errors.EXIT_CODES[name],
      message: name,
      details: null,
    });
  }
});

test('build output is exactly the TB-01 runtime manifest', () => {
  const outputFiles = listFiles(resolve('build'));
  const chunkFiles = outputFiles.filter((file) => file.startsWith('chunks/'));

  assert.deepEqual(
    outputFiles.filter((file) => !file.startsWith('chunks/')),
    ['core/errors.mjs', 'core/protocol.mjs'],
  );
  assert.equal(chunkFiles.length, 1);
  assert.match(chunkFiles[0] ?? '', /^chunks\/chunk-[A-Z0-9]+\.mjs$/);
});

test('artifact traversal includes hidden files without touching the real build', () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'ntworkflow-manifest-'));
  const hiddenDirectory = join(fixtureRoot, '.codex-plugin');
  try {
    mkdirSync(hiddenDirectory);
    writeFileSync(join(hiddenDirectory, 'plugin.json'), '{}');

    assert.deepEqual(listFiles(fixtureRoot), ['.codex-plugin/plugin.json']);
  } finally {
    rmSync(fixtureRoot, { force: true, recursive: true });
  }
});
