import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import test from 'node:test';

test('release package, manifest and compatibility map have consistent versions', () => {
  const packageInfo = JSON.parse(readFileSync('package.json', 'utf8'));
  const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
  const versions = JSON.parse(readFileSync('versions.json', 'utf8'));
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.equal(packageInfo.version, manifest.version);
  assert.equal(versions[manifest.version], manifest.minAppVersion);
  assert.equal(manifest.id, 'note-listener');
  assert.equal(manifest.isDesktopOnly, true);
  assert.equal(packageInfo.license, 'MIT');
  const license = readFileSync('LICENSE', 'utf8');
  assert.match(license, /^MIT License/);
  assert.match(license, /Permission is hereby granted/);
  assert.ok(manifest.description.length <= 250 && manifest.description.endsWith('.'));
});

test('community installer main.js includes Edge without any extra plugin code file', async () => {
  const config = await import(new URL('../esbuild.config.mjs', import.meta.url).href) as { edgeNetworkPlugin: import('esbuild').Plugin };
  const result = await build({ entryPoints: ['src/main.ts'], bundle: true, write: false, platform: 'node', format: 'cjs',
    target: 'node18', external: ['obsidian', 'bufferutil', 'utf-8-validate'], plugins: [config.edgeNetworkPlugin], outfile: 'main.js', metafile: true });
  const allowed = new Set([...builtinModules, ...builtinModules.map(name => `node:${name}`), 'obsidian', 'bufferutil', 'utf-8-validate']);
  const imports = Object.values(result.metafile!.outputs).flatMap(output => output.imports);
  assert.ok(imports.every(item => allowed.has(item.path)), JSON.stringify(imports));
  assert.ok(Object.keys(result.metafile!.inputs).some(path => path.includes('msedge-tts')));
  assert.ok(!imports.some(item => /^(node:)?fs(?:\/|$)/.test(item.path)), 'Runtime must not import fs');
  assert.ok(!Object.keys(result.metafile!.inputs).some(path => path.includes('@andresaya')));
  assert.equal(result.outputFiles.length, 1);
  assert.ok(!result.outputFiles[0].text.includes('/edge.cjs'));
});