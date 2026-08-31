import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { withProviders } from './harness.ts';

test('E2E snapshots distinguish invalid UTF-8 bytes while normalizing fixture identities', async () => {
  await withProviders((fixture) => {
    const session = fixture.session();
    const content = Buffer.from(`${fixture.root}\n${session.owner}\nЮникод\n`);
    writeFileSync(join(fixture.root, 'asset.bin'), Buffer.concat([content, Buffer.from([0x80])]));
    const before = fixture.normalize(fixture.tree());
    writeFileSync(join(fixture.root, 'asset.bin'), Buffer.concat([content, Buffer.from([0x81])]));
    assert.notDeepEqual(fixture.normalize(fixture.tree()), before);
    session.cli('status');
  });
});
