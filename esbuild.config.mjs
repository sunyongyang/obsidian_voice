import * as esbuild from 'esbuild';
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { builtinModules } from 'node:module';

const options = {
  entryPoints: ['src/main.ts'], bundle: true, format: 'cjs', platform: 'node',
  target: 'node18', external: ['obsidian', 'bufferutil', 'utf-8-validate'], outfile: 'main.js',
  minify: false, logLevel: 'info',
};

if (process.argv.includes('--watch')) {
  const context = await esbuild.context(options);
  await context.watch();
} else {
  const result = await esbuild.build({ ...options, metafile: true, write: false });
  const imports = Object.values(result.metafile.outputs).flatMap(output => output.imports);
  const allowed = new Set([...builtinModules, ...builtinModules.map(name => `node:${name}`), 'obsidian', 'bufferutil', 'utf-8-validate']);
  if (imports.some(item => !allowed.has(item.path))) throw new Error('Unbundled runtime dependency');
  const packages = new Set(Object.keys(result.metafile.inputs)
    .filter(path => path.startsWith('node_modules/'))
    .map(path => {
      const parts = path.slice('node_modules/'.length).split('/');
      return parts[0].startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
    }));
  const notices = [await readFile('LICENSE', 'utf8'), 'Third-party software included in the Note Listener bundles.'];
  for (const name of [...packages].sort()) {
    const directory = `node_modules/${name}`;
    const metadata = JSON.parse(await readFile(`${directory}/package.json`, 'utf8'));
    const licenses = (await readdir(directory)).filter(name => /^(licen[cs]e|copying)([.-].*)?$/i.test(name));
    if (!licenses.length) throw new Error(`Missing third-party license: ${name}`);
    notices.push(`\n${metadata.name} ${metadata.version}\n${'='.repeat(60)}`);
    for (const license of licenses) notices.push(await readFile(`${directory}/${license}`, 'utf8'));
  }
  const legalText = notices.join('\n\n').replace(/\*\//g, '* /');
  await writeFile('main.js', `${result.outputFiles[0].text}\n/*\n${legalText}\n*/\n`);
  await mkdir('dist/note-listener', { recursive: true });
  for (const file of ['edge-worker.cjs', 'edge.cjs', 'dist/note-listener/edge-worker.cjs', 'dist/note-listener/edge.cjs', 'dist/note-listener/THIRD_PARTY_NOTICES.txt']) {
    await rm(file, { force: true });
  }
  for (const file of ['main.js', 'manifest.json', 'styles.css']) await copyFile(file, `dist/note-listener/${file}`);
}