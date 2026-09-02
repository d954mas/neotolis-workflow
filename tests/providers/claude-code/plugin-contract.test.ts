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

test('Claude plugin contains the three implemented skills, planning roles, license, identity hook, and runtime', () => {
  assert.deepEqual(filesUnder(resolve('plugins/claude-code')), [
    '.claude-plugin/plugin.json',
    'agents/ntplan-critic.md',
    'agents/ntplan-researcher.md',
    'hooks/hooks.json',
    'runtime/ntworkflow.mjs',
    'runtime/session-start.mjs',
    'skills/ntgrill/LICENSE',
    'skills/ntgrill/SKILL.md',
    'skills/ntplan/SKILL.md',
    'skills/nttask/SKILL.md',
  ]);
});

test('Claude manifests expose the local namespaced workflow plugin', () => {
  const plugin = JSON.parse(readFileSync(
    'plugins/claude-code/.claude-plugin/plugin.json',
    'utf8',
  )) as Record<string, unknown>;
  assert.deepEqual(plugin, {
    name: 'neotolis-workflow',
    version: '0.0.0',
    description: 'Rigorous intake, decision grilling and researched planning for Neotolis Workflow.',
    author: { name: 'Neotolis' },
  });

  const marketplace = JSON.parse(readFileSync(
    'marketplaces/claude-code/.claude-plugin/marketplace.json',
    'utf8',
  )) as Record<string, unknown>;
  assert.deepEqual(marketplace, {
    name: 'neotolis-local',
    owner: { name: 'Neotolis' },
    description: 'Local Neotolis Workflow plugins.',
    plugins: [{
      name: 'neotolis-workflow',
      source: './plugins/neotolis-workflow',
      version: '0.0.0',
      description: 'Rigorous intake, decision grilling and researched planning for Neotolis Workflow.',
    }],
  });
});

test('Claude hook uses only installed plugin paths', () => {
  const hooksText = readFileSync('plugins/claude-code/hooks/hooks.json', 'utf8');
  const hooks = JSON.parse(hooksText) as {
    hooks: { SessionStart: Array<{ hooks: Array<Record<string, unknown>> }> };
  };

  assert.equal(hooks.hooks.SessionStart.length, 1);
  assert.deepEqual(hooks.hooks.SessionStart[0]?.hooks, [{
    type: 'command',
    command: 'node "${CLAUDE_PLUGIN_ROOT}/runtime/session-start.mjs" "${CLAUDE_PLUGIN_ROOT}/runtime/ntworkflow.mjs"',
    timeout: 10,
  }]);
  assert.equal(hooksText.includes('../'), false);
});

test('Claude nttask skill carries the complete intake and stop contract', () => {
  const skill = readFileSync('plugins/claude-code/skills/nttask/SKILL.md', 'utf8');

  for (const required of [
    'name: nttask',
    '$ARGUMENTS',
    'Neotolis Workflow runtime context:',
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

test('Claude nttask skill begins nttask after every new run', () => {
  const skill = readFileSync('plugins/claude-code/skills/nttask/SKILL.md', 'utf8');

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
