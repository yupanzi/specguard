'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { parseHow } = require('../../dist/lib/how')

test('parseHow: cmd array → kind:cmd, first element is program', () => {
  const r = parseHow({ cmd: ['node', '--version'] })
  assert.deepEqual(r, { kind: 'cmd', cmd: 'node', args: ['--version'] })
})

test('parseHow: cmd single-element array → empty args', () => {
  const r = parseHow({ cmd: ['ls'] })
  assert.deepEqual(r, { kind: 'cmd', cmd: 'ls', args: [] })
})

test('parseHow: cmd with multi args → preserves order', () => {
  const r = parseHow({ cmd: ['npx', 'vitest', 'run', 'tests/auth.test.ts'] })
  assert.deepEqual(r, {
    kind: 'cmd',
    cmd: 'npx',
    args: ['vitest', 'run', 'tests/auth.test.ts'],
  })
})

test('parseHow: cmd does NOT split tokens (array elements stay literal)', () => {
  // array elements stay literal — "a b" is a single token, no whitespace split.
  const r = parseHow({ cmd: ['echo', 'hello world'] })
  assert.deepEqual(r.args, ['hello world'])
})

test('parseHow: llm → kind:llm', () => {
  const r = parseHow({ llm: 'is the diff coherent?' })
  assert.deepEqual(r, { kind: 'llm' })
})

test('parseHow: manual → kind:manual', () => {
  const r = parseHow({ manual: 'review src/auth/ by hand' })
  assert.deepEqual(r, { kind: 'manual' })
})

test('parseHow: malformed object (no known key) throws', () => {
  assert.throws(
    () => parseHow({ foo: 'bar' }),
    /one of: cmd \| llm \| manual/
  )
})
