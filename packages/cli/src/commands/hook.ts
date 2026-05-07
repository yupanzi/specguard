import { validate } from './validate'
import { readConfigOptional, effectiveEnforcement } from '../lib/config'
import { summarize, formatSummary, isAnyChangeBusy } from '../lib/status'
import { parseChangeYamlPath } from '../lib/yaml-io'
import type { EnforcementLevel } from '../lib/types'

const INTENT_KEYWORDS = [
  'add',
  'create',
  'implement',
  'build',
  'refactor',
  'fix',
  'change',
  'modify',
  'introduce',
  'support',
  'feature',
  'integrate',
  'rewrite',
]

interface YamlHookInput {
  tool_name?: string
  tool_input?: { file_path?: string }
}

interface PromptHookInput {
  prompt?: string
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return ''
  let data = ''
  for await (const chunk of process.stdin) {
    data += chunk
  }
  return data
}

function parseJsonOptional<T>(raw: string): T | null {
  if (!raw.trim()) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

function decideExit(level: EnforcementLevel): number {
  return level === 'strict' ? 2 : 0
}

export async function hookOnYamlWrite(): Promise<number> {
  const cfg = readConfigOptional()
  if (!cfg) return 0

  const level = effectiveEnforcement(cfg, 'yaml-write')
  if (level === 'off') return 0

  const input = parseJsonOptional<YamlHookInput>(await readStdin())
  const filePath = input?.tool_input?.file_path
  if (!filePath) return 0

  const parsed = parseChangeYamlPath(filePath)
  if (!parsed) return 0

  const result = validate(parsed.dateId)
  if (result.ok) return 0

  console.error(`specguard validate ${parsed.dateId} failed:`)
  for (const e of result.errors) console.error(`  - ${e}`)
  return decideExit(level)
}

export async function hookOnSessionStart(): Promise<number> {
  const cfg = readConfigOptional()
  if (!cfg) return 0

  const level = effectiveEnforcement(cfg, 'session-start')
  if (level === 'off') return 0

  const summary = summarize()
  console.log(formatSummary(summary))
  return 0
}

export async function hookOnPromptSubmit(): Promise<number> {
  const cfg = readConfigOptional()
  if (!cfg) return 0

  const level = effectiveEnforcement(cfg, 'prompt-submit')
  if (level === 'off') return 0

  const input = parseJsonOptional<PromptHookInput>(await readStdin())
  const prompt = input?.prompt ?? ''
  if (!INTENT_KEYWORDS.some((k) => prompt.includes(k))) return 0

  if (isAnyChangeBusy()) return 0

  console.error(
    'specguard: detected new-feature intent but no state machine in progress; start with /specguard:sg-spec-ask to draft spec.yaml'
  )
  return decideExit(level)
}
