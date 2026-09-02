import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('native ntwork skills share the full execution contract and provider-owned roles', () => {
  const skills = ['claude-code', 'codex'].map((provider) => (
    readFileSync(`plugins/${provider}/skills/ntwork/SKILL.md`, 'utf8')
  ));
  assert.equal(skills[0]?.split('## Enter the phase')[1], skills[1]?.split('## Enter the phase')[1]);
  for (const skill of skills) {
    const prose = skill.replace(/\s+/gu, ' ');
    for (const phrase of [
      'Primary owns canonical verification',
      'exact next pending task',
      'Implementation is never parallel',
      'Packet compliance: PASS | BLOCK',
      'Code and test quality: PASS | BLOCK',
      'same current revision',
      'Nyquist',
      'specification/integration',
      'does not merge',
      'invalid phase state',
      'never invoke another skill automatically',
    ]) assert.ok(prose.includes(phrase), phrase);
    for (const command of [
      'phase begin ntwork --session-id "<owner>"',
      'task begin <task-id> --session-id "<owner>"',
      'work record evidence',
      'work record task-review',
      'task complete <task-id> --session-id "<owner>" --commit-id <commit>',
      'work record gate',
      'phase complete ntwork --session-id "<owner>"',
    ]) assert.ok(skill.includes(command), command);
  }
  assert.match(skills[0] ?? '', /neotolis-workflow:ntwork-implementer/);
  assert.match(skills[1] ?? '', /agent_type `ntwork_implementer`/);
});
