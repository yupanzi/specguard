import * as fs from 'fs'
import {
  changesRoot,
  loadPlan,
  loadPipelineOptional,
  loadCheckOptional,
  activeVersion,
  DATEID_PATTERN,
} from './yaml-io'
import type { PipelineShape, CheckShape, PlanShape } from './types'

export type PipelineStatus =
  | { state: 'absent' }
  | { state: 'in-progress'; attempt: number; failedTasks: string[] }
  | { state: 'all-pass'; attempt: number }
  | { state: 'has-failures'; attempt: number; failedTasks: string[] }

export type CheckStatus =
  | { state: 'absent' }
  | { state: 'verdict-only'; verdict: string; n: number }
  | { state: 'approved'; n: number }
  | { state: 'rejected'; n: number; verdict: string }
  | { state: 'awaiting-approval'; n: number; verdict: string }

export interface ChangeStatus {
  dateId: string
  version: number
  plan: 'present' | 'missing'
  pipeline: PipelineStatus
  check: CheckStatus
  nextHint: string
}

export interface StatusSummary {
  changes: ChangeStatus[]
}

function listChangeDirs(): string[] {
  if (!fs.existsSync(changesRoot())) return []
  return fs
    .readdirSync(changesRoot(), { withFileTypes: true })
    .filter((e) => e.isDirectory() && DATEID_PATTERN.test(e.name))
    .map((e) => e.name)
    .sort()
}

function derivePipelineStatus(p: PipelineShape | null): PipelineStatus {
  if (!p || p.attempts.length === 0) return { state: 'absent' }
  const last = p.attempts[p.attempts.length - 1]
  const inFlight = last.task_results.filter(
    (t) => t.status === 'pending' || t.status === 'in_progress'
  )
  const failed = last.task_results
    .filter((t) => t.status === 'fail')
    .map((t) => t.id)
  if (inFlight.length > 0)
    return { state: 'in-progress', attempt: last.n, failedTasks: failed }
  if (failed.length === 0) return { state: 'all-pass', attempt: last.n }
  return { state: 'has-failures', attempt: last.n, failedTasks: failed }
}

function deriveCheckStatus(c: CheckShape | null): CheckStatus {
  if (!c || c.attempts.length === 0) return { state: 'absent' }
  const last = c.attempts[c.attempts.length - 1]
  if (last.approved === true) return { state: 'approved', n: last.n }
  if (last.verdict === 'approval-rejected' || last.verdict === 'ksc-rejected')
    return { state: 'rejected', n: last.n, verdict: last.verdict }
  if (last.verdict === 'done')
    return { state: 'awaiting-approval', n: last.n, verdict: last.verdict }
  return { state: 'verdict-only', verdict: last.verdict, n: last.n }
}

function nextHint(p: PipelineStatus, c: CheckStatus, hasPlan: boolean): string {
  if (!hasPlan) return 'plan.yaml missing — re-run /specguard:sg-ask-plan'
  if (p.state === 'absent') return 'pipeline not started — /specguard:sg-run-pipeline'
  if (p.state === 'in-progress')
    return `pipeline in progress (attempt ${p.attempt}) — resume with /specguard:sg-run-pipeline`
  if (p.state === 'has-failures') {
    if (p.attempt >= 3) return 'pipeline still failing after attempt 3 — open v2 (re-plan)'
    return `pipeline attempt ${p.attempt} failed — /specguard:sg-run-pipeline to retry attempt ${p.attempt + 1}`
  }
  if (c.state === 'absent') return 'pipeline passed — /specguard:sg-sign-check'
  if (c.state === 'approved') return 'approved — run /specguard:sg-sync-notebook (manual trigger)'
  if (c.state === 'rejected') return `${c.verdict} — open v2 plan`
  if (c.state === 'awaiting-approval')
    return 'check verdict=done — awaiting approve (finish /specguard:sg-sign-check)'
  return 'check awaiting-llm — resume /specguard:sg-sign-check'
}

export function summarize(): StatusSummary {
  const changes: ChangeStatus[] = []
  for (const dateId of listChangeDirs()) {
    let version: number
    try {
      version = activeVersion(dateId)
    } catch {
      continue
    }
    let plan: PlanShape | null = null
    try {
      plan = loadPlan(dateId, version) as PlanShape
    } catch {
      // plan missing
    }
    const pipeline = loadPipelineOptional(dateId, version) as PipelineShape | null
    const check = loadCheckOptional(dateId, version) as CheckShape | null
    const pStatus = derivePipelineStatus(pipeline)
    const cStatus = deriveCheckStatus(check)
    changes.push({
      dateId,
      version,
      plan: plan ? 'present' : 'missing',
      pipeline: pStatus,
      check: cStatus,
      nextHint: nextHint(pStatus, cStatus, !!plan),
    })
  }
  return { changes }
}

export function isAnyChangeBusy(): boolean {
  for (const dateId of listChangeDirs()) {
    let version: number
    try {
      version = activeVersion(dateId)
    } catch {
      continue
    }
    const pipeline = loadPipelineOptional(dateId, version) as PipelineShape | null
    const pStatus = derivePipelineStatus(pipeline)
    if (pStatus.state === 'in-progress' || pStatus.state === 'has-failures') {
      return true
    }
    const check = loadCheckOptional(dateId, version) as CheckShape | null
    const cStatus = deriveCheckStatus(check)
    if (cStatus.state === 'awaiting-approval') return true
  }
  return false
}

function formatPipelineStatus(p: PipelineStatus): string {
  switch (p.state) {
    case 'absent':
      return 'absent'
    case 'in-progress':
      return `in-progress (attempt ${p.attempt})`
    case 'all-pass':
      return `all-pass (attempt ${p.attempt})`
    case 'has-failures':
      return `failures: [${p.failedTasks.join(', ')}] (attempt ${p.attempt})`
  }
}

function formatCheckStatus(c: CheckStatus): string {
  switch (c.state) {
    case 'absent':
      return 'absent'
    case 'verdict-only':
      return `verdict=${c.verdict} (attempt ${c.n})`
    case 'approved':
      return `approved (attempt ${c.n})`
    case 'rejected':
      return `rejected: ${c.verdict} (attempt ${c.n})`
    case 'awaiting-approval':
      return `verdict=${c.verdict}, awaiting approve (attempt ${c.n})`
  }
}

export function formatSummary(s: StatusSummary): string {
  if (s.changes.length === 0) {
    return 'specguard: no changes in progress'
  }
  const lines: string[] = ['specguard state machine in progress:']
  for (const c of s.changes) {
    lines.push(`  ${c.dateId}/v${c.version}`)
    lines.push(`    plan:     ${c.plan}`)
    lines.push(`    pipeline: ${formatPipelineStatus(c.pipeline)}`)
    lines.push(`    check:    ${formatCheckStatus(c.check)}`)
    lines.push(`    → ${c.nextHint}`)
  }
  return lines.join('\n')
}
