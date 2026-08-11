import { rm } from 'node:fs/promises';
import { globSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { build } from 'esbuild';

const sourceRoot = resolve('src');
const entryPoints = Object.fromEntries(globSync('src/**/*.ts')
  .map((entryPoint) => resolve(entryPoint))
  .sort()
  .map((entryPoint) => {
    const entryName = relative(sourceRoot, entryPoint).replaceAll('\\', '/').slice(0, -3);
    return [entryName === 'cli/main' ? 'cli/ntworkflow' : entryName, entryPoint];
  }));

if (Object.keys(entryPoints).length === 0) {
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
  outdir: 'build',
  outExtension: { '.js': '.mjs' },
  platform: 'node',
  splitting: true,
  target: 'node24',
});
