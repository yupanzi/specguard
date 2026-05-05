#!/usr/bin/env node
// Verifies that .releaserc.json has the structure required by the
// add-semantic-release task. Pure ESM, node:fs only, zero deps.

import { readFileSync } from 'node:fs';

const REQUIRED_PLUGINS = [
  '@semantic-release/commit-analyzer',
  '@semantic-release/release-notes-generator',
  '@semantic-release/changelog',
  '@semantic-release/exec',
  '@semantic-release/npm',
  '@semantic-release/git',
  '@semantic-release/github',
];

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

let raw;
try {
  raw = readFileSync('.releaserc.json', 'utf8');
} catch (err) {
  fail(`unable to read .releaserc.json: ${err.message}`);
}

let cfg;
try {
  cfg = JSON.parse(raw);
} catch (err) {
  fail(`.releaserc.json is not valid JSON: ${err.message}`);
}

if (!Array.isArray(cfg.branches)) {
  fail('branches must be an array');
}
if (!cfg.branches.includes('main')) {
  fail('branches must contain "main"');
}

if (!Array.isArray(cfg.plugins)) {
  fail('plugins must be an array');
}
if (cfg.plugins.length < 7) {
  fail(`plugins array must have at least 7 entries, got ${cfg.plugins.length}`);
}

function pluginName(entry) {
  if (typeof entry === 'string') return entry;
  if (Array.isArray(entry) && typeof entry[0] === 'string') return entry[0];
  return null;
}

function pluginOptions(entry) {
  if (Array.isArray(entry) && entry.length >= 2 && entry[1] && typeof entry[1] === 'object') {
    return entry[1];
  }
  return null;
}

const presentNames = cfg.plugins.map(pluginName);

for (const required of REQUIRED_PLUGINS) {
  if (!presentNames.includes(required)) {
    fail(`plugins list missing required plugin: ${required}`);
  }
}

const execEntry = cfg.plugins.find((p) => pluginName(p) === '@semantic-release/exec');
const execOpts = pluginOptions(execEntry);
if (!execOpts) {
  fail('@semantic-release/exec must be configured with options ([plugin, options] form)');
}
if (typeof execOpts.prepareCmd !== 'string' || !execOpts.prepareCmd.includes('sync-plugin-version')) {
  fail('@semantic-release/exec.prepareCmd must contain substring "sync-plugin-version"');
}

const npmEntry = cfg.plugins.find((p) => pluginName(p) === '@semantic-release/npm');
const npmOpts = pluginOptions(npmEntry);
if (!npmOpts) {
  fail('@semantic-release/npm must be configured with options ([plugin, options] form)');
}
if (npmOpts.pkgRoot !== 'packages/cli') {
  fail(`@semantic-release/npm.pkgRoot must equal "packages/cli", got ${JSON.stringify(npmOpts.pkgRoot)}`);
}

console.log('OK .releaserc.json structure valid');
process.exit(0);
