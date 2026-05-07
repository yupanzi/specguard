#!/usr/bin/env node
// Without this, packages/cli/README.md drifts from the root README on every
// release — NPM ships whatever README sits next to package.json, so the
// single source of truth lives at repo root and prepack copies it in.

import { copyFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const src = resolve(root, 'README.md');
const dst = resolve(root, 'packages', 'cli', 'README.md');

if (!existsSync(src)) {
  console.error(`error: source README not found at ${src}`);
  process.exit(1);
}

copyFileSync(src, dst);
console.log(`OK copied root README.md → packages/cli/README.md`);
