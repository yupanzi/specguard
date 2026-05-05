import {
  readConfig,
  writeConfig,
  effectiveEnforcement,
  isEnforcementLevel,
  isHookName,
  HOOK_NAMES,
  ENFORCEMENT_LEVELS,
} from '../lib/config'
import type { HookName } from '../lib/types'

export interface ConfigGetResult {
  ok: boolean
  errors: string[]
  value?: unknown
}

export interface ConfigSetResult {
  ok: boolean
  errors: string[]
  value?: unknown
}

const HOOK_PATH_PATTERN = /^hooks\.([a-z-]+)(?:\.enforcement)?$/

function parseHookPath(query: string): HookName | null {
  const m = HOOK_PATH_PATTERN.exec(query)
  if (!m) return null
  return isHookName(m[1]) ? m[1] : null
}

export function configGet(query?: string): ConfigGetResult {
  const cfg = readConfig()

  if (query === undefined || query === 'all') {
    return { ok: true, errors: [], value: cfg }
  }
  if (query === 'enforcement') {
    return { ok: true, errors: [], value: cfg.enforcement }
  }

  const hook = parseHookPath(query)
  if (hook) {
    const override = cfg.hooks?.[hook]
    return {
      ok: true,
      errors: [],
      value: {
        configured: override ?? null,
        effective: effectiveEnforcement(cfg, hook),
      },
    }
  }

  return {
    ok: false,
    errors: [
      `unknown query "${query}"; valid: enforcement | hooks.<${HOOK_NAMES.join('|')}> | all`,
    ],
  }
}

export function configSet(query: string, value: string): ConfigSetResult {
  const cfg = readConfig()

  if (query === 'enforcement') {
    if (!isEnforcementLevel(value)) {
      return {
        ok: false,
        errors: [
          `invalid value "${value}"; must be one of: ${ENFORCEMENT_LEVELS.join(', ')}`,
        ],
      }
    }
    cfg.enforcement = value
    writeConfig(cfg)
    return { ok: true, errors: [], value: cfg.enforcement }
  }

  const hook = parseHookPath(query)
  if (hook) {
    cfg.hooks = cfg.hooks ?? {}
    if (value === 'null' || value === '~' || value === '') {
      cfg.hooks[hook] = null
      writeConfig(cfg)
      return { ok: true, errors: [], value: null }
    }
    if (!isEnforcementLevel(value)) {
      return {
        ok: false,
        errors: [
          `invalid value "${value}"; must be one of: ${ENFORCEMENT_LEVELS.join(', ')}, null`,
        ],
      }
    }
    cfg.hooks[hook] = value
    writeConfig(cfg)
    return { ok: true, errors: [], value: cfg.hooks[hook] }
  }

  return {
    ok: false,
    errors: [
      `unknown setting "${query}"; valid: enforcement | hooks.<${HOOK_NAMES.join('|')}>`,
    ],
  }
}
