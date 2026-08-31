import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';

import type { ProtocolResponse } from '../../src/core/protocol.ts';
import type { State } from '../../src/core/state.ts';
import { loadCorpus, normalizeBytes } from '../conformance/harness.ts';

const { adapters } = loadCorpus('tests/conformance/scenarios.json');
type Adapter = (typeof adapters)[number];
type Response = ProtocolResponse<State | null>;

function tree(root: string, directory = root): Record<string, Buffer | 'directory'> {
  const entries: Record<string, Buffer | 'directory'> = {};
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    const key = relative(root, path).split(sep).join('/');
    if (entry.isDirectory()) {
      entries[`${key}/`] = 'directory';
      Object.assign(entries, tree(root, path));
    } else entries[key] = readFileSync(path);
  }
  return Object.fromEntries(Object.entries(entries).sort(([a], [b]) => a.localeCompare(b)));
}

class Fixture {
  // Match the CLI native realpath, including Windows 8.3 temporary paths.
  readonly root = realpathSync.native(mkdtempSync(join(tmpdir(), 'ntworkflow-e2e пробел ')));
  readonly results: unknown[] = [];
  readonly identities = new Map<string, string>();
  readonly adapter: Adapter;
  constructor(adapter: Adapter) {
    this.adapter = adapter;
    const git = spawnSync('git', ['init', '--quiet', '--initial-branch=main', this.root], {
      encoding: 'utf8',
    });
    assert.equal(git.status, 0, git.stderr);
    this.write('.gitignore', 'user-owned-ignore-rule\n');
    this.write('user.txt', 'Не менять существующую работу.\n');
    this.write('user.bin', Buffer.from([0, 0x80, 0x81, 0xff]));
  }

  tree() { return tree(this.root); }
  read(path: string) { return readFileSync(join(this.root, path), 'utf8'); }
  write(path: string, content: string | Buffer) {
    const target = join(this.root, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }

  session(id = 'primary', adapter = this.adapter) {
    const sessionId = `recorded-${id}`;
    const payload = {
      ...adapter.payload, session_id: sessionId, cwd: this.root,
      transcript_path: adapter.payload.transcript_path === null
        ? null : join(this.root, 'claude-transcript.jsonl'),
    };
    const hook = spawnSync(process.execPath, [resolve(adapter.session_start), resolve(adapter.runtime)], {
      encoding: 'utf8', input: JSON.stringify(payload),
    });
    assert.equal(hook.status, 0, hook.stderr);
    assert.equal(hook.stderr, '');
    const output = JSON.parse(hook.stdout) as {
      hookSpecificOutput: { hookEventName: string; additionalContext: string };
    };
    assert.equal(output.hookSpecificOutput.hookEventName, 'SessionStart');
    const marker = 'Neotolis Workflow runtime context: ';
    assert.ok(output.hookSpecificOutput.additionalContext.startsWith(marker));
    const context = JSON.parse(output.hookSpecificOutput.additionalContext.slice(marker.length)) as {
      owner: string; cwd: string; cli: string;
    };
    assert.deepEqual(context, {
      owner: `${adapter.provider}:${sessionId}`, cwd: this.root, cli: realpathSync(adapter.runtime),
    });
    this.identities.set(context.owner, `<provider>:<${id}>`);

    const command = (arguments_: string[], exitCode = 0): Response => {
      const result = spawnSync(process.execPath, [context.cli, '--cwd', context.cwd, ...arguments_], {
        encoding: 'utf8',
      });
      assert.equal(result.status, exitCode, `${result.stdout}\n${result.stderr}`);
      assert.equal(result.stderr, '');
      assert.equal(result.stdout.trim().split('\n').length, 1);
      const response = JSON.parse(result.stdout) as Response;
      assert.equal(response.ok, exitCode === 0);
      assert.equal(response.project_root, this.root);
      assert.deepEqual(response.warnings, []);
      this.results.push({ exitCode, response, tree: this.tree() });
      return response;
    };
    return {
      ...context,
      cli: (...arguments_: string[]) => command(arguments_),
      // Recorded skill boundary only; model interpretation belongs to the live smoke.
      intake: (text: string) => text.trim() === '' ? null : command(['status']),
      reject: (exitCode: number, code: string, ...arguments_: string[]) => {
        const before = this.tree();
        const response = command(arguments_, exitCode);
        assert.ok(!response.ok);
        assert.equal(response.error.code, code);
        assert.equal(response.error.exit_code, exitCode);
        assert.deepEqual(this.tree(), before);
        return response;
      },
    };
  }

  otherSession() {
    const other = adapters.find((entry) => entry.provider !== this.adapter.provider);
    assert.ok(other);
    return this.session('takeover', other);
  }

  normalize(value: unknown): unknown {
    if (Buffer.isBuffer(value)) {
      return normalizeBytes(value, new Map([[this.root, '<fixture>'], ...this.identities]));
    }
    if (typeof value === 'string') {
      let result = value.replaceAll(this.root, '<fixture>');
      for (const [owner, label] of this.identities) result = result.replaceAll(owner, label);
      return result;
    }
    if (Array.isArray(value)) return value.map((entry) => this.normalize(entry));
    if (typeof value !== 'object' || value === null) return value;
    return Object.fromEntries(Object.entries(value)
      .map(([key, entry]) => [key, this.normalize(entry)]));
  }
}

export async function withProviders(scenario: (fixture: Fixture) => void | Promise<void>) {
  assert.deepEqual(adapters.map(({ provider }) => provider), ['claude', 'codex']);
  const results: unknown[] = [];
  for (const adapter of adapters) {
    const fixture = new Fixture(adapter);
    try {
      const before = fixture.tree();
      await scenario(fixture);
      const after = fixture.tree();
      for (const [path, content] of Object.entries(before)) assert.deepEqual(after[path], content, path);
      results.push(fixture.normalize({ steps: fixture.results, tree: after }));
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  }
  assert.deepEqual(results[1], results[0], 'Claude/Codex results and filesystem parity');
}
