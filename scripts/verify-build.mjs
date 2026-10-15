import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

if (!process.env.npm_execpath) throw new Error('Run this check with npm run verify:build.');
await mkdir('dist', { recursive: true });
const directory = await mkdtemp(join(process.cwd(), 'dist', 'reproducibility-'));
const files = ['main.js', 'manifest.json', 'styles.css'];
const run = argumentsList => execFileSync(process.execPath, argumentsList, { cwd: directory, stdio: 'pipe', env: process.env });
const hashes = async root => Object.fromEntries(await Promise.all(files.map(async file => [file,
  createHash('sha256').update(await readFile(join(root, 'dist', 'note-listener', file))).digest('hex')])));

async function convertLineEndings(root, lineEnding) {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const path = join(root, entry.name);
    if (entry.isDirectory()) await convertLineEndings(path, lineEnding);
    else if (/\.(ts|mjs|json|css)$/.test(entry.name) || entry.name === 'LICENSE') {
      await writeFile(path, (await readFile(path, 'utf8')).replace(/\r\n?/g, '\n').replace(/\n/g, lineEnding));
    }
  }
}

try {
  for (const file of ['package.json', 'package-lock.json', 'esbuild.config.mjs', 'LICENSE', 'manifest.json', 'styles.css', 'src']) {
    await cp(file, join(directory, file), { recursive: true });
  }
  run([process.env.npm_execpath, 'ci', '--ignore-scripts', '--no-audit', '--no-fund']);
  await convertLineEndings(directory, '\n');
  run(['esbuild.config.mjs']);
  const lf = await hashes(directory);
  await convertLineEndings(directory, '\r\n');
  run(['esbuild.config.mjs']);
  const crlf = await hashes(directory);
  const release = await hashes(process.cwd());
  for (const file of files) {
    if (lf[file] !== crlf[file] || lf[file] !== release[file]) throw new Error(`Non-reproducible artifact: ${file}`);
  }
  await writeFile('dist/reproducibility.json', `${JSON.stringify({ node: process.version, files: release, lfMatchesCrlf: true, cleanInstallMatches: true }, null, 2)}\n`);
  console.log('PASS: clean-install LF, CRLF and current release artifact hashes all match.');
  console.log(JSON.stringify(release, null, 2));
} finally {
  await rm(directory, { recursive: true, force: true });
}