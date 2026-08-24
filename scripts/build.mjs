import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'esbuild';

await rm('build', { force: true, recursive: true });
await build({
  absWorkingDir: process.cwd(),
  bundle: true,
  entryNames: '[dir]/[name]',
  entryPoints: {
    'cli/ntworkflow': resolve('src/cli/main.ts'),
  },
  format: 'esm',
  outdir: 'build',
  outExtension: { '.js': '.mjs' },
  platform: 'node',
  target: 'node24',
});