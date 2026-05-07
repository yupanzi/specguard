'use strict'
const { test, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { validate, validateNotebook } = require('../../dist/commands/validate')
const {
  enterTmp,
  leaveTmp,
  writeYaml,
  HAPPY_SPEC_TEMPLATE,
  HAPPY_PLAN_TEMPLATE,
  HAPPY_TASKS_TEMPLATE,
  seedHealthyChange,
  writeTaskDebug,
  writeNotebookFile,
  defaultRootIndexFm,
  defaultLibraryIndexFm,
  defaultTopicFm,
  seedHealthyNotebook,
} = require('../_helpers')

const DATE_ID = '20260505-add-auth'
const ID = 'add-auth'

beforeEach(() => enterTmp())
afterEach(() => leaveTmp())

test('validate: spec only → ok=true', () => {
  writeYaml(DATE_ID, 'spec.yaml', HAPPY_SPEC_TEMPLATE(ID))
  const r = validate(DATE_ID)
  assert.equal(r.ok, true, `errors: ${r.errors.join(' / ')}`)
  assert.deepEqual(r.errors, [])
})

test('validate: spec + plan + tasks all healthy → ok', () => {
  seedHealthyChange(DATE_ID, ID)
  const r = validate(DATE_ID)
  assert.equal(r.ok, true, `errors: ${r.errors.join(' / ')}`)
})

test('validate: spec missing → fail', () => {
  const r = validate(DATE_ID)
  assert.equal(r.ok, false)
  assert.match(r.errors.join('\n'), /spec\.yaml not found/)
})

test('validate: spec with llm how → ok', () => {
  const yaml = HAPPY_SPEC_TEMPLATE(ID).replace(
    'how: { cmd: [node, --version] }',
    'how: { llm: "is it correct?" }'
  )
  writeYaml(DATE_ID, 'spec.yaml', yaml)
  const r = validate(DATE_ID)
  assert.equal(r.ok, true)
})

test('validate: spec with manual how → ok', () => {
  const yaml = HAPPY_SPEC_TEMPLATE(ID).replace(
    'how: { cmd: [node, --version] }',
    'how: { manual: "review by hand" }'
  )
  writeYaml(DATE_ID, 'spec.yaml', yaml)
  const r = validate(DATE_ID)
  assert.equal(r.ok, true)
})

test('validate: how as raw string → exactly 1 error (must be object)', () => {
  const yaml = HAPPY_SPEC_TEMPLATE(ID).replace(
    'how: { cmd: [node, --version] }',
    'how: "cmd: node --version"'
  )
  writeYaml(DATE_ID, 'spec.yaml', yaml)
  const r = validate(DATE_ID)
  assert.equal(r.ok, false)
  assert.equal(r.errors.length, 1, `expected 1 error, got: ${r.errors.join(' / ')}`)
  assert.match(r.errors[0], /\/checks\/0\/how must be object/)
})

test('validate: empty cmd array → exactly 1 error (minItems)', () => {
  const yaml = HAPPY_SPEC_TEMPLATE(ID).replace(
    'how: { cmd: [node, --version] }',
    'how: { cmd: [] }'
  )
  writeYaml(DATE_ID, 'spec.yaml', yaml)
  const r = validate(DATE_ID)
  assert.equal(r.ok, false)
  assert.equal(r.errors.length, 1)
  assert.match(r.errors[0], /\/checks\/0\/how\/cmd must NOT have fewer than 1 items/)
})

test('validate: dual cmd+llm → exactly 1 error (maxProperties)', () => {
  const yaml = HAPPY_SPEC_TEMPLATE(ID).replace(
    'how: { cmd: [node, --version] }',
    'how: { cmd: [node], llm: "x" }'
  )
  writeYaml(DATE_ID, 'spec.yaml', yaml)
  const r = validate(DATE_ID)
  assert.equal(r.ok, false)
  assert.equal(r.errors.length, 1)
  assert.match(r.errors[0], /must NOT have more than 1 properties/)
})

test('validate: empty how object → minProperties', () => {
  const yaml = HAPPY_SPEC_TEMPLATE(ID).replace(
    'how: { cmd: [node, --version] }',
    'how: {}'
  )
  writeYaml(DATE_ID, 'spec.yaml', yaml)
  const r = validate(DATE_ID)
  assert.equal(r.ok, false)
  assert.match(r.errors.join('\n'), /must NOT have fewer than 1 properties/)
})

test('validate: unknown key in how → unknown field', () => {
  const yaml = HAPPY_SPEC_TEMPLATE(ID).replace(
    'how: { cmd: [node, --version] }',
    'how: { shell: "x" }'
  )
  writeYaml(DATE_ID, 'spec.yaml', yaml)
  const r = validate(DATE_ID)
  assert.equal(r.ok, false)
  assert.match(r.errors.join('\n'), /unknown field: shell/)
})

test('validate: non-string token in cmd → must be string', () => {
  const yaml = HAPPY_SPEC_TEMPLATE(ID).replace(
    'how: { cmd: [node, --version] }',
    'how: { cmd: [node, 42] }'
  )
  writeYaml(DATE_ID, 'spec.yaml', yaml)
  const r = validate(DATE_ID)
  assert.equal(r.ok, false)
  assert.equal(r.errors.length, 1)
  assert.match(r.errors[0], /\/checks\/0\/how\/cmd\/1 must be string/)
})

test('validate: dup check id in spec → findDuplicates', () => {
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
`
  writeYaml(DATE_ID, 'spec.yaml', yaml)
  const r = validate(DATE_ID)
  assert.equal(r.ok, false)
  assert.match(r.errors.join('\n'), /checks\[1\]\.id duplicate/)
})

test('validate: tasks.verify references unknown spec.checks.id → ref-integrity', () => {
  writeYaml(DATE_ID, 'spec.yaml', HAPPY_SPEC_TEMPLATE(ID))
  writeYaml(DATE_ID, 'plan.yaml', HAPPY_PLAN_TEMPLATE(ID))
  const tasksYaml = HAPPY_TASKS_TEMPLATE(ID).replace('verify: c1', 'verify: missing')
  writeYaml(DATE_ID, 'tasks.yaml', tasksYaml)
  const r = validate(DATE_ID)
  assert.equal(r.ok, false)
  assert.match(r.errors.join('\n'), /references unknown spec\.checks\.id: "missing"/)
})

test('validate: spec id mismatch dateId → fail', () => {
  const yaml = HAPPY_SPEC_TEMPLATE(ID).replace('id: add-auth', 'id: wrong-id')
  writeYaml(DATE_ID, 'spec.yaml', yaml)
  const r = validate(DATE_ID)
  assert.equal(r.ok, false)
  assert.match(r.errors.join('\n'), /\[spec\] id "wrong-id" does not match parsed id/)
})

test('validate: cross-file id mismatch (plan.id ≠ spec.id) → fail', () => {
  writeYaml(DATE_ID, 'spec.yaml', HAPPY_SPEC_TEMPLATE(ID))
  const planYaml = HAPPY_PLAN_TEMPLATE(ID).replace('id: add-auth', 'id: other-id')
  writeYaml(DATE_ID, 'plan.yaml', planYaml)
  const r = validate(DATE_ID)
  assert.equal(r.ok, false)
  assert.match(r.errors.join('\n'), /\[plan\] id "other-id" does not match parsed id/)
})

test('validate: cross-file id mismatch (tasks.id ≠ spec.id) → fail', () => {
  writeYaml(DATE_ID, 'spec.yaml', HAPPY_SPEC_TEMPLATE(ID))
  writeYaml(DATE_ID, 'plan.yaml', HAPPY_PLAN_TEMPLATE(ID))
  const tasksYaml = HAPPY_TASKS_TEMPLATE(ID).replace('id: add-auth', 'id: other-id')
  writeYaml(DATE_ID, 'tasks.yaml', tasksYaml)
  const r = validate(DATE_ID)
  assert.equal(r.ok, false)
  assert.match(r.errors.join('\n'), /\[tasks\] id "other-id" does not match parsed id/)
})

test('validate: orphan task directory (tasks/t99/ but no t99 in tasks.yaml) → fail', () => {
  seedHealthyChange(DATE_ID, ID)
  writeTaskDebug(DATE_ID, 't99', 'orphan log')
  const r = validate(DATE_ID)
  assert.equal(r.ok, false)
  assert.match(r.errors.join('\n'), /orphan task directory: tasks\/t99\//)
})

test('validate: task directory matching tasks.yaml entry → ok', () => {
  seedHealthyChange(DATE_ID, ID)
  writeTaskDebug(DATE_ID, 't1', 'real log')
  const r = validate(DATE_ID)
  assert.equal(r.ok, true, `errors: ${r.errors.join(' / ')}`)
})

test('validate: check_results references unknown spec.checks.id → fail', () => {
  seedHealthyChange(DATE_ID, ID)
  const checkYaml = `version: 1
id: ${ID}
check_results:
  - id: nonexistent
    status: pass
verdict: done
`
  writeYaml(DATE_ID, 'check.yaml', checkYaml)
  const r = validate(DATE_ID)
  assert.equal(r.ok, false)
  assert.match(r.errors.join('\n'), /\[check\] check_results\.id "nonexistent" not in spec\.checks/)
})

// ─── validate(dateId) is independent of notebook state ──────

test('validate(dateId): broken notebook does NOT taint dateId verdict', () => {
  writeYaml(DATE_ID, 'spec.yaml', HAPPY_SPEC_TEMPLATE(ID))
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
