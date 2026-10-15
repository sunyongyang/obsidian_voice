import * as esbuild from 'esbuild';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { builtinModules } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

export const edgeNetworkPlugin = {
  name: 'edge-network-only',
  setup(build) {
    build.onLoad({ filter: /[\\/]msedge-tts[\\/]dist[\\/]MsEdgeTTS\.js$/ }, async ({ path }) => {
      const source = ts.createSourceFile(path, await readFile(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
      const remove = new Set(['toFile', 'rawToFile', '_rawSSMLRequestToFile', 'getVoices']);
      const removed = new Set();
      let forcedNode = false;
      const transformed = ts.transform(source, [context => root => {
        const visit = node => {
          if (ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration =>
            ts.isIdentifier(declaration.name) && ['fs', 'axios_1'].includes(declaration.name.text))) return undefined;
          if (ts.isMethodDeclaration(node) && node.name && ts.isIdentifier(node.name) && remove.has(node.name.text)) {
            removed.add(node.name.text);
            return undefined;
          }
          if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
            ts.isPropertyAccessExpression(node.left) && node.left.expression.kind === ts.SyntaxKind.ThisKeyword && node.left.name.text === '_isBrowser') {
            forcedNode = true;
            return ts.factory.updateBinaryExpression(node, node.left, node.operatorToken, ts.factory.createFalse());
          }
          return ts.visitEachChild(node, visit, context);
        };
        return ts.visitNode(root, visit);
      }]);
      try {
        if (removed.size !== remove.size || !forcedNode) throw new Error('Pinned Edge SDK structure changed; audit the network-only transform.');
        return { contents: ts.createPrinter({ newLine: ts.NewLineKind.LineFeed }).printFile(transformed.transformed[0]), loader: 'js' };
      } finally { transformed.dispose(); }
    });
  },
};

const options = {
  entryPoints: ['src/main.ts'], bundle: true, format: 'cjs', platform: 'node',
  target: 'node18', external: ['obsidian', 'bufferutil', 'utf-8-validate'], outfile: 'main.js',
  minify: false, logLevel: 'info',
  plugins: [edgeNetworkPlugin],
};

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invokedDirectly && process.argv.includes('--watch')) {
  const context = await esbuild.context(options);
  await context.watch();
} else if (invokedDirectly) {
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
    const licenses = (await readdir(directory)).filter(name => /^(licen[cs]e|copying)([.-].*)?$/i.test(name)).sort();
    if (!licenses.length) throw new Error(`Missing third-party license: ${name}`);
    notices.push(`\n${metadata.name} ${metadata.version}\n${'='.repeat(60)}`);
    for (const license of licenses) notices.push(await readFile(`${directory}/${license}`, 'utf8'));
  }
  const legalText = notices.join('\n\n').replace(/\r\n?/g, '\n').replace(/\*\//g, '* /');
  await writeFile('main.js', `${result.outputFiles[0].text.replace(/\r\n?/g, '\n')}\n/*\n${legalText}\n*/\n`);
  await mkdir('dist/note-listener', { recursive: true });
  for (const file of ['edge-worker.cjs', 'edge.cjs', 'dist/note-listener/edge-worker.cjs', 'dist/note-listener/edge.cjs', 'dist/note-listener/THIRD_PARTY_NOTICES.txt']) {
    await rm(file, { force: true });
  }
  for (const file of ['main.js', 'manifest.json', 'styles.css']) {
    await writeFile(`dist/note-listener/${file}`, (await readFile(file, 'utf8')).replace(/\r\n?/g, '\n'));
  }
}