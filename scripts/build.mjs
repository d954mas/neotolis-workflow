import { rm } from 'node:fs/promises';
import { globSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from 'esbuild';

const entryPoints = globSync('src/**/*.ts')
  .map((entryPoint) => resolve(entryPoint))
  .sort();

if (entryPoints.length === 0) {
  throw new Error('No TypeScript source files found under src/.');
}

await rm('build', { force: true, recursive: true });
await build({
  absWorkingDir: process.cwd(),
  bundle: true,
  chunkNames: 'chunks/[name]-[hash]',
  entryNames: '[dir]/[name]',
  entryPoints,
  format: 'esm',
  outbase: resolve('src'),
  outdir: 'build',
  outExtension: { '.js': '.mjs' },
  platform: 'node',
  splitting: true,
  target: 'node24',
});
