#!/usr/bin/env node
// Without this, .claude-plugin/plugin.json drifts from packages/cli/package.json
// on every release — @semantic-release/npm only writes the cli one.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SEMVER_RE = /^\d+\.\d+\.\d+(?:[+-].*)?$/;
const USAGE = [
  'Usage:',
  '  node scripts/sync-plugin-version.mjs <version>      # write plugin.json version',
  '  node scripts/sync-plugin-version.mjs --check        # assert plugin.json matches packages/cli/package.json',
].join('\n');

const __dirname = dirname(fileURLToPath(import.meta.url));
const pluginJsonPath = resolve(__dirname, '..', '.claude-plugin', 'plugin.json');
const cliPkgJsonPath = resolve(__dirname, '..', 'packages', 'cli', 'package.json');

const args = process.argv.slice(2);

if (args.length === 0) {
  console.error(USAGE);
  process.exit(2);
}

const first = args[0];

if (first === '--check') {
  runCheck();
} else if (first.startsWith('--')) {
  console.error(USAGE);
  process.exit(2);
} else {
  runWrite(first);
}

function runCheck() {
  const cliPkg = readJson(cliPkgJsonPath);
  const plugin = readJson(pluginJsonPath);
  const cliVer = cliPkg.version;
  const pluginVer = plugin.version;
  if (cliVer === pluginVer) {
    console.log(
      `OK plugin.json and packages/cli/package.json versions match (${cliVer})`,
    );
    process.exit(0);
  }
  console.log(`MISMATCH cli=${cliVer} plugin=${pluginVer}`);
  process.exit(1);
}

function runWrite(version) {
  if (!SEMVER_RE.test(version)) {
    console.error(
      `error: '${version}' is not a valid semver (expected MAJOR.MINOR.PATCH[+-suffix])`,
    );
    process.exit(2);
  }
  // Regex-replace preserves byte-exact formatting, key order, and whitespace
  // (a JSON.parse → JSON.stringify roundtrip would re-flow inline objects like
  // `"author": { "name": "..." }` onto multiple lines).
  let text;
  try {
    text = readFileSync(pluginJsonPath, 'utf8');
  } catch (err) {
    console.error(`error: cannot read ${pluginJsonPath}: ${err.message}`);
    process.exit(1);
  }
  const versionRe = /^(\s*)"version"(\s*):(\s*)"[^"]*"/m;
  if (!versionRe.test(text)) {
    console.error(
      `error: did not find a top-level "version" string in ${pluginJsonPath}`,
    );
    process.exit(1);
  }
  const next = text.replace(versionRe, `$1"version"$2:$3"${version}"`);
  try {
    JSON.parse(next);
  } catch (err) {
    console.error(`error: post-replace text is not valid JSON: ${err.message}`);
    process.exit(1);
  }
  writeFileSync(pluginJsonPath, next, 'utf8');
  console.log(`synced .claude-plugin/plugin.json version → ${version}`);
  process.exit(0);
}

function readJson(p) {
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch (err) {
    console.error(`error: cannot read or parse ${p}: ${err.message}`);
    process.exit(1);
  }
}
