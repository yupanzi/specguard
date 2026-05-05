export type TaskStatus = 'pending' | 'in_progress' | 'pass' | 'fail'
export type CheckStatus = 'pending' | 'pass' | 'fail'
export type KscStatus = 'pass' | 'fail' | 'skipped'

export type Verdict =
  | 'done'
  | 're-run'
  | 're-plan'
  | 'awaiting-llm'
  | 'ksc-rejected'
  | 'approval-rejected'

export type HowCmd = { cmd: string[] }
export type HowLlm = { llm: string }
export type HowManual = { manual: string }
export type How = HowCmd | HowLlm | HowManual

export interface PlanCheck {
  id: string
  what: string
  how: How
}

export interface PlanTask {
  id: string
  do: string
  verify: string
}

export interface PlanAsk {
  q: string
  a: string
  level?: 'blocker' | 'defer'
}

export interface PlanShape {
  version: number
  id: string
  goal: string
  asks: PlanAsk[]
  checks: PlanCheck[]
  tasks: PlanTask[]
}

export interface TaskResult {
  id: string
  status: TaskStatus
  started?: string
  ended?: string
  log?: string
}

export interface PipelineAttempt {
  n: number
  at: string
  task_results: TaskResult[]
}

export interface PipelineShape {
  id: string
  attempts: PipelineAttempt[]
}

export interface CheckResult {
  id: string
  status: CheckStatus
  evidence?: string
}

export interface CheckAttempt {
  n: number
  check_results: CheckResult[]
  verdict: Verdict
  approved?: boolean
  ksc_check?: { status: KscStatus; evidence?: string }
}

export interface CheckShape {
  id: string
  attempts: CheckAttempt[]
}

export type EnforcementLevel = 'strict' | 'warn' | 'off'

export type HookName = 'yaml-write' | 'session-start' | 'prompt-submit'

export interface ConfigShape {
  version: 1
  enforcement: EnforcementLevel
  hooks?: Partial<Record<HookName, EnforcementLevel | null>>
}

export type NotebookLibrary = 'knowledge' | 'skill' | 'check'

export type NotebookScope =
  | 'notebook'
  | 'notebook.knowledge'
  | 'notebook.skill'
  | 'notebook.check'

export interface IndexReference {
  ref_id: string
  file: string
  when: string
}

export interface IndexAssetShape {
  topic: string
  kind: 'index'
  scope: NotebookScope
  version: number
  source_change_id: string
  source_date: string
  references: IndexReference[]
  supersedes?: string[]
}

export interface TopicAssetShape {
  topic: string
  kind: 'topic'
  scope: Exclude<NotebookScope, 'notebook'>
  ref_id: string
  library: NotebookLibrary
  version: number
  source_change_id: string
  source_date: string
  supersedes?: string[]
}

export type NotebookAssetShape = IndexAssetShape | TopicAssetShape
