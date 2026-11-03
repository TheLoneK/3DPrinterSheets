// Builds the site into dist/: compiles src/*.ts to dist/js and copies public/ alongside it.
import { execSync } from 'node:child_process';
import { cpSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = `${root}/dist`;

rmSync(dist, { recursive: true, force: true });
execSync('tsc -p .', { cwd: root, stdio: 'inherit' });
cpSync(`${root}/public`, dist, { recursive: true });
console.log('Built to dist/');
