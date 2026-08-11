import assert from 'node:assert/strict';
import {
  globSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
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
  }) => Error & { readonly exitCode: number };
}

interface BuiltProtocol {
  createFailureResponse: (context: {
    operation: string;
    projectRoot: string;
    state: null;
    nextAction: { skill: null; instruction: string };
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

function expectedEntryFiles(): string[] {
  const sourceRoot = resolve('src');

  return globSync('src/**/*.ts')
    .map((sourceFile) => {
      const entry = relative(sourceRoot, resolve(sourceFile))
        .replaceAll('\\', '/')
        .slice(0, -3);
      const output = entry === 'cli/main' ? 'cli/ntworkflow' : entry;
      return `${output}.mjs`;
    })
    .sort();
}

function snapshotTree(root: string, directory = root): Record<string, string> {
  const snapshot: Record<string, string> = {};
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = join(directory, entry.name);
    const relativePath = relative(root, absolutePath).replaceAll('\\', '/');
    if (entry.isDirectory()) {
      snapshot[`${relativePath}/`] = 'directory';
      Object.assign(snapshot, snapshotTree(root, absolutePath));
    } else {
      snapshot[relativePath] = readFileSync(absolutePath).toString('base64');
    }
  }
  return snapshot;
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
    const error = new errors.WorkflowError({ code, message: name });
    const response = protocol.createFailureResponse({
      operation: 'test',
      projectRoot: '/work/project',
      state: null,
      nextAction: { skill: null, instruction: 'None.' },
      warnings: [],
      error,
    });

    assert.deepEqual(response.error, {
      code,
      exit_code: error.exitCode,
      message: name,
      details: null,
    });
  }
});

test('build output follows source entries and exposes only the TB-03 CLI', () => {
  const outputFiles = listFiles(resolve('build'));
  const entryFiles = outputFiles.filter((file) => !file.startsWith('chunks/'));
  const chunkFiles = outputFiles.filter((file) => file.startsWith('chunks/'));

  assert.deepEqual(entryFiles, expectedEntryFiles());
  assert.deepEqual(
    entryFiles.filter((file) => file.startsWith('cli/')),
    [
      'cli/arguments.mjs',
      'cli/ntworkflow.mjs',
    ],
  );
  assert.equal(chunkFiles.length > 0, true);
  for (const chunkFile of chunkFiles) {
    assert.match(chunkFile, /^chunks\/chunk-[A-Z0-9]+\.mjs$/);
  }
});

test('built status resolves nested Git, worktree, and no-Git roots without mutation', () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'ntworkflow-built-status-'));
  try {
    const gitRoot = join(fixtureRoot, 'git-project');
    const gitCwd = join(gitRoot, 'src', 'nested');
    mkdirSync(join(gitRoot, '.git'), { recursive: true });
    mkdirSync(gitCwd, { recursive: true });

    const worktreeRoot = join(fixtureRoot, 'worktree-project');
    const worktreeCwd = join(worktreeRoot, 'src', 'nested');
    mkdirSync(worktreeCwd, { recursive: true });
    writeFileSync(
      join(worktreeRoot, '.git'),
      'gitdir: ../metadata/worktrees/consumer\n',
    );

    const noGitCwd = join(fixtureRoot, 'no-git', 'nested');
    mkdirSync(noGitCwd, { recursive: true });

    const cases = [
      { cwd: gitCwd, expectedRoot: gitRoot },
      { cwd: worktreeCwd, expectedRoot: worktreeRoot },
      { cwd: noGitCwd, expectedRoot: noGitCwd },
    ];

    for (const scenario of cases) {
      const before = snapshotTree(fixtureRoot);
      const result = spawnSync(
        process.execPath,
        [
          resolve('build', 'cli', 'ntworkflow.mjs'),
          '--cwd',
          scenario.cwd,
          'status',
        ],
        { encoding: 'utf8' },
      );
      const response = JSON.parse(result.stdout) as {
        ok: boolean;
        project_root: string;
        state: unknown;
        next_action: { skill: string };
      };

      assert.equal(result.status, 0, result.stderr);
      assert.equal(response.ok, true);
      assert.equal(response.project_root, realpathSync(scenario.expectedRoot));
      assert.equal(response.state, null);
      assert.equal(response.next_action.skill, 'nttask');
      assert.deepEqual(snapshotTree(fixtureRoot), before);
    }
  } finally {
    rmSync(fixtureRoot, { force: true, recursive: true });
  }
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
