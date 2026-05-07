import { spawnSync } from 'child_process'
import {
  loadSpec,
  loadCheckOptional,
  saveCheck,
  parseDateId,
} from '../lib/yaml-io'
import { parseHow, type ParsedHow } from '../lib/how'
import type {
  SpecShape,
  CheckResult,
  CheckShape,
  Verdict,
} from '../lib/types'

export interface VerifyResult {
  ok: boolean
  errors: string[]
  verdict?: Verdict
}

const TAIL_LINES = 5

function tailLines(s: string, n: number): string {
  return (s ?? '').trim().split('\n').slice(-n).join(' | ')
}

function runCmdCheck(
  parsed: Extract<ParsedHow, { kind: 'cmd' }>
): { status: 'pass' | 'fail'; evidence: string } {
  const r = spawnSync(parsed.cmd, parsed.args, { encoding: 'utf-8' })
  const status: 'pass' | 'fail' = r.status === 0 ? 'pass' : 'fail'
  const stdoutTail = tailLines(r.stdout ?? '', TAIL_LINES)
  const stderrTail = tailLines(r.stderr ?? '', TAIL_LINES)
  const evidence =
    `exit=${r.status ?? 'spawn-error'} | cmd=${parsed.cmd} ${parsed.args.join(' ')}` +
    (stdoutTail ? ` | stdout-tail=${stdoutTail}` : '') +
    (stderrTail ? ` | stderr-tail=${stderrTail}` : '')
  return { status, evidence }
}

function computeVerdict(results: CheckResult[]): Verdict {
  if (results.some((r) => r.status === 'pending')) return 'awaiting-llm'
  if (results.every((r) => r.status === 'pass')) return 'done'
  return 're-plan'
}

export function verify(
  dateId: string,
  opts: { verdictOnly: boolean } = { verdictOnly: false }
): VerifyResult {
  parseDateId(dateId)
  const spec = loadSpec(dateId) as SpecShape

  const existing = loadCheckOptional(dateId) as CheckShape | null
  const checkState: CheckShape = existing ?? {
    version: 1,
    id: spec.id,
    check_results: [],
    verdict: 'awaiting-llm',
  }

  if (opts.verdictOnly) {
    if (checkState.check_results.length === 0) {
      return { ok: false, errors: ['no check_results to recompute verdict'] }
    }
    checkState.verdict = computeVerdict(checkState.check_results)
    saveCheck(dateId, checkState)
    return { ok: true, errors: [], verdict: checkState.verdict }
  }

  const results: CheckResult[] = spec.checks.map((c) => {
    const parsed = parseHow(c.how)
    if (parsed.kind !== 'cmd') {
      return { id: c.id, status: 'pending' }
    }
    const r = runCmdCheck(parsed)
    return { id: c.id, status: r.status, evidence: r.evidence }
  })

  checkState.check_results = results
  checkState.verdict = computeVerdict(results)

  saveCheck(dateId, checkState)
  return { ok: true, errors: [], verdict: checkState.verdict }
}
