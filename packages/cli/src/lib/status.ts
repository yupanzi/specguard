import * as fs from 'fs'
import {
  changesRoot,
  loadSpecOptional,
  loadPlanOptional,
  loadTasksOptional,
  loadCheckOptional,
  DATEID_PATTERN,
} from './yaml-io'
import type { TasksShape, CheckShape, SpecShape, PlanShape } from './types'

export type TasksStatus =
  | { state: 'absent' }
  | { state: 'in-progress'; failedTasks: string[] }
  | { state: 'all-pass' }
  | { state: 'has-failures'; failedTasks: string[] }

export type CheckPhaseStatus =
  | { state: 'absent' }
  | { state: 'awaiting-llm'; verdict: string }
  | { state: 'signed-off'; verdict: string }
  | { state: 'rejected'; verdict: string }
  | { state: 'awaiting-approval'; verdict: string }

export interface ChangeStatus {
  dateId: string
  spec: 'present' | 'missing'
  plan: 'present' | 'missing'
  tasks: TasksStatus
  check: CheckPhaseStatus
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

function deriveTasksStatus(t: TasksShape | null): TasksStatus {
  if (!t || !Array.isArray(t.tasks) || t.tasks.length === 0)
    return { state: 'absent' }
  const inFlight = t.tasks.filter(
    (x) => x.status === 'pending' || x.status === 'running'
  )
  const failed = t.tasks
    .filter((x) => x.status === 'failed')
    .map((x) => x.id)
  if (inFlight.length > 0)
    return { state: 'in-progress', failedTasks: failed }
  if (failed.length === 0) return { state: 'all-pass' }
  return { state: 'has-failures', failedTasks: failed }
}

function deriveCheckStatus(c: CheckShape | null): CheckPhaseStatus {
  if (!c) return { state: 'absent' }
  if (c.signed_off === true)
    return { state: 'signed-off', verdict: c.verdict }
  switch (c.verdict) {
    case 're-plan':
    case 'ksc-reject':
      return { state: 'rejected', verdict: c.verdict }
    case 'awaiting-llm':
      return { state: 'awaiting-llm', verdict: c.verdict }
    case 'done':
      return { state: 'awaiting-approval', verdict: c.verdict }
  }
}

function nextHint(
  hasSpec: boolean,
  hasPlan: boolean,
  t: TasksStatus,
  c: CheckPhaseStatus
): string {
  if (!hasSpec) return 'spec.yaml missing — re-run /specguard:sg-spec-ask'
  if (!hasPlan) return 'plan.yaml missing — /specguard:sg-plan-tasks'
  if (t.state === 'absent') return 'tasks not started — /specguard:sg-plan-tasks'
  if (t.state === 'in-progress')
    return 'tasks in progress — resume with /specguard:sg-plan-tasks'
  if (t.state === 'has-failures')
    return `tasks failed: [${t.failedTasks.join(', ')}] — open new dateId to re-spec/re-plan`
  if (c.state === 'absent') return 'tasks all-pass — /specguard:sg-check-guard'
  if (c.state === 'signed-off')
    return 'signed off — run /specguard:sg-sync-notebook (manual trigger)'
  if (c.state === 'rejected')
    return `${c.verdict} — open new dateId to re-spec/re-plan`
  if (c.state === 'awaiting-approval')
    return 'check verdict=done — awaiting approve (finish /specguard:sg-check-guard)'
  return `check awaiting-llm (${c.verdict}) — resume /specguard:sg-check-guard`
}

export function summarize(): StatusSummary {
  const changes: ChangeStatus[] = []
  for (const dateId of listChangeDirs()) {
    const spec = loadSpecOptional(dateId) as SpecShape | null
    const plan = loadPlanOptional(dateId) as PlanShape | null
    const tasks = loadTasksOptional(dateId) as TasksShape | null
    const check = loadCheckOptional(dateId) as CheckShape | null
    const tStatus = deriveTasksStatus(tasks)
    const cStatus = deriveCheckStatus(check)
    changes.push({
      dateId,
      spec: spec ? 'present' : 'missing',
      plan: plan ? 'present' : 'missing',
      tasks: tStatus,
      check: cStatus,
      nextHint: nextHint(!!spec, !!plan, tStatus, cStatus),
    })
  }
  return { changes }
}

export function isAnyChangeBusy(): boolean {
  for (const dateId of listChangeDirs()) {
    const tasks = loadTasksOptional(dateId) as TasksShape | null
    const tStatus = deriveTasksStatus(tasks)
    if (tStatus.state === 'in-progress' || tStatus.state === 'has-failures') {
      return true
    }
    const check = loadCheckOptional(dateId) as CheckShape | null
    const cStatus = deriveCheckStatus(check)
    if (
      cStatus.state === 'awaiting-approval' ||
      cStatus.state === 'awaiting-llm'
    )
      return true
  }
  return false
}

function formatTasksStatus(t: TasksStatus): string {
  switch (t.state) {
    case 'absent':
      return 'absent'
    case 'in-progress':
      return 'in-progress'
    case 'all-pass':
      return 'all-pass'
    case 'has-failures':
      return `failures: [${t.failedTasks.join(', ')}]`
  }
}

function formatCheckStatus(c: CheckPhaseStatus): string {
  switch (c.state) {
    case 'absent':
      return 'absent'
    case 'awaiting-llm':
      return `verdict=${c.verdict}, awaiting-llm`
    case 'signed-off':
      return `signed-off (verdict=${c.verdict})`
    case 'rejected':
      return `rejected: ${c.verdict}`
    case 'awaiting-approval':
      return `verdict=${c.verdict}, awaiting approve`
  }
}

export function formatSummary(s: StatusSummary): string {
  if (s.changes.length === 0) {
    return 'specguard: no changes in progress'
  }
  const lines: string[] = ['specguard state machine in progress:']
  for (const c of s.changes) {
    lines.push(`  ${c.dateId}`)
    lines.push(`    spec:  ${c.spec}`)
    lines.push(`    plan:  ${c.plan}`)
    lines.push(`    tasks: ${formatTasksStatus(c.tasks)}`)
    lines.push(`    check: ${formatCheckStatus(c.check)}`)
    lines.push(`    → ${c.nextHint}`)
  }
  return lines.join('\n')
}
