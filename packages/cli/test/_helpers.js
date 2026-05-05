'use strict'
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { versionDir, frontmatterBlock } = require('../dist/lib/yaml-io')

let tmpRoot
let originalCwd

function enterTmp() {
  originalCwd = process.cwd()
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'specguard-test-'))
  process.chdir(tmpRoot)
  return tmpRoot
}

function leaveTmp() {
  process.chdir(originalCwd)
  fs.rmSync(tmpRoot, { recursive: true, force: true })
}

function writeYaml(dateId, name, content, version = 1) {
  const dir = versionDir(dateId, version)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, name), content)
}

const HAPPY_PLAN_TEMPLATE = (id) => `version: 1
id: ${id}
goal: smoke
asks: []
checks:
  - id: c1
    what: x
    how: { cmd: [node, --version] }
tasks:
  - id: t1
    do: noop
    verify: c1
`

const TEST_DATE = '20260505'

function writeNotebookFile(filepath, frontmatter, body = '') {
  fs.mkdirSync(path.dirname(filepath), { recursive: true })
  fs.writeFileSync(filepath, frontmatterBlock(frontmatter) + '\n' + body)
}

function defaultRootIndexFm(overrides = {}) {
  return {
    topic: 'notebook-root',
    kind: 'index',
    scope: 'notebook',
    version: 1,
    source_change_id: 'notebook-index',
    source_date: TEST_DATE,
    references: [],
    ...overrides,
  }
}

function defaultLibraryIndexFm(library, overrides = {}) {
  return {
    topic: `${library}-index`,
    kind: 'index',
    scope: `notebook.${library}`,
    version: 1,
    source_change_id: 'notebook-index',
    source_date: TEST_DATE,
    references: [],
    ...overrides,
  }
}

function defaultTopicFm(library, slug, refId, overrides = {}) {
  return {
    topic: slug,
    kind: 'topic',
    scope: `notebook.${library}`,
    library,
    ref_id: refId,
    version: 1,
    source_change_id: 'project-init',
    source_date: TEST_DATE,
    ...overrides,
  }
}

function seedHealthyNotebook() {
  writeNotebookFile('.specguard/notebook/INDEX.md', defaultRootIndexFm())
  for (const lib of ['knowledge', 'skill', 'check']) {
    writeNotebookFile(
      `.specguard/notebook/${lib}/INDEX.md`,
      defaultLibraryIndexFm(lib)
    )
  }
}

module.exports = {
  enterTmp,
  leaveTmp,
  writeYaml,
  HAPPY_PLAN_TEMPLATE,
  TEST_DATE,
  writeNotebookFile,
  defaultRootIndexFm,
  defaultLibraryIndexFm,
  defaultTopicFm,
  seedHealthyNotebook,
  get tmpRoot() {
    return tmpRoot
  },
}
