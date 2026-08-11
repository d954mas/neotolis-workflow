import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, realpath, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { ERROR_CODES, WorkflowError } from '../../src/core/errors.ts';
import { readPreflight } from '../../src/runtime/preflight.ts';

interface TreeSnapshot {
  readonly [path: string]: string;
}

async function snapshotTree(root: string, directory = root): Promise<TreeSnapshot> {
  const snapshot: Record<string, string> = {};
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolutePath = join(directory, entry.name);
    const relativePath = absolutePath.slice(root.length + 1).replaceAll('\\', '/');
    if (entry.isDirectory()) {
      snapshot[`${relativePath}/`] = 'directory';
      Object.assign(snapshot, await snapshotTree(root, absolutePath));
    } else {
      snapshot[relativePath] = (await readFile(absolutePath)).toString('base64');
    }
  }
  return snapshot;
}

async function temporaryProject(name: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `ntworkflow-${name}-`));
}

test('preflight returns null for absent state without changing the project tree', async () => {
  const project = await temporaryProject('absent-state');
  try {
    const cwd = join(project, 'src', 'nested');
    await mkdir(join(project, '.git'), { recursive: true });
    await mkdir(cwd, { recursive: true });
    await writeFile(join(cwd, 'consumer.txt'), 'unchanged\n');
    const before = await snapshotTree(project);

    const result = await readPreflight(cwd);

    assert.equal(result.projectRoot, await realpath(project));
    assert.equal(result.state, null);
    assert.deepEqual(await snapshotTree(project), before);
  } finally {
    await rm(project, { force: true, recursive: true });
  }
});

test('preflight parses an existing state through the strict state model without mutation', async () => {
  const project = await temporaryProject('existing-state');
  try {
    const cwd = join(project, 'nested');
    const workflowDirectory = join(project, '.ntworkflow');
    const fixture = await readFile(
      join('tests', 'fixtures', 'states', 'brief-ready.json'),
      'utf8',
    );
    await mkdir(join(project, '.git'), { recursive: true });
    await mkdir(cwd, { recursive: true });
    await mkdir(workflowDirectory);
    await writeFile(join(workflowDirectory, 'state.json'), fixture);
    const before = await snapshotTree(project);

    const result = await readPreflight(cwd);

    assert.equal(result.state?.current?.lifecycle, 'brief-ready');
    assert.deepEqual(await snapshotTree(project), before);
  } finally {
    await rm(project, { force: true, recursive: true });
  }
});

test('preflight rejects malformed state as invalid state without mutation', async () => {
  const project = await temporaryProject('invalid-state');
  try {
    const workflowDirectory = join(project, '.ntworkflow');
    await mkdir(join(project, '.git'));
    await mkdir(workflowDirectory);
    await writeFile(join(workflowDirectory, 'state.json'), '{not-json}\n');
    const before = await snapshotTree(project);

    await assert.rejects(
      readPreflight(project),
      (error: unknown) => {
        assert.ok(error instanceof WorkflowError);
        assert.equal(error.code, ERROR_CODES.INVALID_STATE);
        assert.equal(error.exitCode, 10);
        return true;
      },
    );
    assert.deepEqual(await snapshotTree(project), before);
  } finally {
    await rm(project, { force: true, recursive: true });
  }
});

test('preflight rejects malformed UTF-8 instead of normalizing state text', async () => {
  const project = await temporaryProject('invalid-utf8-state');
  try {
    const workflowDirectory = join(project, '.ntworkflow');
    const source = Buffer.concat([
      Buffer.from('{"next_work_number":2,"current":{"run_id":"NT-001","lifecycle":"brief-ready","phase":null,"owner":null,"blocker":"'),
      Buffer.from([0xff]),
      Buffer.from('","work":null}}\n'),
    ]);
    await mkdir(workflowDirectory);
    await writeFile(join(workflowDirectory, 'state.json'), source);
    const before = await snapshotTree(project);

    await assert.rejects(
      readPreflight(project),
      (error: unknown) => {
        assert.ok(error instanceof WorkflowError);
        assert.equal(error.code, ERROR_CODES.INVALID_STATE);
        return true;
      },
    );
    assert.deepEqual(await snapshotTree(project), before);
  } finally {
    await rm(project, { force: true, recursive: true });
  }
});

test('preflight rejects a non-regular state path instead of treating it as absent', async () => {
  const project = await temporaryProject('non-file-state');
  try {
    await mkdir(join(project, '.ntworkflow', 'state.json'), { recursive: true });
    const before = await snapshotTree(project);

    await assert.rejects(
      readPreflight(project),
      (error: unknown) => {
        assert.ok(error instanceof WorkflowError);
        assert.equal(error.code, ERROR_CODES.INVALID_STATE);
        return true;
      },
    );
    assert.deepEqual(await snapshotTree(project), before);
  } finally {
    await rm(project, { force: true, recursive: true });
  }
});

test('preflight rejects a linked workflow directory without reading external state', async () => {
  const project = await temporaryProject('linked-workflow-project');
  const external = await temporaryProject('linked-workflow-external');
  try {
    const fixture = await readFile(
      join('tests', 'fixtures', 'states', 'brief-ready.json'),
    );
    await writeFile(join(external, 'state.json'), fixture);
    await symlink(
      external,
      join(project, '.ntworkflow'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    const before = await readFile(join(external, 'state.json'));

    await assert.rejects(
      readPreflight(project),
      (error: unknown) => {
        assert.ok(error instanceof WorkflowError);
        assert.equal(error.code, ERROR_CODES.INVALID_STATE);
        assert.equal(error.exitCode, 10);
        return true;
      },
    );
    assert.deepEqual(await readFile(join(external, 'state.json')), before);
  } finally {
    await rm(project, { force: true, recursive: true });
    await rm(external, { force: true, recursive: true });
  }
});
