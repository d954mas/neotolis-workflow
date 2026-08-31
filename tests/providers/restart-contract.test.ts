import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

for (const provider of ['claude-code', 'codex']) {
  test(`${provider}: confirmed intake restart reacquires even the same native owner`, () => {
    const skill = readFileSync(`plugins/${provider}/skills/nttask/SKILL.md`, 'utf8');
    assert.ok(skill.includes('After restart confirmation, call `phase begin nttask'));
    assert.ok(skill.includes('even when the recorded owner is this same session'));
    assert.ok(skill.includes('`--interruption user-confirmed`'));
    assert.ok(skill.includes('Provider evidence authorizes owner replacement, not the intake restart'));
  });
}
