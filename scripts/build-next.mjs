import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const args = process.argv.slice(2);
const compilerSpecified = args.some(arg => ['--webpack', '--turbopack', '--turbo'].includes(arg));
if (process.platform === 'win32' && !compilerSpecified) args.push('--webpack');
const result = spawnSync(process.execPath, [require.resolve('next/dist/bin/next'), 'build', ...args], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
