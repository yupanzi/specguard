import * as fs from 'fs'
import * as path from 'path'
import * as readline from 'readline/promises'
import {
  defaultConfig,
  writeConfig,
  isEnforcementLevel,
  ENFORCEMENT_LEVELS,
} from '../lib/config'
import {
  configPath,
  changesRoot,
  isENOENT,
  NOTEBOOK_LIBRARIES,
  notebookRootIndexPath,
  notebookLibraryIndexPath,
  frontmatterBlock,
  todayDateId,
} from '../lib/yaml-io'
import type { EnforcementLevel, NotebookLibrary } from '../lib/types'

export type GitignoreStatus = 'appended' | 'noop' | 'skipped'

export interface InitOptions {
  enforcement?: string
  force?: boolean
}

export interface InitResult {
  ok: boolean
  errors: string[]
  level?: EnforcementLevel
  cfgPath?: string
  gitignore?: GitignoreStatus
}

const GITIGNORE_MARKER = '.specguard/changes/'
const GITIGNORE_BLOCK =
  '\n# specguard ephemeral changes - not committed\n.specguard/changes/\n'

export function maintainGitignore(cwd: string): GitignoreStatus {
  const giPath = path.resolve(cwd, '.gitignore')
  let raw: string
  try {
    raw = fs.readFileSync(giPath, 'utf8')
  } catch (e) {
    if (isENOENT(e)) return 'skipped'
    throw e
  }

  const hasMarker = raw
    .split(/\r?\n/)
    .some((line) => line.trim() === GITIGNORE_MARKER)
  if (hasMarker) return 'noop'

  const needsLeadingNewline = raw.length > 0 && !raw.endsWith('\n')
  const appended = (needsLeadingNewline ? '\n' : '') + GITIGNORE_BLOCK
  fs.writeFileSync(giPath, raw + appended)
  return 'appended'
}

function rootIndexMarkdown(today: string): string {
  const fm = frontmatterBlock({
    topic: 'notebook-root',
    kind: 'index',
    scope: 'notebook',
    version: 1,
    source_change_id: 'notebook-index',
    source_date: today,
    references: [],
  })
  const body = `# Notebook

Project knowledge assets organized along the KSC three-axis split. Each library
owns a distinct slice; topic files are pulled in only when a relevant trigger,
invariant, or abstraction matches the current task.

- **Knowledge** — project map: core abstractions, invariants, concept relations
- **Skill** — decision templates: how to reason about each class of problem
- **Check** — correctness matrix: how to tell right from wrong (cmd / llm / manual)

## Library entries

@knowledge/INDEX.md
@skill/INDEX.md
@check/INDEX.md
`
  return fm + '\n' + body
}

const LIBRARY_TEMPLATES: Record<NotebookLibrary, { title: string; sections: string[] }> = {
  knowledge: {
    title: 'Knowledge',
    sections: ['## Invariants', '', '## Abstractions', '', '## Topics', ''],
  },
  skill: {
    title: 'Skill',
    sections: ['## Decision Triggers', '', '## Topics', ''],
  },
  check: {
    title: 'Check',
    sections: [
      '## Cmd Matrix',
      '',
      '## Llm Checks',
      '',
      '## Manual Checklists',
      '',
      '## Topics',
      '',
    ],
  },
}

function libraryIndexMarkdown(library: NotebookLibrary, today: string): string {
  const fm = frontmatterBlock({
    topic: `${library}-index`,
    kind: 'index',
    scope: `notebook.${library}`,
    version: 1,
    source_change_id: 'notebook-index',
    source_date: today,
    references: [],
  })
  const tpl = LIBRARY_TEMPLATES[library]
  const body = `# ${tpl.title}\n\n${tpl.sections.join('\n')}`
  return fm + '\n' + body
}

function writeIfAbsent(p: string, content: string): void {
  if (fs.existsSync(p)) return
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, content)
}

export async function init(opts: InitOptions = {}): Promise<InitResult> {
  const cfgPath = configPath()

  if (fs.existsSync(cfgPath) && !opts.force) {
    return {
      ok: false,
      errors: [`${cfgPath} already exists; pass --force to overwrite`],
    }
  }

  let level: EnforcementLevel
  if (opts.enforcement !== undefined) {
    if (!isEnforcementLevel(opts.enforcement)) {
      return {
        ok: false,
        errors: [
          `invalid --enforcement "${opts.enforcement}"; must be one of: ${ENFORCEMENT_LEVELS.join(', ')}`,
        ],
      }
    }
    level = opts.enforcement
  } else {
    level = await promptLevel()
  }

  fs.mkdirSync(changesRoot(), { recursive: true })

  const today = todayDateId()
  writeIfAbsent(notebookRootIndexPath(), rootIndexMarkdown(today))
  for (const sub of NOTEBOOK_LIBRARIES) {
    writeIfAbsent(notebookLibraryIndexPath(sub), libraryIndexMarkdown(sub, today))
  }

  writeConfig(defaultConfig(level))

  const gitignore = maintainGitignore(process.cwd())

  return { ok: true, errors: [], level, cfgPath, gitignore }
}

async function promptLevel(): Promise<EnforcementLevel> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })
  try {
    for (;;) {
      const raw = await rl.question(
        `Enforcement level [${ENFORCEMENT_LEVELS.join('/')}, default: warn]: `
      )
      const ans = raw.trim() === '' ? 'warn' : raw.trim()
      if (isEnforcementLevel(ans)) return ans
      console.error(
        `  invalid: "${ans}"; must be one of: ${ENFORCEMENT_LEVELS.join(', ')}`
      )
    }
  } finally {
    rl.close()
  }
}
