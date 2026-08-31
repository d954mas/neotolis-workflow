import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { completeNttaskPhase } from '../../src/runtime/nttask.ts';
import { FIRST_OWNER, intakeState, stateBytes, temporaryProject } from '../phase/helpers.ts';

const BRIEF = '# Task\n\n## Brief\nIntent.\n\n## Repository context\nContext.\n\n## Success\nOutcome.\n';

for (const [name, markdown, valid] of [
  ['hidden required headings', '# Task\n<!--\n' + BRIEF.slice('# Task\n'.length) + '-->\n', false],
  ['comment-only section', BRIEF.replace('Intent.', '<!-- Intent. -->'), false],
  ['unterminated final comment', BRIEF.replace('Outcome.', '<!--\nOutcome.'), false],
  ['fence markers inside a comment', BRIEF.replace('Intent.', '<!--\n```\n-->'), false],
  ['visible suffix of a one-line comment', BRIEF.replace('Intent.', '<!-- Note. --> Intent.'), true],
  ['visible suffix of a multiline comment', BRIEF.replace('Intent.', '<!-- Note.\n--> Intent.'), true],
  ['consecutive comment-only blocks', BRIEF.replace('Intent.', '<!-- One. --><!-- Two. -->'), false],
  ['visible text between comments', BRIEF.replace('Intent.', '<!-- One. --> Intent. <!-- Two. -->'), true],
  ['hidden duplicate headings', BRIEF.replace('Intent.', '   <!--\n# Hidden title\n## Hidden section\n-->\nIntent.'), true],
  ['comment literal in fenced code', BRIEF.replace('Intent.', '```html\n<!--\n```'), true],
  ['comment literal in inline code', BRIEF.replace('Intent.', 'The `<!--` token.'), true],
] as const) {
  test(`BRIEF HTML comments: ${name}`, async () => {
    const root = temporaryProject('comments', intakeState({ owner: FIRST_OWNER }));
    const run = join(root, '.ntworkflow', 'runs', 'NT-001');
    const path = join(run, 'BRIEF.md');
    try {
      mkdirSync(run, { recursive: true });
      writeFileSync(path, markdown);
      const before = stateBytes(root);
      if (valid) {
        const result = await completeNttaskPhase(root, { sessionId: FIRST_OWNER });
        assert.equal(result.state.current?.lifecycle, 'brief-ready');
        assert.equal(result.state.current?.owner, null);
      } else {
        await assert.rejects(completeNttaskPhase(root, { sessionId: FIRST_OWNER }), {
          code: 'ARTIFACT_FAILURE', exitCode: 14,
        });
        assert.deepEqual(stateBytes(root), before);
      }
      assert.equal(readFileSync(path, 'utf8'), markdown);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}
