import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';

interface Adapter {
  readonly provider: 'claude' | 'codex';
  readonly session_start: string;
  readonly runtime: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

interface Seed {
  readonly path: string;
  readonly text: string;
}

interface CliStep {
  readonly cli: readonly string[];
}

interface WriteStep {
  readonly write: {
    readonly path: string;
    readonly fixture: string;
  };
}

interface GitStep {
  readonly git: readonly string[];
}

type Step = CliStep | WriteStep | GitStep;

interface Scenario {
  readonly name: string;
  readonly git: boolean;
  readonly seed?: readonly Seed[];
  readonly steps: readonly Step[];
}

export interface Corpus {
  readonly format: 1;
  readonly adapters: readonly Adapter[];
  readonly scenarios: readonly Scenario[];
}

interface StepResult {
  readonly exit_class: number;
  readonly response: unknown;
  readonly filesystem_hashes: Readonly<Record<string, string>>;
}

interface ScenarioResult {
  readonly name: string;
  readonly steps: readonly StepResult[];
}

export interface CorpusResult {
  readonly scenarios: readonly ScenarioResult[];
}

export function loadCorpus(path: string): Corpus {
  return JSON.parse(readFileSync(path, 'utf8')) as Corpus;
}

function replaceFixtureToken(value: unknown, fixture: string): unknown {
  if (typeof value === 'string') return value.replaceAll('<fixture>', fixture);
  if (Array.isArray(value)) return value.map((entry) => replaceFixtureToken(entry, fixture));
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => (
    [key, replaceFixtureToken(entry, fixture)]
  )));
}

function runtimeContext(adapter: Adapter, fixture: string): {
  readonly owner: string;
  readonly cli: string;
  readonly cwd: string;
} {
  const payload = replaceFixtureToken({ ...adapter.payload, cwd: fixture }, fixture);
  const result = spawnSync(
    process.execPath,
    [resolve(adapter.session_start), resolve(adapter.runtime)],
    { encoding: 'utf8', input: JSON.stringify(payload) },
  );
  if (result.status !== 0) throw new Error(result.stderr);

  const output = JSON.parse(result.stdout) as {
    hookSpecificOutput: { additionalContext: string };
  };
  const marker = 'Neotolis Workflow runtime context: ';
  return JSON.parse(
    output.hookSpecificOutput.additionalContext.slice(marker.length),
  ) as { owner: string; cli: string; cwd: string };
}

export function normalizeBytes(bytes: Buffer, replacements: ReadonlyMap<string, string>): Buffer {
  // Latin-1 maps every byte one-to-one; UTF-8 decoding would erase invalid byte differences.
  let normalized = bytes.toString('latin1');
  for (const [from, to] of replacements) {
    normalized = normalized.replaceAll(
      Buffer.from(from).toString('latin1'), Buffer.from(to).toString('latin1'),
    );
  }
  return Buffer.from(normalized, 'latin1');
}

function normalizedString(
  value: string,
  fixture: string,
  owner: string,
  otherOwner: string,
  key: string,
): string {
  const normalized = value
    .replaceAll(realpathSync(fixture), '<fixture>')
    .replaceAll(fixture, '<fixture>')
    .replaceAll(owner, '<provider>:<session-primary>')
    .replaceAll(otherOwner, '<provider>:<session-secondary>');
  return (key === 'provider' || key.endsWith('_provider'))
    && (normalized === 'claude' || normalized === 'codex')
    ? '<provider>' : normalized;
}

function normalize(
  value: unknown,
  fixture: string,
  owner: string,
  otherOwner: string,
  key = '',
): unknown {
  if (typeof value === 'string') {
    return normalizedString(value, fixture, owner, otherOwner, key);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => normalize(entry, fixture, owner, otherOwner, key));
  }
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(Object.entries(value).map(([entryKey, entry]) => (
    [entryKey, normalize(entry, fixture, owner, otherOwner, entryKey)]
  )));
}

function filesUnder(root: string, directory = root): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...filesUnder(root, path));
    else files.push(relative(root, path).replaceAll('\\', '/'));
  }
  return files.sort();
}

function filesystemHashes(
  fixture: string,
  owner: string,
  otherOwner: string,
): Readonly<Record<string, string>> {
  return Object.fromEntries(filesUnder(fixture)
    .filter((path) => !path.startsWith('.git/'))
    .map((path) => {
      const bytes = readFileSync(join(fixture, ...path.split('/')));
      const replacements = new Map([
        [realpathSync(fixture), '<fixture>'], [fixture, '<fixture>'],
        [owner, '<provider>:<session-primary>'], [otherOwner, '<provider>:<session-secondary>'],
      ]);
      if (path === '.ntworkflow/state.json') {
        replacements.set('"provider": "claude"', '"provider": "<provider>"');
        replacements.set('"provider": "codex"', '"provider": "<provider>"');
      }
      const normalized = normalizeBytes(bytes, replacements);
      return [path, createHash('sha256').update(normalized).digest('hex')];
    }));
}

function commandArguments(
  arguments_: readonly string[],
  owner: string,
  otherOwner: string,
  fixture: string,
): string[] {
  return arguments_.map((argument) => (
    argument === '$owner' ? owner
      : argument === '$other_owner' ? otherOwner
        : argument === '$head'
          ? spawnSync('git', ['rev-parse', 'HEAD'], { cwd: fixture, encoding: 'utf8' }).stdout.trim()
          : argument
  ));
}

function runScenario(corpusScenario: Scenario, adapter: Adapter): ScenarioResult {
  // Match the CLI native realpath, including Windows 8.3 temporary paths.
  const fixture = realpathSync.native(mkdtempSync(join(tmpdir(), `ntworkflow-conformance-${adapter.provider}-`)));
  try {
    if (corpusScenario.git) {
      const initialized = spawnSync('git', ['init', '--quiet', '--initial-branch=main'], {
        cwd: fixture,
        encoding: 'utf8',
      });
      assert.equal(initialized.status, 0, initialized.stderr);
    }
    for (const seed of corpusScenario.seed ?? []) {
      const path = join(fixture, ...seed.path.split('/'));
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, seed.text);
    }

    const context = runtimeContext(adapter, fixture);
    assert.equal(
      context.owner,
      `${adapter.provider}:${String(adapter.payload.session_id)}`,
    );
    assert.equal(context.cwd, realpathSync(fixture));
    const otherOwner = `${adapter.provider}:recorded-secondary`;
    const results: StepResult[] = [];
    for (const step of corpusScenario.steps) {
      if ('write' in step) {
        const path = join(fixture, ...step.write.path.split('/'));
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, readFileSync(step.write.fixture));
        continue;
      }
      if ('git' in step) {
        const result = spawnSync('git', step.git, {
          cwd: fixture,
          encoding: 'utf8',
          env: {
            ...process.env,
            GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z',
            GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z',
          },
        });
        assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
        continue;
      }

      const command = spawnSync(
        process.execPath,
        [
          context.cli,
          '--cwd', context.cwd,
          ...commandArguments(step.cli, context.owner, otherOwner, fixture),
        ],
        { encoding: 'utf8' },
      );
      assert.equal(command.stderr, '');
      assert.equal(command.stdout.trim().split('\n').length, 1);
      const response = JSON.parse(command.stdout) as unknown;
      results.push({
        exit_class: command.status ?? 70,
        response: normalize(response, fixture, context.owner, otherOwner),
        filesystem_hashes: filesystemHashes(fixture, context.owner, otherOwner),
      });
    }
    return { name: corpusScenario.name, steps: results };
  } finally {
    rmSync(fixture, { force: true, recursive: true });
  }
}

export function runProviderCorpus(corpus: Corpus, adapter: Adapter): CorpusResult {
  return { scenarios: corpus.scenarios.map((scenario) => runScenario(scenario, adapter)) };
}
