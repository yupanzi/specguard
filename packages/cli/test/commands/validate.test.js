'use strict'
const { test, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const { validate, validateNotebook } = require('../../dist/commands/validate')
const {
  enterTmp,
  leaveTmp,
  writeYaml,
  HAPPY_PLAN_TEMPLATE,
  writeNotebookFile,
  defaultRootIndexFm,
  defaultLibraryIndexFm,
  defaultTopicFm,
  seedHealthyNotebook,
} = require('../_helpers')

const DATE_ID = '20260505-add-auth'
const HAPPY = HAPPY_PLAN_TEMPLATE('add-auth')

beforeEach(() => enterTmp())
afterEach(() => leaveTmp())

test('validate: happy plan → ok=true, no errors', () => {
  writeYaml(DATE_ID, 'plan.yaml', HAPPY)
  const r = validate(DATE_ID)
  assert.equal(r.ok, true)
  assert.deepEqual(r.errors, [])
})

test('validate: happy plan with llm how → ok', () => {
  const yaml = HAPPY.replace(
    'how: { cmd: [node, --version] }',
    'how: { llm: "is it correct?" }'
  )
  writeYaml(DATE_ID, 'plan.yaml', yaml)
  const r = validate(DATE_ID)
  assert.equal(r.ok, true)
})

test('validate: happy plan with manual how → ok', () => {
  const yaml = HAPPY.replace(
    'how: { cmd: [node, --version] }',
    'how: { manual: "review by hand" }'
  )
  writeYaml(DATE_ID, 'plan.yaml', yaml)
  const r = validate(DATE_ID)
  assert.equal(r.ok, true)
})

test('validate: how as raw string → exactly 1 error (must be object), no oneOf noise', () => {
  const yaml = HAPPY.replace(
    'how: { cmd: [node, --version] }',
    'how: "cmd: node --version"'
  )
  writeYaml(DATE_ID, 'plan.yaml', yaml)
  const r = validate(DATE_ID)
  assert.equal(r.ok, false)
  assert.equal(r.errors.length, 1, `expected 1 error, got: ${r.errors.join(' / ')}`)
  assert.match(r.errors[0], /\/checks\/0\/how must be object/)
})

test('validate: empty cmd array → exactly 1 error (minItems)', () => {
  const yaml = HAPPY.replace(
    'how: { cmd: [node, --version] }',
    'how: { cmd: [] }'
  )
  writeYaml(DATE_ID, 'plan.yaml', yaml)
  const r = validate(DATE_ID)
  assert.equal(r.ok, false)
  assert.equal(r.errors.length, 1)
  assert.match(r.errors[0], /\/checks\/0\/how\/cmd must NOT have fewer than 1 items/)
})

test('validate: dual cmd+llm → exactly 1 error (maxProperties)', () => {
  const yaml = HAPPY.replace(
    'how: { cmd: [node, --version] }',
    'how: { cmd: [node], llm: "x" }'
  )
  writeYaml(DATE_ID, 'plan.yaml', yaml)
  const r = validate(DATE_ID)
  assert.equal(r.ok, false)
  assert.equal(r.errors.length, 1)
  assert.match(r.errors[0], /must NOT have more than 1 properties/)
})

test('validate: empty how object → minProperties', () => {
  const yaml = HAPPY.replace(
    'how: { cmd: [node, --version] }',
    'how: {}'
  )
  writeYaml(DATE_ID, 'plan.yaml', yaml)
  const r = validate(DATE_ID)
  assert.equal(r.ok, false)
  assert.match(r.errors.join('\n'), /must NOT have fewer than 1 properties/)
})

test('validate: unknown key in how → unknown field', () => {
  const yaml = HAPPY.replace(
    'how: { cmd: [node, --version] }',
    'how: { shell: "x" }'
  )
  writeYaml(DATE_ID, 'plan.yaml', yaml)
  const r = validate(DATE_ID)
  assert.equal(r.ok, false)
  assert.match(r.errors.join('\n'), /unknown field: shell/)
})

test('validate: non-string token in cmd → must be string', () => {
  const yaml = HAPPY.replace(
    'how: { cmd: [node, --version] }',
    'how: { cmd: [node, 42] }'
  )
  writeYaml(DATE_ID, 'plan.yaml', yaml)
  const r = validate(DATE_ID)
  assert.equal(r.ok, false)
  assert.equal(r.errors.length, 1)
  assert.match(r.errors[0], /\/checks\/0\/how\/cmd\/1 must be string/)
})

test('validate: dup check id → findDuplicates', () => {
  const yaml = `version: 1
id: add-auth
goal: smoke
asks: []
checks:
  - id: c1
    what: x
    how: { cmd: [node, --version] }
  - id: c1
    what: y
    how: { cmd: [ls] }
tasks:
  - id: t1
    do: noop
    verify: c1
`
  writeYaml(DATE_ID, 'plan.yaml', yaml)
  const r = validate(DATE_ID)
  assert.equal(r.ok, false)
  assert.match(r.errors.join('\n'), /checks\[1\]\.id duplicate/)
})

test('validate: task verify references unknown check → ref-integrity', () => {
  const yaml = HAPPY.replace('verify: c1', 'verify: missing')
  writeYaml(DATE_ID, 'plan.yaml', yaml)
  const r = validate(DATE_ID)
  assert.equal(r.ok, false)
  assert.match(r.errors.join('\n'), /references unknown check: "missing"/)
})

test('validate: id mismatch dateId → fail', () => {
  const yaml = HAPPY.replace('id: add-auth', 'id: wrong-id')
  writeYaml(DATE_ID, 'plan.yaml', yaml)
  const r = validate(DATE_ID)
  assert.equal(r.ok, false)
  assert.match(r.errors.join('\n'), /does not match parsed id/)
})

test('validate: pipeline attempts.length > 3 → exceeds MAX_ATTEMPTS', () => {
  writeYaml(DATE_ID, 'plan.yaml', HAPPY)
  const pipeline = `id: add-auth
attempts:
  - n: 1
    at: '2026-05-05T00:00:00Z'
    task_results:
      - id: t1
        status: pass
  - n: 2
    at: '2026-05-05T00:00:00Z'
    task_results:
      - id: t1
        status: pass
  - n: 3
    at: '2026-05-05T00:00:00Z'
    task_results:
      - id: t1
        status: pass
  - n: 4
    at: '2026-05-05T00:00:00Z'
    task_results:
      - id: t1
        status: pass
`
  writeYaml(DATE_ID, 'pipeline.yaml', pipeline)
  const r = validate(DATE_ID)
  assert.equal(r.ok, false)
  assert.match(r.errors.join('\n'), /attempts\.length=4 exceeds MAX_ATTEMPTS=3/)
})

test('validate: pipeline n non-monotonic → checkMonotonicN', () => {
  writeYaml(DATE_ID, 'plan.yaml', HAPPY)
  const pipeline = `id: add-auth
attempts:
  - n: 2
    at: '2026-05-05T00:00:00Z'
    task_results: []
  - n: 1
    at: '2026-05-05T00:00:00Z'
    task_results: []
`
  writeYaml(DATE_ID, 'pipeline.yaml', pipeline)
  const r = validate(DATE_ID)
  assert.equal(r.ok, false)
  assert.match(r.errors.join('\n'), /must be non-decreasing/)
})

// ─── validate(dateId) is independent of notebook state ──────

test('validate(dateId): broken notebook does NOT taint dateId verdict', () => {
  writeYaml(DATE_ID, 'plan.yaml', HAPPY)
  seedHealthyNotebook()
  writeNotebookFile(
    '.specguard/notebook/knowledge/auth.md',
    defaultTopicFm('knowledge', 'auth', 'K-01')
  )
  const r = validate(DATE_ID)
  assert.equal(r.ok, true, `validate(dateId) must not run notebook checks; errors: ${r.errors.join(' / ')}`)
})

// ─── validateNotebook (notebook integrity, dateId-free) ─────

test('validateNotebook: notebook absent → empty errors', () => {
  const errs = validateNotebook()
  assert.deepEqual(errs, [])
})

test('validateNotebook: cold-start (empty INDEXes) → empty errors', () => {
  seedHealthyNotebook()
  const errs = validateNotebook()
  assert.deepEqual(errs, [])
})

test('validateNotebook: root INDEX missing scope → fail', () => {
  seedHealthyNotebook()
  const fm = defaultRootIndexFm()
  delete fm.scope
  writeNotebookFile('.specguard/notebook/INDEX.md', fm)
  const errs = validateNotebook()
  assert.match(errs.join('\n'), /missing required field: scope/)
})

test('validateNotebook: kind=index without references → fail (conditional schema)', () => {
  seedHealthyNotebook()
  const fm = defaultLibraryIndexFm('knowledge')
  delete fm.references
  writeNotebookFile('.specguard/notebook/knowledge/INDEX.md', fm)
  const errs = validateNotebook()
  assert.match(errs.join('\n'), /missing required field: references/)
})

test('validateNotebook: kind=topic without ref_id → fail (conditional schema)', () => {
  seedHealthyNotebook()
  writeNotebookFile(
    '.specguard/notebook/knowledge/INDEX.md',
    defaultLibraryIndexFm('knowledge', {
      references: [{ ref_id: 'K-01', file: 'auth.md', when: 'auth changes' }],
    })
  )
  const tFm = defaultTopicFm('knowledge', 'auth', 'K-01')
  delete tFm.ref_id
  writeNotebookFile('.specguard/notebook/knowledge/auth.md', tFm)
  const errs = validateNotebook()
  assert.match(errs.join('\n'), /missing required field: ref_id/)
})

test('validateNotebook: topic with mismatched library vs scope → fail', () => {
  seedHealthyNotebook()
  writeNotebookFile(
    '.specguard/notebook/knowledge/INDEX.md',
    defaultLibraryIndexFm('knowledge', {
      references: [{ ref_id: 'K-01', file: 'auth.md', when: 'auth changes' }],
    })
  )
  writeNotebookFile(
    '.specguard/notebook/knowledge/auth.md',
    defaultTopicFm('knowledge', 'auth', 'K-01', { scope: 'notebook.skill' })
  )
  const errs = validateNotebook()
  assert.match(errs.join('\n'), /scope must be "notebook\.knowledge"/)
})

test('validateNotebook: orphan topic (file present, not in references) → fail', () => {
  seedHealthyNotebook()
  writeNotebookFile(
    '.specguard/notebook/knowledge/auth.md',
    defaultTopicFm('knowledge', 'auth', 'K-01')
  )
  const errs = validateNotebook()
  assert.match(errs.join('\n'), /orphan topic: auth\.md/)
})

test('validateNotebook: dead reference (references → missing file) → fail', () => {
  seedHealthyNotebook()
  writeNotebookFile(
    '.specguard/notebook/knowledge/INDEX.md',
    defaultLibraryIndexFm('knowledge', {
      references: [{ ref_id: 'K-01', file: 'missing-topic.md', when: 'never' }],
    })
  )
  const errs = validateNotebook()
  assert.match(errs.join('\n'), /dead reference: K-01.*missing-topic\.md/)
})

test('validateNotebook: duplicate ref_id within a library → fail', () => {
  seedHealthyNotebook()
  writeNotebookFile(
    '.specguard/notebook/knowledge/INDEX.md',
    defaultLibraryIndexFm('knowledge', {
      references: [
        { ref_id: 'K-01', file: 'auth.md', when: 'auth' },
        { ref_id: 'K-01', file: 'order.md', when: 'order' },
      ],
    })
  )
  writeNotebookFile(
    '.specguard/notebook/knowledge/auth.md',
    defaultTopicFm('knowledge', 'auth', 'K-01')
  )
  writeNotebookFile(
    '.specguard/notebook/knowledge/order.md',
    defaultTopicFm('knowledge', 'order', 'K-01')
  )
  const errs = validateNotebook()
  assert.match(errs.join('\n'), /duplicate reference ref_id: "K-01"/)
})

test('validateNotebook: ref_id axis mismatch (S-01 in knowledge/) → fail', () => {
  seedHealthyNotebook()
  writeNotebookFile(
    '.specguard/notebook/knowledge/INDEX.md',
    defaultLibraryIndexFm('knowledge', {
      references: [{ ref_id: 'S-01', file: 'wrong.md', when: 'never' }],
    })
  )
  writeNotebookFile(
    '.specguard/notebook/knowledge/wrong.md',
    defaultTopicFm('knowledge', 'wrong', 'S-01')
  )
  const errs = validateNotebook()
  assert.match(errs.join('\n'), /axis mismatch: expected K-NN/)
})
