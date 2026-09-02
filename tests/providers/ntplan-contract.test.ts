import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('native ntplan skills share the full phase contract and separate provider role configuration', () => {
  const skills = ['claude-code', 'codex'].map(provider => readFileSync(`plugins/${provider}/skills/ntplan/SKILL.md`, 'utf8'));
  assert.equal(skills[0]?.split('## Enter the phase')[1], skills[1]?.split('## Enter the phase')[1]);
  for (const skill of skills) {
    const prose = skill.replace(/\s+/gu, ' ');
    for (const phrase of [
      'Research always runs', 'temporary evidence packet', 'primary owns all canonical artifacts',
      'before writing PLAN or task packets', 'at most three total rounds',
      'A material correction after PASS', 'no force-pass',
      'explicit restart confirmation even when the native ID matches',
      'Do not call begin again during uninterrupted multi-turn progress',
      'required producers are in its dependency closure',
      'No content hashes, fingerprints, approval manifests',
      'never start ntwork', 'current summary and ordered task list',
    ]) assert.ok(prose.includes(phrase), phrase);
    for (const command of [
      'phase begin ntplan --session-id "<owner>" --researcher-available --critic-available',
      'plan validate --session-id "<owner>"',
      'phase complete ntplan --session-id "<owner>" --critic-pass --user-confirmed',
    ]) assert.ok(skill.includes(command), command);
    assert.ok(prose.indexOf('If `next_action.skill` is not `ntplan`') < prose.indexOf('If this session already ran another major phase'));
  }
  assert.match(skills[0] ?? '', /neotolis-workflow:ntplan-researcher/);
  assert.match(skills[1] ?? '', /ntplan_researcher/);
});
