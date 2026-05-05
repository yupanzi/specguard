'use strict'
const { test, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { verify } = require('../../dist/commands/verify')
const {
  loadCheckOptional,
  logsDir,
  versionDir,
} = require('../../dist/lib/yaml-io')
const helpers = require('../_helpers')

const DATE_ID = '20260505-add-auth'

function planWithHow(howYaml) {
  return `version: 1
id: add-auth
goal: smoke
asks: []
checks:
  - id: c1
    what: x
    how: ${howYaml}
tasks:
  - id: t1
    do: noop
    verify: c1
`
}

function readLog(checkId) {
  return fs.readFileSync(path.join(logsDir(DATE_ID, 1, 1), `${checkId}.log`), 'utf8')
}

beforeEach(() => helpers.enterTmp())
afterEach(() => helpers.leaveTmp())

test('verify: cmd that exits 0 → pass + verdict=done', () => {
  helpers.writeYaml(DATE_ID, 'plan.yaml', planWithHow('{ cmd: [node, --version] }'))
  const r = verify(DATE_ID, { verdictOnly: false })
  assert.equal(r.ok, true)
  assert.equal(r.verdict, 'done')
  const c = loadCheckOptional(DATE_ID, 1)
  assert.equal(c.attempts[0].check_results[0].status, 'pass')
})

test('verify: cmd that exits non-zero → fail + verdict=re-run', () => {
  helpers.writeYaml(DATE_ID, 'plan.yaml', planWithHow('{ cmd: [node, -e, "process.exit(1)"] }'))
  const r = verify(DATE_ID, { verdictOnly: false })
  assert.equal(r.ok, true)
  assert.equal(r.verdict, 're-run')
  const c = loadCheckOptional(DATE_ID, 1)
  assert.equal(c.attempts[0].check_results[0].status, 'fail')
})

test('verify: llm how → pending + verdict=awaiting-llm', () => {
  helpers.writeYaml(DATE_ID, 'plan.yaml', planWithHow('{ llm: "is it correct" }'))
  const r = verify(DATE_ID, { verdictOnly: false })
  assert.equal(r.ok, true)
  assert.equal(r.verdict, 'awaiting-llm')
  const c = loadCheckOptional(DATE_ID, 1)
  assert.equal(c.attempts[0].check_results[0].status, 'pending')
})

test('verify: manual how → pending + verdict=awaiting-llm', () => {
  helpers.writeYaml(DATE_ID, 'plan.yaml', planWithHow('{ manual: "review by hand" }'))
  const r = verify(DATE_ID, { verdictOnly: false })
  assert.equal(r.ok, true)
  assert.equal(r.verdict, 'awaiting-llm')
})

test('verify: cmd writes log file with EXIT/CMD/STDOUT/STDERR sections', () => {
  helpers.writeYaml(DATE_ID, 'plan.yaml', planWithHow('{ cmd: [node, --version] }'))
  verify(DATE_ID, { verdictOnly: false })
  const log = readLog('c1')
  assert.match(log, /^EXIT: 0/m)
  assert.match(log, /^CMD: node --version/m)
  assert.match(log, /--- STDOUT ---/)
  assert.match(log, /--- STDERR ---/)
})

test('verify: NO shell — && in args is literal, not a chain operator', () => {
  // regression: array form must NOT invoke a shell — `&&` must stay a literal arg
  helpers.writeYaml(
    DATE_ID,
    'plan.yaml',
    planWithHow('{ cmd: [echo, hi, "&&", echo, bye] }')
  )
  verify(DATE_ID, { verdictOnly: false })
  const log = readLog('c1')
  assert.match(log, /hi && echo bye/)
})

test('verify: NO shell — | in args is literal, not a pipe', () => {
  helpers.writeYaml(
    DATE_ID,
    'plan.yaml',
    planWithHow('{ cmd: [echo, "a|b"] }')
  )
  verify(DATE_ID, { verdictOnly: false })
  const log = readLog('c1')
  assert.match(log, /a\|b/)
})

test('verify: mixed cmd+llm → verdict=awaiting-llm (cmd pass, llm pending)', () => {
  const planYaml = `version: 1
id: add-auth
goal: smoke
asks: []
checks:
  - id: c-cmd
    what: x
    how: { cmd: [node, --version] }
  - id: c-llm
    what: y
    how: { llm: "is it correct" }
tasks:
  - id: t1
    do: noop
    verify: c-cmd
`
  helpers.writeYaml(DATE_ID, 'plan.yaml', planYaml)
  const r = verify(DATE_ID, { verdictOnly: false })
  assert.equal(r.verdict, 'awaiting-llm')
  const c = loadCheckOptional(DATE_ID, 1)
  const byId = Object.fromEntries(
    c.attempts[0].check_results.map((r) => [r.id, r.status])
  )
  assert.equal(byId['c-cmd'], 'pass')
  assert.equal(byId['c-llm'], 'pending')
})

test('verify: --verdict-only does NOT respawn cmd, only recomputes verdict', () => {
  helpers.writeYaml(DATE_ID, 'plan.yaml', planWithHow('{ cmd: [node, --version] }'))
  verify(DATE_ID, { verdictOnly: false })
  // wipe logs to simulate "old check.yaml on disk, log dir already cleaned"
  const logs = path.join(versionDir(DATE_ID, 1), 'logs')
  fs.rmSync(logs, { recursive: true, force: true })
  const r = verify(DATE_ID, { verdictOnly: true })
  assert.equal(r.ok, true)
  assert.equal(r.verdict, 'done')
  assert.equal(fs.existsSync(logs), false, 'verdictOnly should not respawn / recreate logs')
})
