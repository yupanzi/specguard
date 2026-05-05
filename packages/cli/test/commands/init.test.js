'use strict'
const { test, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { init, maintainGitignore } = require('../../dist/commands/init')
const { readNotebookFrontmatter } = require('../../dist/lib/yaml-io')
const helpers = require('../_helpers')

beforeEach(() => helpers.enterTmp())
afterEach(() => helpers.leaveTmp())

function readFileOr(p, fallback) {
  try {
    return fs.readFileSync(p, 'utf8')
  } catch (e) {
    if (e.code === 'ENOENT') return fallback
    throw e
  }
}

test('init: fresh project without .gitignore → skipped + full notebook skeleton', async () => {
  const r = await init({ enforcement: 'warn' })
  assert.equal(r.ok, true)
  assert.equal(r.gitignore, 'skipped')
  assert.equal(fs.existsSync('.gitignore'), false)
  assert.equal(fs.existsSync('.specguard/config.yaml'), true)
  assert.equal(fs.existsSync('.specguard/changes'), true)

  const rootFm = readNotebookFrontmatter('.specguard/notebook/INDEX.md')
  assert.ok(rootFm, 'notebook/INDEX.md must exist with frontmatter')
  assert.equal(rootFm.kind, 'index')
  assert.equal(rootFm.scope, 'notebook')
  assert.deepEqual(rootFm.references, [])

  for (const sub of ['knowledge', 'skill', 'check']) {
    const libFm = readNotebookFrontmatter(`.specguard/notebook/${sub}/INDEX.md`)
    assert.ok(libFm, `notebook/${sub}/INDEX.md must exist with frontmatter`)
    assert.equal(libFm.kind, 'index')
    assert.equal(libFm.scope, `notebook.${sub}`)
    assert.deepEqual(libFm.references, [])
  }
})

test('init: existing .gitignore without specguard line → appended (preserves original content)', async () => {
  fs.writeFileSync('.gitignore', 'node_modules/\n*.log\n')
  const r = await init({ enforcement: 'warn' })
  assert.equal(r.ok, true)
  assert.equal(r.gitignore, 'appended')
  const content = readFileOr('.gitignore', '')
  assert.match(content, /^node_modules\/\n\*\.log\n/)
  assert.match(content, /# specguard ephemeral changes - not committed/)
  assert.match(content, /^\.specguard\/changes\/$/m)
})

test('init: existing .gitignore already contains .specguard/changes/ → noop (byte-identical)', async () => {
  const original = 'node_modules/\n.specguard/changes/\n'
  fs.writeFileSync('.gitignore', original)
  const before = fs.readFileSync('.gitignore')
  const r = await init({ enforcement: 'warn' })
  assert.equal(r.ok, true)
  assert.equal(r.gitignore, 'noop')
  const after = fs.readFileSync('.gitignore')
  assert.deepEqual(after, before)
})

test('init: config already exists without --force → rejected', async () => {
  await init({ enforcement: 'warn' })
  const r2 = await init({ enforcement: 'warn' })
  assert.equal(r2.ok, false)
  assert.match(r2.errors[0], /already exists/)
})

test('init: --force re-init, .gitignore already has specguard line → still noop (no duplicate append)', async () => {
  fs.writeFileSync('.gitignore', 'node_modules/\n.specguard/changes/\n')
  await init({ enforcement: 'warn' })
  const r2 = await init({ enforcement: 'warn', force: true })
  assert.equal(r2.ok, true)
  assert.equal(r2.gitignore, 'noop')
  const content = fs.readFileSync('.gitignore', 'utf8')
  const matches = content.match(/^\.specguard\/changes\/$/gm) || []
  assert.equal(matches.length, 1, '.gitignore should have exactly one specguard marker line')
})

test('init: .gitignore only mentions .specguard/changes/ in a comment → still appended (line-exact, not substring)', async () => {
  fs.writeFileSync(
    '.gitignore',
    '# legacy: previously excluded .specguard/changes/, now retired\nnode_modules/\n'
  )
  const r = await init({ enforcement: 'warn' })
  assert.equal(r.ok, true)
  assert.equal(r.gitignore, 'appended')
  const lines = fs.readFileSync('.gitignore', 'utf8').split('\n').map((l) => l.trim())
  const markerLines = lines.filter((l) => l === '.specguard/changes/').length
  assert.equal(markerLines, 1, 'should have exactly one standalone .specguard/changes/ marker (comments do not count)')
})

test('maintainGitignore: .gitignore without trailing newline → prepend newline then append', async () => {
  fs.writeFileSync('.gitignore', 'node_modules/')
  const status = maintainGitignore(process.cwd())
  assert.equal(status, 'appended')
  const content = fs.readFileSync('.gitignore', 'utf8')
  assert.match(content, /^node_modules\/\n\n# specguard ephemeral changes/)
  assert.match(content, /\.specguard\/changes\/\n$/)
})

test('init: --force re-init does NOT overwrite a hand-edited INDEX.md (R9 idempotence)', async () => {
  await init({ enforcement: 'warn' })
  const idxPath = '.specguard/notebook/knowledge/INDEX.md'
  const original = fs.readFileSync(idxPath, 'utf8')
  const edited = original + '\n<!-- user-edited content -->\n'
  fs.writeFileSync(idxPath, edited)

  const r2 = await init({ enforcement: 'warn', force: true })
  assert.equal(r2.ok, true)
  const after = fs.readFileSync(idxPath, 'utf8')
  assert.equal(after, edited, 'hand-edited INDEX.md must not be overwritten by --force')
})
