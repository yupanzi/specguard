#!/usr/bin/env node
// Verify root package.json has the 7 release devDependencies installed.
// Self-contained: only node:fs + JSON.parse.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgPath = resolve(__dirname, '..', 'package.json');

const REQUIRED = [
  'semantic-release',
  '@semantic-release/changelog',
  '@semantic-release/git',
  '@semantic-release/exec',
  '@commitlint/cli',
  '@commitlint/config-conventional',
  'husky',
];

const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const dev = pkg.devDependencies || {};
const missing = REQUIRED.filter((k) => !(k in dev));

if (missing.length > 0) {
  console.error('FAIL: missing release devDependencies:');
  for (const m of missing) console.error('  - ' + m);
  process.exit(1);
}

console.log(`OK release devDependencies present (${REQUIRED.length})`);
process.exit(0);
