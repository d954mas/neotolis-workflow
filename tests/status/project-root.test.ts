import assert from 'node:assert/strict';
import { chmod, mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import { ERROR_CODES, WorkflowError } from '../../src/core/errors.ts';
import {
  canonicalizeCwd,
  resolveProjectRoot,
} from '../../src/runtime/project-root.ts';

async function temporaryDirectory(name: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `ntworkflow-${name}-`));
}

test('canonicalizes an accessible cwd and rejects missing or non-directory paths', async () => {
  const fixture = join('tests', 'fixtures', 'consumer-repos', 'empty');
  const canonical = await canonicalizeCwd(fixture);

  assert.equal(canonical, await realpath(resolve(fixture)));

  for (const invalidPath of [join(fixture, 'missing'), join(fixture, '.gitkeep')]) {
    await assert.rejects(
      canonicalizeCwd(invalidPath),
      (error: unknown) => {
        assert.ok(error instanceof WorkflowError);
        assert.equal(error.code, ERROR_CODES.INVALID_INPUT);
        assert.equal(error.exitCode, 2);
        return true;
      },
    );
  }
});

test(
  'rejects a cwd that cannot be traversed',
  {
    skip: process.platform === 'win32' || process.getuid?.() === 0,
  },
  async () => {
    const root = await temporaryDirectory('inaccessible-cwd');
    const cwd = join(root, 'locked');
    await mkdir(cwd);
    await chmod(cwd, 0o000);

    try {
      await assert.rejects(
        canonicalizeCwd(cwd),
        (error: unknown) => {
          assert.ok(error instanceof WorkflowError);
          assert.equal(error.code, ERROR_CODES.INVALID_INPUT);
          assert.equal(error.exitCode, 2);
          return true;
        },
      );
    } finally {
      await chmod(cwd, 0o700);
      await rm(root, { force: true, recursive: true });
    }
  },
);

test('resolves the nearest ancestor containing a .git directory', async () => {
  const root = await temporaryDirectory('git-root');
  try {
    const outer = join(root, 'outer');
    const nearest = join(outer, 'packages', 'consumer');
    const cwd = join(nearest, 'src', 'nested');
    await mkdir(join(outer, '.git'), { recursive: true });
    await mkdir(join(nearest, '.git'), { recursive: true });
    await mkdir(cwd, { recursive: true });

    assert.equal(await resolveProjectRoot(cwd), await realpath(nearest));
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test('resolves a worktree root from a .git file', async () => {
  const root = await temporaryDirectory('worktree-root');
  try {
    const worktree = join(root, 'consumer-worktree');
    const cwd = join(worktree, 'src', 'nested');
    await mkdir(cwd, { recursive: true });
    await writeFile(join(worktree, '.git'), 'gitdir: ../metadata/worktrees/consumer\n');

    assert.equal(await resolveProjectRoot(cwd), await realpath(worktree));
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test('uses the canonical supplied cwd when no Git ancestor exists', async () => {
  const root = await temporaryDirectory('no-git-root');
  try {
    const cwd = join(root, 'standalone', 'nested');
    await mkdir(cwd, { recursive: true });

    assert.equal(await resolveProjectRoot(cwd), await realpath(cwd));
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test('ignores a malformed .git file and continues to an outer Git root', async () => {
  const root = await temporaryDirectory('malformed-worktree-root');
  try {
    const outer = join(root, 'outer');
    const nested = join(outer, 'nested');
    const cwd = join(nested, 'src');
    await mkdir(join(outer, '.git'), { recursive: true });
    await mkdir(cwd, { recursive: true });
    await writeFile(join(nested, '.git'), 'not a gitdir\n');

    assert.equal(await resolveProjectRoot(cwd), await realpath(outer));
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
