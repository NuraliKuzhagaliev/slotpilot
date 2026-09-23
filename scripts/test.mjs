import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
const scope = process.argv[2] || 'all';
if (!['all', 'probe', 'domain'].includes(scope)) throw new Error('Unknown test scope.');
const root = new URL('../', import.meta.url);
const files = [];
for (const directory of scope === 'all' ? ['tests', 'tests/domain'] : [scope === 'probe' ? 'tests' : 'tests/domain']) {
  for (const filename of readdirSync(new URL(directory, root))) {
    if (/\.test\.(mjs|ts)$/.test(filename)) files.push(resolve(directory, filename));
  }
}
const result = spawnSync(process.execPath, ['--experimental-strip-types', '--test', '--test-reporter=tap', ...files.sort()], { stdio: 'inherit' });
process.exitCode = result.status ?? 1;
