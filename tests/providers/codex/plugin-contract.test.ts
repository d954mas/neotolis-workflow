import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import test from 'node:test';

function filesUnder(root: string, directory = root): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...filesUnder(root, path));
    else files.push(relative(root, path).replaceAll('\\', '/'));
  }
  return files.sort();
}

test('Codex plugin contains only nttask, ntgrill, license, identity hook, and runtime files', () => {
  assert.deepEqual(filesUnder(resolve('plugins/codex')), [
    '.codex-plugin/plugin.json',
    'hooks/hooks.json',
    'runtime/ntworkflow.mjs',
    'runtime/session-start.mjs',
    'skills/ntgrill/LICENSE',
    'skills/ntgrill/SKILL.md',
    'skills/nttask/SKILL.md',
  ]);
});

test('Codex manifests expose the isolated local workflow plugin', () => {
  const plugin = JSON.parse(readFileSync(
    'plugins/codex/.codex-plugin/plugin.json',
    'utf8',
  )) as Record<string, unknown>;
  assert.deepEqual(plugin, {
    name: 'neotolis-workflow',
    version: '0.0.0',
    description: 'Rigorous task intake and decision grilling for Neotolis Workflow.',
    author: { name: 'Neotolis' },
    skills: './skills/',
    interface: {
      displayName: 'Neotolis Workflow',
      shortDescription: 'Task intake and decision grilling for large development work.',
      longDescription: 'Create a canonical task brief, then resolve decisions before planning.',
      developerName: 'Neotolis',
      category: 'Developer Tools',
      capabilities: [],
      defaultPrompt: 'Start a rigorous Neotolis task intake.',
    },
  });

  const marketplace = JSON.parse(readFileSync(
    'marketplaces/codex/marketplace.json',
    'utf8',
  )) as Record<string, unknown>;
  assert.deepEqual(marketplace, {
    name: 'neotolis-local',
    interface: { displayName: 'Neotolis Local' },
    plugins: [{
      name: 'neotolis-workflow',
      source: {
        source: 'local',
        path: './plugins/neotolis-workflow',
      },
      policy: {
        installation: 'AVAILABLE',
        authentication: 'ON_INSTALL',
      },
      category: 'Developer Tools',
    }],
  });
});

test('Codex hook uses plugin-root paths with platform-correct commands', () => {
  const hooksText = readFileSync('plugins/codex/hooks/hooks.json', 'utf8');
  const hooks = JSON.parse(hooksText) as {
    hooks: { SessionStart: Array<{ hooks: Array<Record<string, unknown>> }> };
  };

  assert.equal(hooks.hooks.SessionStart.length, 1);
  assert.deepEqual(hooks.hooks.SessionStart[0]?.hooks, [{
    type: 'command',
    command: 'node "${PLUGIN_ROOT}/runtime/session-start.mjs" "${PLUGIN_ROOT}/runtime/ntworkflow.mjs"',
    commandWindows: 'node "${PLUGIN_ROOT}\\runtime\\session-start.mjs" "${PLUGIN_ROOT}\\runtime\\ntworkflow.mjs"',
    timeout: 10,
  }]);
  assert.equal(hooksText.includes('../'), false);
  assert.equal(hooksText.includes('CLAUDE_PLUGIN_ROOT'), false);
});

test('Codex nttask skill carries the complete intake, trust, and stop contract', () => {
  const skill = readFileSync('plugins/codex/skills/nttask/SKILL.md', 'utf8');

  for (const required of [
    'name: nttask',
    '$nttask',
    'Neotolis Workflow runtime context:',
    'codex:',
    '/hooks',
    'fresh Codex session',
    'untrusted or disabled',
    'before any CLI call or project mutation',
    'run start --session-id',
    'run cancel --session-id',
    'phase begin nttask --session-id',
    'phase complete nttask --session-id',
    'phase stop nttask --session-id',
    'BRIEF.md',
    '## Brief',
    '## Repository context',
    '## Success',
    '## Open questions',
    'primary agent',
    'optional scout',
    'directly supplied',
    'explicit confirmation before restarting the ownerless intake',
    'ordinary multi-turn progress in the uninterrupted current session',
    'Always require explicit user restart confirmation after an interruption',
    'Provider evidence authorizes owner replacement, not the intake restart',
    'Every unreadable directly supplied source pauses intake',
    "Write in the user's language",
    'Do not invoke `ntgrill`',
  ]) {
    assert.ok(skill.includes(required), `missing nttask contract text: ${required}`);
  }
});

test('Codex nttask skill begins nttask after every new run', () => {
  const skill = readFileSync('plugins/codex/skills/nttask/SKILL.md', 'utf8');

  assert.ok(
    skill.includes(
      'For `delivery-ready`, call `run start --session-id "<owner>"` with the new non-empty intent, then `phase begin nttask --session-id "<owner>"`.',
    ),
  );
  assert.ok(
    skill.includes(
      'call `run cancel --session-id "<owner>" --user-confirmed`, then call `run start --session-id "<owner>"` with the new non-empty intent, then `phase begin nttask --session-id "<owner>"`.',
    ),
  );
});
