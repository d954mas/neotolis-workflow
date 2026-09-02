import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const skills = ['claude-code', 'codex'].map((provider) =>
  readFileSync(`plugins/${provider}/skills/ntgrill/SKILL.md`, 'utf8'));

test('both native ntgrill skills carry the same self-contained phase contract', () => {
  assert.equal(skills[0]?.split('## Enter the phase')[1], skills[1]?.split('## Enter the phase')[1]);
  for (const skill of skills) {
    const prose = skill.replace(/\s+/gu, ' ');
    for (const text of [
      'name: ntgrill', 'Neotolis Workflow runtime context:', 'fresh primary session',
      'Ask exactly one question at a time', 'Every question includes your recommended answer',
      'During the interview, BRIEF.md remains unchanged', 'final self-sweep',
      'complete revised account for confirmation again', 'rewrite the entire BRIEF.md once',
      'no `Open questions` section', 'even when the session ID matches',
      'no supporting agents', 'Never resume the interrupted reasoning',
      'begin the response with the literal diagnostic `invalid phase state`',
      'Do not invoke any other skill automatically',
      '6654f6b60cd9d5be8b54c6fafe44346dabeb3b76', '[LICENSE](LICENSE)',
    ]) assert.ok(prose.includes(text), `Missing ntgrill contract: ${text}`);
    for (const text of [
      'phase begin ntgrill --session-id', 'phase stop ntgrill --session-id',
      'phase complete ntgrill --session-id "<owner>" --user-confirmed',
      '`invalid phase state`',
      'invalid phase state: ntgrill is not legal at <lifecycle>. <next_action.instruction>',
    ]) assert.ok(skill.includes(text), `Missing exact CLI contract: ${text}`);
  }
  assert.ok(skills[0]?.includes('`claude:`'));
  assert.ok(skills[1]?.includes('`codex:`'));
  assert.ok(skills[1]?.includes('/hooks'));
});

test('both copies preserve the upstream MIT license', () => {
  const licenses = ['claude-code', 'codex'].map((provider) =>
    readFileSync(`plugins/${provider}/skills/ntgrill/LICENSE`, 'utf8'));
  assert.equal(licenses[0], licenses[1]);
  assert.match(licenses[0] ?? '', /Copyright \(c\) 2026 Matt Pocock/);
  assert.match(licenses[0] ?? '', /Permission is hereby granted/);
  assert.match(licenses[0] ?? '', /THE SOFTWARE IS PROVIDED "AS IS"/);
});

test('ntgrill diagnoses the runtime next action before freshness or restart questions', () => {
  for (const skill of skills) {
    const prose = skill.replace(/\s+/gu, ' ');
    const status = prose.indexOf('Run `status`');
    const diagnosis = prose.indexOf('If `next_action.skill` is not `ntgrill`');
    const freshness = prose.indexOf('If this session already ran intake');
    const restart = prose.indexOf('Require explicit restart confirmation');
    assert.ok(status >= 0 && diagnosis > status);
    assert.ok(freshness > diagnosis && restart > freshness);
  }
});
