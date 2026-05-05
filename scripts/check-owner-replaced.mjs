#!/usr/bin/env node
// Verifies that the literal substring 'OWNER/specguard' is gone from:
//   - package.json
//   - packages/cli/package.json
//   - .claude-plugin/plugin.json
//   - README.md
// Pure ESM; node:fs only; zero external deps.

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

const TARGET = 'OWNER/specguard';
const FILES = [
  'package.json',
  'packages/cli/package.json',
  '.claude-plugin/plugin.json',
  'README.md',
];

const offenders = [];

for (const rel of FILES) {
  const abs = resolve(repoRoot, rel);
  let content;
  try {
    content = readFileSync(abs, 'utf8');
  } catch (err) {
    console.error(`FAIL: cannot read ${abs}: ${err.message}`);
    process.exit(1);
  }
  let count = 0;
  let idx = 0;
  while ((idx = content.indexOf(TARGET, idx)) !== -1) {
    count += 1;
    idx += TARGET.length;
  }
  if (count > 0) {
    offenders.push({ file: rel, count });
  }
}

if (offenders.length > 0) {
  console.error(`FAIL: literal '${TARGET}' still present in:`);
  for (const { file, count } of offenders) {
    console.error(`  - ${file} (${count} occurrence${count === 1 ? '' : 's'})`);
  }
  process.exit(1);
}

console.log('OK no OWNER/specguard placeholder remains');
process.exit(0);
