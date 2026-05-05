import * as fs from 'fs'
import * as path from 'path'
import { Command } from 'commander'
import { validate, validateNotebook } from './commands/validate'
import { verify } from './commands/verify'
import { init } from './commands/init'
import { configGet, configSet } from './commands/config'
import {
  hookOnYamlWrite,
  hookOnSessionStart,
  hookOnPromptSubmit,
} from './commands/hook'

const pkgVersion = (
  JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')
  ) as { version: string }
).version

const program = new Command()
program.name('specguard').version(pkgVersion).description('specguard CLI')

program
  .command('validate [dateId]')
  .description('Validate plan/pipeline/check yaml of <dateId> (e.g. 20260504-add-auth); pass --notebook-only to skip dateId scope and only check notebook reference integrity')
  .option('--notebook-only', 'skip plan/pipeline/check yaml validation; only run notebook frontmatter + reference integrity checks (no dateId required)')
  .action((dateId: string | undefined, opts: { notebookOnly?: boolean }) => {
    if (opts.notebookOnly) {
      const errs = validateNotebook()
      if (errs.length === 0) {
        console.log('OK notebook')
        process.exit(0)
      }
      console.error('FAIL notebook')
      for (const e of errs) console.error(`  - ${e}`)
      process.exit(1)
    }
    if (!dateId) {
      console.error('error: dateId is required (or pass --notebook-only)')
      process.exit(1)
    }
    const result = validate(dateId)
    if (result.ok) {
      console.log(`OK ${dateId}`)
      process.exit(0)
    }
    console.error(`FAIL ${dateId}`)
    for (const e of result.errors) console.error(`  - ${e}`)
    process.exit(1)
  })

program
  .command('verify <dateId>')
  .description('Run program-type checks and compute verdict')
  .option('--verdict-only', 'skip spawning checks; only recompute verdict from current check.yaml')
  .action((dateId: string, opts: { verdictOnly?: boolean }) => {
    const result = verify(dateId, { verdictOnly: !!opts.verdictOnly })
    if (result.ok) {
      console.log(`OK ${dateId} verdict=${result.verdict}`)
      process.exit(0)
    }
    console.error(`FAIL ${dateId}`)
    for (const e of result.errors) console.error(`  - ${e}`)
    process.exit(1)
  })

program
  .command('init')
  .description('Initialize specguard in the current project')
  .option('--enforcement <level>', 'enforcement level: strict | warn | off (skips prompt)')
  .option('--force', 'overwrite existing .specguard/config.yaml')
  .action(async (opts: { enforcement?: string; force?: boolean }) => {
    const r = await init(opts)
    if (r.ok) {
      console.log(`OK specguard initialized (enforcement=${r.level})`)
      console.log(`  config: ${r.cfgPath}`)
      if (r.gitignore) {
        const detail =
          r.gitignore === 'skipped' ? 'skipped (no .gitignore)' : r.gitignore
        console.log(`  gitignore: ${detail}`)
      }
      console.log(`  notebook:  .specguard/notebook/INDEX.md (+ knowledge/skill/check INDEX skeletons)`)
      console.log()
      console.log('next:')
      console.log('  start new change:    /specguard:sg-ask-plan')
      console.log('  change enforcement:  specguard config set enforcement <level>')
      console.log('  per-hook override:   specguard config set hooks.<name> <level>')
      process.exit(0)
    }
    for (const e of r.errors) console.error(`error: ${e}`)
    process.exit(1)
  })

const configCmd = program
  .command('config')
  .description('Read or write specguard config')

configCmd
  .command('get [query]')
  .description('Read config; query examples: enforcement | hooks.yaml-write | all')
  .action((query?: string) => {
    const r = configGet(query)
    if (r.ok) {
      const out =
        typeof r.value === 'string' ? r.value : JSON.stringify(r.value, null, 2)
      console.log(out)
      process.exit(0)
    }
    for (const e of r.errors) console.error(`error: ${e}`)
    process.exit(1)
  })

configCmd
  .command('set <query> <value>')
  .description('Write config; e.g. "enforcement strict" or "hooks.yaml-write off" or "hooks.yaml-write null"')
  .action((query: string, value: string) => {
    const r = configSet(query, value)
    if (r.ok) {
      console.log(`OK ${query} = ${JSON.stringify(r.value)}`)
      process.exit(0)
    }
    for (const e of r.errors) console.error(`error: ${e}`)
    process.exit(1)
  })

const hookCmd = program
  .command('hook')
  .description('Hook handlers (invoked by Claude Code plugin)')

hookCmd
  .command('on-yaml-write')
  .description('PostToolUse handler — validate yaml writes under .specguard/changes/')
  .action(async () => {
    process.exit(await hookOnYamlWrite())
  })

hookCmd
  .command('on-session-start')
  .description('SessionStart handler — inject in-progress state-machine summary')
  .action(async () => {
    process.exit(await hookOnSessionStart())
  })

hookCmd
  .command('on-prompt-submit')
  .description('UserPromptSubmit handler — gate intent prompts when no in-progress change')
  .action(async () => {
    process.exit(await hookOnPromptSubmit())
  })

program.parse(process.argv)
