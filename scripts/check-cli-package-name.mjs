#!/usr/bin/env node
// Verifies packages/cli/package.json:
//   - name === '@yupanzi/specguard'
//   - publishConfig.access === 'public'
// Pure ESM; node:fs only; zero external deps.

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgPath = resolve(__dirname, '..', 'packages', 'cli', 'package.json');

let pkg;
try {
  pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
} catch (err) {
  console.error(`FAIL: cannot read or parse ${pkgPath}: ${err.message}`);
  process.exit(1);
}

const expectedName = '@yupanzi/specguard';
if (pkg.name !== expectedName) {
  console.error(`FAIL: expected name === '${expectedName}', got '${pkg.name}'`);
  process.exit(1);
}

const access = pkg.publishConfig && pkg.publishConfig.access;
if (access !== 'public') {
  console.error(
    `FAIL: expected publishConfig.access === 'public', got ${JSON.stringify(access)}`,
  );
  process.exit(1);
}

console.log('OK cli package name and publishConfig correct');
process.exit(0);
