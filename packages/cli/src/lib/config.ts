import Ajv from 'ajv'
import { configPath, readYamlOptional, writeYaml } from './yaml-io'
import { humanizeAjv } from './errors'
import type { ConfigShape, EnforcementLevel, HookName } from './types'
import configSchema from '../schemas/config.schema.json'

const ajv = new Ajv({ allErrors: true })
const checkConfig = ajv.compile<ConfigShape>(configSchema)

export const HOOK_NAMES: readonly HookName[] = [
  'yaml-write',
  'session-start',
  'prompt-submit',
] as const

export const ENFORCEMENT_LEVELS: readonly EnforcementLevel[] = [
  'strict',
  'warn',
  'off',
] as const

export function isEnforcementLevel(v: unknown): v is EnforcementLevel {
  return typeof v === 'string' && (ENFORCEMENT_LEVELS as readonly string[]).includes(v)
}

export function isHookName(v: unknown): v is HookName {
  return typeof v === 'string' && (HOOK_NAMES as readonly string[]).includes(v)
}

function ajvErrorMessage(label: string): string {
  return `${label}:\n  - ` + humanizeAjv(checkConfig.errors ?? []).join('\n  - ')
}

export function readConfigOptional(): ConfigShape | null {
  const p = configPath()
  const raw = readYamlOptional(p)
  if (raw === null) return null
  if (!checkConfig(raw)) {
    throw new Error(ajvErrorMessage(`invalid ${p}`))
  }
  return raw as ConfigShape
}

export function readConfig(): ConfigShape {
  const c = readConfigOptional()
  if (!c) {
    throw new Error(`${configPath()} not found; run "specguard init" first`)
  }
  return c
}

export function writeConfig(cfg: ConfigShape): void {
  if (!checkConfig(cfg)) {
    throw new Error(ajvErrorMessage('invalid config'))
  }
  writeYaml(configPath(), cfg)
}

export function effectiveEnforcement(
  cfg: ConfigShape,
  hook: HookName
): EnforcementLevel {
  return cfg.hooks?.[hook] ?? cfg.enforcement
}

export function defaultConfig(level: EnforcementLevel): ConfigShape {
  return {
    version: 1,
    enforcement: level,
    hooks: {
      'yaml-write': null,
      'session-start': null,
      'prompt-submit': level === 'strict' ? 'warn' : null,
    },
  }
}
