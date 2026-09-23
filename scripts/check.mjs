import { readdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
const skip = new Set(['node_modules', '.git', '.local', 'artifacts', 'test-results']);
async function walk(path) {
  const entries = await readdir(path, { withFileTypes: true }); const files = [];
  for (const entry of entries) {
    if (skip.has(entry.name)) continue;
    const name = `${path}/${entry.name}`;
    if (entry.isDirectory()) files.push(...await walk(name)); else files.push(name);
  }
  return files;
}
const files = await walk('.'); let checked = 0, failed = false;
for (const file of files.filter(f => f.endsWith('.mjs'))) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) { console.error(result.stderr); failed = true; } checked++;
}
for (const file of files.filter(f => f.includes('/public/') && /\.(mjs|html|css)$/.test(f))) {
  const text = await readFile(file, 'utf8');
  if (/process\.env|Authorization\s*:|Bearer\s+|NEXT_PUBLIC_ASSEMBLYAI_API_KEY/.test(text)) { console.error(`Possible secret-boundary violation: ${file}`); failed = true; }
}
console.log(`Syntax-checked ${checked} modules and checked the browser secret boundary.`);
process.exitCode = failed ? 1 : 0;
