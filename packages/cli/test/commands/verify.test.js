'use strict'
const { test, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const { verify } = require('../../dist/commands/verify')
const { loadCheckOptional } = require('../../dist/lib/yaml-io')
const helpers = require('../_helpers')

const DATE_ID = '20260505-add-auth'

function specWithHow(howYaml) {
  return `version: 1
id: add-auth
goal: smoke
asks: []
checks:
  - id: c1
    what: x
    how: ${howYaml}
`
}

beforeEach(() => helpers.enterTmp())
afterEach(() => helpers.leaveTmp())

test('verify: cmd that exits 0 → pass + verdict=done', () => {
  helpers.writeYaml(DATE_ID, 'spec.yaml', specWithHow('{ cmd: [node, --version] }'))
  const r = verify(DATE_ID, { verdictOnly: false })
  assert.equal(r.ok, true)
  assert.equal(r.verdict, 'done')
  const c = loadCheckOptional(DATE_ID)
  assert.equal(c.check_results[0].status, 'pass')
})

test('verify: cmd that exits non-zero → fail + verdict=re-plan', () => {
  helpers.writeYaml(DATE_ID, 'spec.yaml', specWithHow('{ cmd: [node, -e, "process.exit(1)"] }'))
  const r = verify(DATE_ID, { verdictOnly: false })
  assert.equal(r.ok, true)
  assert.equal(r.verdict, 're-plan')
  const c = loadCheckOptional(DATE_ID)
  assert.equal(c.check_results[0].status, 'fail')
})

test('verify: llm how → pending + verdict=awaiting-llm', () => {
  helpers.writeYaml(DATE_ID, 'spec.yaml', specWithHow('{ llm: "is it correct" }'))
  const r = verify(DATE_ID, { verdictOnly: false })
  assert.equal(r.ok, true)
  assert.equal(r.verdict, 'awaiting-llm')
  const c = loadCheckOptional(DATE_ID)
  assert.equal(c.check_results[0].status, 'pending')
})

test('verify: manual how → pending + verdict=awaiting-llm', () => {
  helpers.writeYaml(DATE_ID, 'spec.yaml', specWithHow('{ manual: "review by hand" }'))
  const r = verify(DATE_ID, { verdictOnly: false })
  assert.equal(r.ok, true)
  assert.equal(r.verdict, 'awaiting-llm')
})

test('verify: cmd evidence string carries exit code + cmd line', () => {
  helpers.writeYaml(DATE_ID, 'spec.yaml', specWithHow('{ cmd: [node, --version] }'))
  verify(DATE_ID, { verdictOnly: false })
  const c = loadCheckOptional(DATE_ID)
  assert.match(c.check_results[0].evidence, /exit=0/)
  assert.match(c.check_results[0].evidence, /cmd=node --version/)
})

test('verify: NO shell — && in args is literal, not a chain operator', () => {
  helpers.writeYaml(
    DATE_ID,
    'spec.yaml',
    specWithHow('{ cmd: [echo, hi, "&&", echo, bye] }')
  )
  verify(DATE_ID, { verdictOnly: false })
  const c = loadCheckOptional(DATE_ID)
  assert.match(c.check_results[0].evidence, /hi && echo bye/)
})

test('verify: NO shell — | in args is literal, not a pipe', () => {
  helpers.writeYaml(
    DATE_ID,
    'spec.yaml',
    specWithHow('{ cmd: [echo, "a|b"] }')
  )
  verify(DATE_ID, { verdictOnly: false })
  const c = loadCheckOptional(DATE_ID)
  assert.match(c.check_results[0].evidence, /a\|b/)
})

test('verify: mixed cmd+llm → verdict=awaiting-llm (cmd pass, llm pending)', () => {
  const specYaml = `version: 1
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
`
  helpers.writeYaml(DATE_ID, 'spec.yaml', specYaml)
  const r = verify(DATE_ID, { verdictOnly: false })
  assert.equal(r.verdict, 'awaiting-llm')
  const c = loadCheckOptional(DATE_ID)
  const byId = Object.fromEntries(
    c.check_results.map((r) => [r.id, r.status])
  )
  assert.equal(byId['c-cmd'], 'pass')
  assert.equal(byId['c-llm'], 'pending')
})

test('verify: --verdict-only does NOT respawn cmd, only recomputes verdict', () => {
  helpers.writeYaml(DATE_ID, 'spec.yaml', specWithHow('{ cmd: [node, --version] }'))
  verify(DATE_ID, { verdictOnly: false })
  const r = verify(DATE_ID, { verdictOnly: true })
  assert.equal(r.ok, true)
  assert.equal(r.verdict, 'done')
})
