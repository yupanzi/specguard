import { spawnSync } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import {
  loadPlan,
  loadPipelineOptional,
  loadCheckOptional,
  saveCheck,
  logsDir,
  parseDateId,
  activeVersion,
} from '../lib/yaml-io'
import { parseHow, type ParsedHow } from '../lib/how'
import type {
  PlanShape,
  PipelineShape,
  CheckResult,
  CheckAttempt,
  CheckShape,
  Verdict,
} from '../lib/types'

export interface VerifyResult {
  ok: boolean
  errors: string[]
  verdict?: Verdict
}

function lastAttemptN(pipeline: PipelineShape | null): number {
  if (!pipeline?.attempts.length) return 1
  return pipeline.attempts[pipeline.attempts.length - 1].n
}

function lastAttemptFailureCount(pipeline: PipelineShape | null): number {
  if (!pipeline?.attempts.length) return 0
  const last = pipeline.attempts[pipeline.attempts.length - 1]
  return last.task_results.filter((t) => t.status === 'fail').length
}

function runCmdCheck(
  parsed: Extract<ParsedHow, { kind: 'cmd' }>,
  logFile: string
): 'pass' | 'fail' {
  const r = spawnSync(parsed.cmd, parsed.args, { encoding: 'utf-8' })
  const log =
    `EXIT: ${r.status ?? 'spawn-error'}\n` +
    `CMD: ${parsed.cmd} ${parsed.args.join(' ')}\n` +
    `--- STDOUT ---\n${r.stdout ?? ''}\n` +
    `--- STDERR ---\n${r.stderr ?? ''}\n`
  fs.writeFileSync(logFile, log)
  return r.status === 0 ? 'pass' : 'fail'
}

function computeVerdict(
  results: CheckResult[],
  taskFailureCount: number
): Verdict {
  if (results.some((r) => r.status === 'pending')) return 'awaiting-llm'
  if (results.every((r) => r.status === 'pass')) return 'done'
  return taskFailureCount >= 2 ? 're-plan' : 're-run'
}

export function verify(
  dateId: string,
  opts: { verdictOnly: boolean } = { verdictOnly: false }
): VerifyResult {
  parseDateId(dateId)
  const version = activeVersion(dateId)
  const plan = loadPlan(dateId, version) as PlanShape
  const pipeline = loadPipelineOptional(dateId, version) as PipelineShape | null
  const n = lastAttemptN(pipeline)
  const taskFailureCount = lastAttemptFailureCount(pipeline)

  const checkState: CheckShape =
    (loadCheckOptional(dateId, version) as CheckShape | null) ?? {
      id: plan.id,
      attempts: [],
    }

  if (opts.verdictOnly) {
    if (checkState.attempts.length === 0) {
      return { ok: false, errors: ['no attempt to recompute verdict'] }
    }
    const last = checkState.attempts[checkState.attempts.length - 1]
    last.verdict = computeVerdict(last.check_results, taskFailureCount)
    saveCheck(dateId, version, checkState)
    return { ok: true, errors: [], verdict: last.verdict }
  }

  const dir = logsDir(dateId, version, n)
  fs.mkdirSync(dir, { recursive: true })

  const results: CheckResult[] = plan.checks.map((c) => {
    const parsed = parseHow(c.how)
    if (parsed.kind !== 'cmd') {
      return { id: c.id, status: 'pending' }
    }
    const logFile = path.join(dir, `${c.id}.log`)
    const status = runCmdCheck(parsed, logFile)
    return { id: c.id, status, evidence: logFile }
  })

  const verdict = computeVerdict(results, taskFailureCount)

  const existing = checkState.attempts.findIndex((a) => a.n === n)
  const attempt: CheckAttempt = { n, check_results: results, verdict }
  if (existing >= 0) {
    checkState.attempts[existing] = attempt
  } else {
    checkState.attempts.push(attempt)
  }

  saveCheck(dateId, version, checkState)
  return { ok: true, errors: [], verdict }
}
