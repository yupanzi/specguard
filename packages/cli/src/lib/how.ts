import type { How } from './types'

export type ParsedHow =
  | { kind: 'cmd'; cmd: string; args: string[] }
  | { kind: 'llm' }
  | { kind: 'manual' }

export function parseHow(how: How): ParsedHow {
  if ('cmd' in how) {
    const [cmd, ...args] = how.cmd
    return { kind: 'cmd', cmd, args }
  }
  if ('llm' in how) return { kind: 'llm' }
  if ('manual' in how) return { kind: 'manual' }
  throw new Error(`how must contain one of: cmd | llm | manual`)
}
