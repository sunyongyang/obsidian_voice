import * as esbuild from 'esbuild';
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { builtinModules } from 'node:module';

const options = {
  entryPoints: ['src/main.ts'], bundle: true, format: 'cjs', platform: 'browser',
  target: 'es2022', external: ['obsidian'], outfile: 'main.js',
  minify: !process.argv.includes('--watch'), logLevel: 'info',
};

const desktopOptions = {
  entryPoints: { edge: 'src/edge.ts' },
  bundle: true, format: 'cjs', platform: 'node', target: 'node18',
  external: ['bufferutil', 'utf-8-validate'], outdir: '.', outExtension: { '.js': '.cjs' },
  minify: !process.argv.includes('--watch'), logLevel: 'info',
};

if (process.argv.includes('--watch')) {
  const context = await esbuild.context(options);
  const desktop = await esbuild.context(desktopOptions);
  await context.watch();
  await desktop.watch();
} else {
  const result = await esbuild.build({ ...options, metafile: true });
  const imports = Object.values(result.metafile.outputs).flatMap(output => output.imports);
  if (imports.some(item => item.path !== 'obsidian')) throw new Error('Unexpected runtime dependency');
  const desktop = await esbuild.build({ ...desktopOptions, metafile: true });
  const allowed = new Set([...builtinModules, ...builtinModules.map(name => `node:${name}`), 'bufferutil', 'utf-8-validate']);
  if (Object.values(desktop.metafile.outputs).some(output => output.imports.some(item => !allowed.has(item.path)))) {
    throw new Error('Unbundled desktop dependency');
  }
  await mkdir('dist/note-listener', { recursive: true });
  await rm('edge-worker.cjs', { force: true });
  await rm('dist/note-listener/edge-worker.cjs', { force: true });
  for (const file of ['main.js', 'edge.cjs', 'manifest.json', 'styles.css']) {
    await copyFile(file, `dist/note-listener/${file}`);
  }
  const packages = new Set(Object.keys({ ...result.metafile.inputs, ...desktop.metafile.inputs })
    .filter(path => path.startsWith('node_modules/'))
    .map(path => {
      const parts = path.slice('node_modules/'.length).split('/');
      return parts[0].startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
    }));
  const notices = ['Third-party software included in the Note Listener bundles.'];
  for (const name of [...packages].sort()) {
    const directory = `node_modules/${name}`;
    const metadata = JSON.parse(await readFile(`${directory}/package.json`, 'utf8'));
    const licenses = (await readdir(directory)).filter(name => /^(licen[cs]e|copying)([.-].*)?$/i.test(name));
    if (!licenses.length) throw new Error(`Missing third-party license: ${name}`);
    notices.push(`\n${metadata.name} ${metadata.version}\n${'='.repeat(60)}`);
    for (const license of licenses) notices.push(await readFile(`${directory}/${license}`, 'utf8'));
  }
  await writeFile('dist/note-listener/THIRD_PARTY_NOTICES.txt', notices.join('\n\n'));
}