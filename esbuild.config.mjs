import * as esbuild from 'esbuild';
import { copyFile, mkdir } from 'node:fs/promises';

const options = {
  entryPoints: ['src/main.ts'], bundle: true, format: 'cjs', platform: 'browser',
  target: 'es2022', external: ['obsidian'], outfile: 'main.js',
  minify: !process.argv.includes('--watch'), logLevel: 'info',
};

if (process.argv.includes('--watch')) {
  const context = await esbuild.context(options);
  await context.watch();
} else {
  const result = await esbuild.build({ ...options, metafile: true });
  const imports = Object.values(result.metafile.outputs).flatMap(output => output.imports);
  if (imports.some(item => item.path !== 'obsidian')) throw new Error('Unexpected runtime dependency');
  await mkdir('dist/note-listener', { recursive: true });
  for (const file of ['main.js', 'manifest.json', 'styles.css']) {
    await copyFile(file, `dist/note-listener/${file}`);
  }
}