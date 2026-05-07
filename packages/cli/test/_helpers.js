'use strict'
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { changeDir, taskDir, frontmatterBlock } = require('../dist/lib/yaml-io')

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

function writeYaml(dateId, name, content) {
  const dir = changeDir(dateId)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, name), content)
}

function writeTaskDebug(dateId, taskId, content = 'debug log') {
  const dir = taskDir(dateId, taskId)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'debug.log'), content)
}

const HAPPY_SPEC_TEMPLATE = (id) => `version: 1
id: ${id}
goal: smoke
asks: []
checks:
  - id: c1
    what: x
    how: { cmd: [node, --version] }
`

const HAPPY_PLAN_TEMPLATE = (id) => `version: 1
id: ${id}
files:
  - src/foo.ts
approach: |
  Implement foo via node.
`

const HAPPY_TASKS_TEMPLATE = (id) => `version: 1
id: ${id}
tasks:
  - id: t1
    do: noop
    verify: c1
    status: pending
`

function seedHealthyChange(dateId, id) {
  writeYaml(dateId, 'spec.yaml', HAPPY_SPEC_TEMPLATE(id))
  writeYaml(dateId, 'plan.yaml', HAPPY_PLAN_TEMPLATE(id))
  writeYaml(dateId, 'tasks.yaml', HAPPY_TASKS_TEMPLATE(id))
}

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
  writeTaskDebug,
  HAPPY_SPEC_TEMPLATE,
  HAPPY_PLAN_TEMPLATE,
  HAPPY_TASKS_TEMPLATE,
  seedHealthyChange,
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
