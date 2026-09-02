import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import type { ChildProcessWithoutNullStreams, SpawnSyncReturns } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import test from 'node:test';
import { buildSync } from 'esbuild';

const CODEX = resolve('node_modules/@openai/codex/bin/codex.js');
const REMOTE_PLUGIN_OFF = ['-c', 'features.remote_plugin=false'];

type JsonObject = Record<string, unknown>;
type PluginListResult = {
  installed: Array<{
    pluginId: string;
    name: string;
    marketplaceName: string;
    version: string;
    installed: boolean;
    enabled: boolean;
  }>;
  available: unknown[];
};
type SkillsListResult = {
  data: Array<{
    cwd: string;
    skills: Array<{ name: string; enabled: boolean }>;
    errors: Array<unknown>;
  }>;
};
type HookMetadata = {
  key: string;
  eventName: string;
  command: string | null;
  sourcePath: string;
  source: string;
  pluginId: string | null;
  enabled: boolean;
  currentHash: string;
  trustStatus: string;
};
type HooksListResult = {
  data: Array<{
    cwd: string;
    hooks: HookMetadata[];
    warnings: string[];
    errors: Array<{ path: string; message: string }>;
  }>;
};

function isolatedEnvironment(codexHome: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    CODEX_HOME: codexHome,
    HOME: codexHome,
    USERPROFILE: codexHome,
  };
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

function stageMarketplace(root: string): string {
  const marketplace = join(root, 'marketplace');
  mkdirSync(join(marketplace, '.agents', 'plugins'), { recursive: true });
  mkdirSync(join(marketplace, 'plugins'), { recursive: true });
  cpSync(
    'marketplaces/codex/marketplace.json',
    join(marketplace, '.agents', 'plugins', 'marketplace.json'),
  );
  cpSync(
    'plugins/codex',
    join(marketplace, 'plugins', 'neotolis-workflow'),
    { recursive: true },
  );
  return marketplace;
}

function runCodex(
  codexHome: string,
  cwd: string,
  ...arguments_: string[]
): SpawnSyncReturns<string> {
  return spawnSync(
    process.execPath,
    [CODEX, ...REMOTE_PLUGIN_OFF, ...arguments_],
    {
      cwd,
      encoding: 'utf8',
      env: isolatedEnvironment(codexHome),
    },
  );
}

function expectSuccess(result: SpawnSyncReturns<string>): void {
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
}

async function removeEventually(path: string): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      rmSync(path, { force: true, recursive: true });
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (
        attempt >= 40
        || (code !== 'EBUSY' && code !== 'ENOTEMPTY' && code !== 'EPERM')
      ) {
        throw error;
      }
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
    }
  }
}

class AppServer {
  readonly #child: ChildProcessWithoutNullStreams;
  readonly #pending = new Map<number, {
    resolve: (value: JsonObject) => void;
    reject: (error: Error) => void;
  }>();
  #buffer = '';
  #stderr = '';

  constructor(codexHome: string, cwd: string) {
    this.#child = spawn(
      process.execPath,
      [CODEX, ...REMOTE_PLUGIN_OFF, 'app-server', '--stdio'],
      {
        cwd,
        env: isolatedEnvironment(codexHome),
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
    this.#child.stdout.setEncoding('utf8');
    this.#child.stderr.setEncoding('utf8');
    this.#child.stdout.on('data', (chunk: string) => {
      this.#buffer += chunk;
      for (;;) {
        const newline = this.#buffer.indexOf('\n');
        if (newline < 0) break;
        const line = this.#buffer.slice(0, newline).trim();
        this.#buffer = this.#buffer.slice(newline + 1);
        if (line.length === 0) continue;
        const message = JSON.parse(line) as JsonObject;
        const id = message.id;
        if (typeof id !== 'number') continue;
        const pending = this.#pending.get(id);
        if (pending === undefined) continue;
        this.#pending.delete(id);
        if (message.error !== undefined) {
          pending.reject(new Error(JSON.stringify(message.error)));
          continue;
        }
        if (
          typeof message.result !== 'object'
          || message.result === null
          || Array.isArray(message.result)
        ) {
          pending.reject(new Error(`Invalid app-server result: ${line}`));
          continue;
        }
        pending.resolve(message.result as JsonObject);
      }
    });
    this.#child.stderr.on('data', (chunk: string) => {
      this.#stderr += chunk;
    });
    this.#child.on('exit', (code) => {
      for (const pending of this.#pending.values()) {
        pending.reject(new Error(`app-server exited with ${String(code)}: ${this.#stderr}`));
      }
      this.#pending.clear();
    });
  }

  async initialize(): Promise<void> {
    await this.request(0, 'initialize', {
      clientInfo: {
        name: 'neotolis_workflow_tests',
        title: 'Neotolis Workflow Tests',
        version: '0.0.0',
      },
    });
    this.notify('initialized', {});
  }

  request<Result extends JsonObject = JsonObject>(
    id: number,
    method: string,
    params: JsonObject,
  ): Promise<Result> {
    const response = new Promise<JsonObject>((resolvePromise, reject) => {
      this.#pending.set(id, { resolve: resolvePromise, reject });
    });
    this.#child.stdin.write(`${JSON.stringify({ method, id, params })}\n`);
    return response as Promise<Result>;
  }

  notify(method: string, params: JsonObject): void {
    this.#child.stdin.write(`${JSON.stringify({ method, params })}\n`);
  }

  async close(): Promise<void> {
    if (this.#child.exitCode !== null) return;
    const exited = new Promise<void>((resolvePromise) => {
      this.#child.once('exit', () => resolvePromise());
    });
    this.#child.stdin.end();
    const timeout = setTimeout(() => this.#child.kill(), 2_000);
    await exited;
    clearTimeout(timeout);
  }
}

test('pinned Codex installs and discovers the staged plugin without a model call', {
  timeout: 30_000,
}, async () => {
  const root = mkdtempSync(join(tmpdir(), 'ntworkflow-codex-install-'));
  const marketplace = stageMarketplace(root);
  const codexHome = join(root, 'codex-home');
  const project = join(root, 'project');
  mkdirSync(codexHome);
  mkdirSync(project);
  writeFileSync(
    join(codexHome, 'config.toml'),
    '[features]\nplugins = true\nhooks = true\nremote_plugin = false\n',
  );

  try {
    const version = runCodex(codexHome, project, '--version');
    expectSuccess(version);
    assert.equal(version.stdout.trim(), 'codex-cli 0.144.6');

    const add = runCodex(
      codexHome,
      project,
      'plugin', 'marketplace', 'add', marketplace, '--json',
    );
    expectSuccess(add);

    const install = runCodex(
      codexHome,
      project,
      'plugin', 'add', 'neotolis-workflow@neotolis-local', '--json',
    );
    expectSuccess(install);

    const list = runCodex(codexHome, project, 'plugin', 'list', '--json');
    expectSuccess(list);
    const listed = JSON.parse(list.stdout) as PluginListResult;
    assert.ok(Array.isArray(listed.installed), list.stdout);
    assert.ok(Array.isArray(listed.available), list.stdout);
    const plugin = listed.installed.find(
      (entry) => entry.pluginId === 'neotolis-workflow@neotolis-local',
    );
    assert.ok(plugin !== undefined, list.stdout);
    assert.equal(plugin.name, 'neotolis-workflow', list.stdout);
    assert.equal(plugin.marketplaceName, 'neotolis-local', list.stdout);
    assert.equal(plugin.version, '0.0.0', list.stdout);
    assert.equal(plugin.installed, true, list.stdout);
    assert.equal(plugin.enabled, true, list.stdout);

    const server = new AppServer(codexHome, project);
    let installPath: string;
    try {
      await server.initialize();
      const skillsResponse = await server.request<SkillsListResult>(1, 'skills/list', {
        cwds: [project],
        forceReload: true,
      });
      assert.equal(skillsResponse.data.length, 1);
      assert.equal(realpathSync(skillsResponse.data[0]?.cwd as string), realpathSync(project));
      assert.deepEqual(skillsResponse.data[0]?.errors, []);
      const skills = skillsResponse.data[0]?.skills.filter(
        (entry) => entry.name.startsWith('neotolis-workflow:'),
      );
      assert.deepEqual(skills?.map(({ name }) => name).sort(), [
        'neotolis-workflow:ntgrill', 'neotolis-workflow:ntplan',
        'neotolis-workflow:nttask', 'neotolis-workflow:ntwork',
      ]);
      assert.ok(skills?.every(({ enabled }) => enabled));

      const hooksResponse = await server.request<HooksListResult>(2, 'hooks/list', {
        cwds: [project],
      });
      assert.equal(hooksResponse.data.length, 1);
      assert.equal(realpathSync(hooksResponse.data[0]?.cwd as string), realpathSync(project));
      assert.deepEqual(hooksResponse.data[0]?.errors, []);
      const hook = hooksResponse.data[0]?.hooks.find((entry) => (
        entry.pluginId === 'neotolis-workflow@neotolis-local'
        && entry.eventName === 'sessionStart'
      ));
      assert.ok(hook !== undefined, JSON.stringify(hooksResponse));
      assert.equal(hook.enabled, true);
      assert.equal(hook.trustStatus, 'untrusted');
      assert.equal(hook.source, 'plugin');
      assert.equal(typeof hook.currentHash, 'string');

      installPath = realpathSync(join(hook.sourcePath, '..', '..'));
      assert.deepEqual(filesUnder(installPath), [
        '.codex-plugin/plugin.json',
    'agents/ntplan_critic.toml',
    'agents/ntplan_researcher.toml',
    'agents/ntwork_code_reviewer.toml',
    'agents/ntwork_implementer.toml',
    'agents/ntwork_nyquist_auditor.toml',
    'agents/ntwork_spec_integration_reviewer.toml',
    'agents/ntwork_task_reviewer.toml',
        'hooks/hooks.json',
        'runtime/ntworkflow.mjs',
        'runtime/session-start.mjs',
        'skills/ntgrill/LICENSE',
    'skills/ntgrill/SKILL.md',
    'skills/ntplan/SKILL.md',
    'skills/nttask/SKILL.md',
    'skills/ntwork/SKILL.md',
      ]);
      assert.equal(
        hook.command,
        `node "${join(installPath, 'runtime', 'session-start.mjs')}" `
          + `"${join(installPath, 'runtime', 'ntworkflow.mjs')}"`,
      );

      const key = hook.key;
      assert.equal(typeof key, 'string');
      await server.request(3, 'config/batchWrite', {
        edits: [{
          keyPath: 'hooks.state',
          value: { [key as string]: { enabled: false } },
          mergeStrategy: 'upsert',
        }],
        reloadUserConfig: true,
      });
      const disabledResponse = await server.request<HooksListResult>(4, 'hooks/list', {
        cwds: [project],
      });
      const disabled = disabledResponse.data[0]?.hooks.find((entry) => entry.key === key);
      assert.ok(disabled !== undefined, JSON.stringify(disabledResponse));
      assert.equal(disabled.enabled, false);
      // Pinned Codex discovers user-configured roles; plugin installation alone
      // does not register agents/. Use its native config API, never a loader.
      const roleNames = [
        'ntplan_researcher', 'ntplan_critic', 'ntwork_implementer',
        'ntwork_task_reviewer', 'ntwork_nyquist_auditor',
        'ntwork_spec_integration_reviewer', 'ntwork_code_reviewer',
      ];
      const roles = Object.fromEntries(roleNames.map(role => [
        role, { config_file: join(installPath, 'agents', `${role}.toml`) },
      ]));
      await server.request(5, 'config/batchWrite', {
        edits: [{ keyPath: 'agents', value: roles, mergeStrategy: 'upsert' }],
        reloadUserConfig: true,
      });
      const configured = await server.request(6, 'config/read', { cwd: project, includeLayers: false });
      const config = configured.config as JsonObject;
      assert.deepEqual(config.agents, {
        max_threads: null, max_depth: null, job_max_runtime_seconds: null, interrupt_message: null,
        ...Object.fromEntries(Object.entries(roles).map(([name, definition]) => [
          name, { ...definition, description: null, nickname_candidates: null },
        ])),
      });
      const started = await server.request(7, 'thread/start', { cwd: project, ephemeral: true });
      assert.equal((started.thread as JsonObject).cwd, project);
    } finally {
      await server.close();
    }

    assert.equal(existsSync(join(project, '.ntworkflow')), false);

    const payload = JSON.stringify({
      session_id: 'recorded-native-session',
      transcript_path: null,
      cwd: project,
      hook_event_name: 'SessionStart',
      source: 'startup',
    });
    const nativeHook = spawnSync(
      process.execPath,
      [
        join(installPath, 'runtime', 'session-start.mjs'),
        join(installPath, 'runtime', 'ntworkflow.mjs'),
      ],
      { encoding: 'utf8', input: payload },
    );
    expectSuccess(nativeHook);
    const nativeOutput = JSON.parse(nativeHook.stdout) as {
      hookSpecificOutput: { additionalContext: string };
    };
    const marker = 'Neotolis Workflow runtime context: ';
    assert.ok(nativeOutput.hookSpecificOutput.additionalContext.startsWith(marker));
    assert.deepEqual(
      JSON.parse(nativeOutput.hookSpecificOutput.additionalContext.slice(marker.length)),
      {
        owner: 'codex:recorded-native-session',
        cwd: realpathSync(project),
        cli: realpathSync(join(installPath, 'runtime', 'ntworkflow.mjs')),
      },
    );
  } finally {
    await removeEventually(root);
  }
});

test('checked Codex CLI bundle matches the current TypeScript source', () => {
  const root = mkdtempSync(join(tmpdir(), 'ntworkflow-codex-bundle-'));
  try {
    const output = join(root, 'ntworkflow.mjs');
    buildSync({
      entryPoints: ['src/cli/main.ts'],
      bundle: true,
      format: 'esm',
      platform: 'node',
      target: 'node24',
      banner: { js: '/* eslint-disable */' },
      outfile: output,
    });
    assert.deepEqual(
      readFileSync(output),
      readFileSync('plugins/codex/runtime/ntworkflow.mjs'),
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test('checked Codex SessionStart bundle matches the current TypeScript source', () => {
  const root = mkdtempSync(join(tmpdir(), 'ntworkflow-codex-session-bundle-'));
  try {
    const output = join(root, 'session-start.mjs');
    buildSync({
      entryPoints: ['src/providers/codex-session-start.ts'],
      bundle: true,
      format: 'esm',
      platform: 'node',
      target: 'node24',
      banner: { js: '/* eslint-disable */' },
      outfile: output,
    });
    assert.deepEqual(
      readFileSync(output),
      readFileSync('plugins/codex/runtime/session-start.mjs'),
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});
