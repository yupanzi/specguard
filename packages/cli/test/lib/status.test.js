'use strict'
const { test, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const {
  summarize,
  isAnyChangeBusy,
  formatSummary,
} = require('../../dist/lib/status')
const {
  enterTmp,
  leaveTmp,
  writeYaml,
  seedHealthyChange,
  HAPPY_SPEC_TEMPLATE,
  HAPPY_PLAN_TEMPLATE,
} = require('../_helpers')

const DATE_ID = '20260505-add-auth'
const ID = 'add-auth'

beforeEach(() => enterTmp())
afterEach(() => leaveTmp())

function writeCheck(dateId, id, { verdict, signed_off } = {}) {
  const so = signed_off === true ? '\nsigned_off: true' : ''
  writeYaml(
    dateId,
    'check.yaml',
    `version: 1
id: ${id}
check_results: []
verdict: ${verdict}${so}
`
  )
}

function writeTasks(dateId, id, status) {
  writeYaml(
    dateId,
    'tasks.yaml',
    `version: 1
id: ${id}
tasks:
  - id: t1
    do: noop
    verify: c1
    status: ${status}
`
  )
}

test('summarize: no changes/ root → empty list', () => {
  assert.deepEqual(summarize(), { changes: [] })
})

test('summarize: dateId dir but no yaml → spec=missing, plan=missing, tasks=absent, check=absent', () => {
  fs.mkdirSync(path.join('.specguard', 'changes', DATE_ID), { recursive: true })
  const r = summarize()
  assert.equal(r.changes.length, 1)
  const c = r.changes[0]
  assert.equal(c.dateId, DATE_ID)
  assert.equal(c.spec, 'missing')
  assert.equal(c.plan, 'missing')
  assert.equal(c.tasks.state, 'absent')
  assert.equal(c.check.state, 'absent')
  assert.match(c.nextHint, /spec\.yaml missing/)
})

test('summarize: spec only (no plan) → plan=missing, nextHint suggests sg-plan-tasks', () => {
  writeYaml(DATE_ID, 'spec.yaml', HAPPY_SPEC_TEMPLATE(ID))
  const r = summarize()
  const c = r.changes[0]
  assert.equal(c.spec, 'present')
  assert.equal(c.plan, 'missing')
  assert.equal(c.tasks.state, 'absent')
  assert.match(c.nextHint, /plan\.yaml missing/)
})

test('summarize: spec + plan only (no tasks) → tasks=absent', () => {
  writeYaml(DATE_ID, 'spec.yaml', HAPPY_SPEC_TEMPLATE(ID))
  writeYaml(DATE_ID, 'plan.yaml', HAPPY_PLAN_TEMPLATE(ID))
  const r = summarize()
  const c = r.changes[0]
  assert.equal(c.plan, 'present')
  assert.equal(c.tasks.state, 'absent')
})

test('summarize: healthy seed (one pending task) → tasks=in-progress', () => {
  seedHealthyChange(DATE_ID, ID)
  const r = summarize()
  assert.equal(r.changes[0].tasks.state, 'in-progress')
})

test('summarize: tasks contain failed entry → tasks=has-failures', () => {
  writeYaml(DATE_ID, 'spec.yaml', HAPPY_SPEC_TEMPLATE(ID))
  writeYaml(DATE_ID, 'plan.yaml', HAPPY_PLAN_TEMPLATE(ID))
  writeTasks(DATE_ID, ID, 'failed')
  const r = summarize()
  assert.equal(r.changes[0].tasks.state, 'has-failures')
  assert.deepEqual(r.changes[0].tasks.failedTasks, ['t1'])
})

test('summarize: tasks all passed → tasks=all-pass', () => {
  writeYaml(DATE_ID, 'spec.yaml', HAPPY_SPEC_TEMPLATE(ID))
  writeYaml(DATE_ID, 'plan.yaml', HAPPY_PLAN_TEMPLATE(ID))
  writeTasks(DATE_ID, ID, 'passed')
  const r = summarize()
  assert.equal(r.changes[0].tasks.state, 'all-pass')
})

test('deriveCheckStatus via summarize: verdict=done + signed_off=false → awaiting-approval', () => {
  writeYaml(DATE_ID, 'spec.yaml', HAPPY_SPEC_TEMPLATE(ID))
  writeCheck(DATE_ID, ID, { verdict: 'done' })
  const c = summarize().changes[0].check
  assert.equal(c.state, 'awaiting-approval')
  assert.equal(c.verdict, 'done')
})

test('deriveCheckStatus via summarize: verdict=done + signed_off=true → signed-off', () => {
  writeYaml(DATE_ID, 'spec.yaml', HAPPY_SPEC_TEMPLATE(ID))
  writeCheck(DATE_ID, ID, { verdict: 'done', signed_off: true })
  const c = summarize().changes[0].check
  assert.equal(c.state, 'signed-off')
  assert.equal(c.verdict, 'done')
})

test('deriveCheckStatus via summarize: verdict=re-plan → rejected', () => {
  writeYaml(DATE_ID, 'spec.yaml', HAPPY_SPEC_TEMPLATE(ID))
  writeCheck(DATE_ID, ID, { verdict: 're-plan' })
  const c = summarize().changes[0].check
  assert.equal(c.state, 'rejected')
  assert.equal(c.verdict, 're-plan')
})

test('deriveCheckStatus via summarize: verdict=ksc-reject → rejected', () => {
  writeYaml(DATE_ID, 'spec.yaml', HAPPY_SPEC_TEMPLATE(ID))
  writeCheck(DATE_ID, ID, { verdict: 'ksc-reject' })
  const c = summarize().changes[0].check
  assert.equal(c.state, 'rejected')
  assert.equal(c.verdict, 'ksc-reject')
})

test('deriveCheckStatus via summarize: verdict=awaiting-llm → awaiting-llm', () => {
  writeYaml(DATE_ID, 'spec.yaml', HAPPY_SPEC_TEMPLATE(ID))
  writeCheck(DATE_ID, ID, { verdict: 'awaiting-llm' })
  const c = summarize().changes[0].check
  assert.equal(c.state, 'awaiting-llm')
})

test('isAnyChangeBusy: no changes → false', () => {
  assert.equal(isAnyChangeBusy(), false)
})

test('isAnyChangeBusy: tasks in-progress → true', () => {
  seedHealthyChange(DATE_ID, ID)
  assert.equal(isAnyChangeBusy(), true)
})

test('isAnyChangeBusy: tasks failed → true', () => {
  writeYaml(DATE_ID, 'spec.yaml', HAPPY_SPEC_TEMPLATE(ID))
  writeTasks(DATE_ID, ID, 'failed')
  assert.equal(isAnyChangeBusy(), true)
})

test('isAnyChangeBusy: tasks all-pass + check awaiting-approval → true', () => {
  writeYaml(DATE_ID, 'spec.yaml', HAPPY_SPEC_TEMPLATE(ID))
  writeTasks(DATE_ID, ID, 'passed')
  writeCheck(DATE_ID, ID, { verdict: 'done' })
  assert.equal(isAnyChangeBusy(), true)
})

test('isAnyChangeBusy: tasks all-pass + check signed-off → false', () => {
  writeYaml(DATE_ID, 'spec.yaml', HAPPY_SPEC_TEMPLATE(ID))
  writeTasks(DATE_ID, ID, 'passed')
  writeCheck(DATE_ID, ID, { verdict: 'done', signed_off: true })
  assert.equal(isAnyChangeBusy(), false)
})

test('formatSummary: empty changes → "no changes in progress"', () => {
  assert.match(formatSummary({ changes: [] }), /no changes in progress/)
})

test('formatSummary: non-empty → contains dateId, spec/plan/tasks/check lines, nextHint arrow', () => {
  seedHealthyChange(DATE_ID, ID)
  const out = formatSummary(summarize())
  assert.match(out, /20260505-add-auth/)
  assert.match(out, /spec:/)
  assert.match(out, /plan:/)
  assert.match(out, /tasks:/)
  assert.match(out, /check:/)
  assert.match(out, /→/)
})
