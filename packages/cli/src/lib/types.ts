export type TaskStatus = 'pending' | 'running' | 'passed' | 'failed'
export type CheckStatus = 'pending' | 'pass' | 'fail'
export type KscStatus = 'pass' | 'fail' | 'skipped'

export type Verdict = 'done' | 're-plan' | 'ksc-reject' | 'awaiting-llm'

export type HowCmd = { cmd: string[] }
export type HowLlm = { llm: string }
export type HowManual = { manual: string }
export type How = HowCmd | HowLlm | HowManual

export interface SpecCheck {
  id: string
  what: string
  how: How
}

export interface SpecAsk {
  q: string
  a: string
  level?: 'blocker' | 'defer'
}

export interface SpecShape {
  version: number
  id: string
  goal: string
  asks: SpecAsk[]
  checks: SpecCheck[]
}

export interface PlanShape {
  version: number
  id: string
  files: string[]
  approach: string
  tradeoffs?: string
}

export interface TaskItem {
  id: string
  do: string
  verify: string
  status: TaskStatus
  result?: string
  started_at?: string
  finished_at?: string
}

export interface TasksShape {
  version: number
  id: string
  tasks: TaskItem[]
}

export interface CheckResult {
  id: string
  status: CheckStatus
  evidence?: string
}

export interface KscCheck {
  k?: string
  s?: string
  c?: string
  status?: KscStatus
  evidence?: string
}

export interface CheckShape {
  version: number
  id: string
  check_results: CheckResult[]
  verdict: Verdict
  signed_off?: boolean
  ksc_check?: KscCheck
}

export type EnforcementLevel = 'strict' | 'warn' | 'off'

export type HookName = 'yaml-write' | 'session-start' | 'prompt-submit'

export interface ConfigShape {
  version: 1
  enforcement: EnforcementLevel
  hooks?: Partial<Record<HookName, EnforcementLevel | null>>
}

export type NotebookLibrary = 'knowledge' | 'skill' | 'check'

export type NotebookAxis = 'K' | 'S' | 'C'

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
