import Ajv from 'ajv'
import * as fs from 'fs'
import * as path from 'path'
import {
  loadPlan,
  loadPipelineOptional,
  loadCheckOptional,
  parseDateId,
  listVersions,
  activeVersion,
  planPath,
  pipelinePath,
  checkPath,
  notebookRootIndexPath,
  notebookLibraryIndexPath,
  listNotebookTopicFiles,
  readNotebookFrontmatter,
  parseRefId,
  NOTEBOOK_LIBRARIES,
} from '../lib/yaml-io'
import { humanizeAjv, findDuplicates } from '../lib/errors'
import type {
  PlanShape,
  PipelineShape,
  CheckShape,
  NotebookAssetShape,
  IndexAssetShape,
  TopicAssetShape,
  NotebookLibrary,
} from '../lib/types'
import planSchema from '../schemas/plan.schema.json'
import pipelineSchema from '../schemas/pipeline.schema.json'
import checkSchema from '../schemas/check.schema.json'
import notebookSchema from '../schemas/notebook-asset.schema.json'

const ajv = new Ajv({ allErrors: true })
const ajvPlan = ajv.compile<PlanShape>(planSchema)
const ajvPipeline = ajv.compile<PipelineShape>(pipelineSchema)
const ajvCheck = ajv.compile<CheckShape>(checkSchema)
const ajvNotebook = ajv.compile<NotebookAssetShape>(notebookSchema)

const MAX_ATTEMPTS = 3

const AXIS_BY_LIBRARY: Record<NotebookLibrary, 'K' | 'S' | 'C'> = {
  knowledge: 'K',
  skill: 'S',
  check: 'C',
}

export interface ValidateResult {
  ok: boolean
  errors: string[]
}

function prefix(label: string, errs: string[]): string[] {
  return errs.map((e) => `[${label}] ${e}`)
}

function checkMonotonicN(
  attempts: { n: number }[],
  label: string
): string[] {
  const errors: string[] = []
  for (let i = 1; i < attempts.length; i++) {
    if (attempts[i].n < attempts[i - 1].n) {
      errors.push(
        `[${label}] attempts[${i}].n=${attempts[i].n} < attempts[${i - 1}].n=${attempts[i - 1].n} (must be non-decreasing)`
      )
    }
  }
  return errors
}

function checkFreezeIntegrity(dateId: string): string[] {
  const versions = listVersions(dateId)
  if (versions.length <= 1) return []
  const errors: string[] = []
  const latest = versions[versions.length - 1]
  for (const v of versions.slice(0, -1)) {
    for (const [name, fn] of [
      ['plan.yaml', planPath],
      ['pipeline.yaml', pipelinePath],
      ['check.yaml', checkPath],
    ] as const) {
      const p = fn(dateId, v)
      if (!fs.existsSync(p)) {
        errors.push(
          `[freeze] frozen v${v} missing ${name}; v${v}/ must keep all three (plan/pipeline/check) when v${latest} exists`
        )
      }
    }
  }
  return errors
}

function parseNotebookAsset(
  filePath: string,
  label: string
): { errors: string[]; fm: NotebookAssetShape | null } {
  const fm = readNotebookFrontmatter(filePath)
  if (fm === null) {
    return {
      errors: [
        `[${label}] missing or malformed frontmatter: ${path.relative(process.cwd(), filePath)}`,
      ],
      fm: null,
    }
  }
  if (!ajvNotebook(fm)) {
    return {
      errors: prefix(label, humanizeAjv(ajvNotebook.errors ?? [])),
      fm: null,
    }
  }
  return { errors: [], fm: fm as NotebookAssetShape }
}

function validateRootIndex(): string[] {
  const errors: string[] = []
  const root = parseNotebookAsset(notebookRootIndexPath(), 'notebook')
  errors.push(...root.errors)
  if (!root.fm) return errors
  if (root.fm.kind !== 'index') {
    errors.push(`[notebook] root INDEX.md must have kind: index`)
    return errors
  }
  if (root.fm.scope !== 'notebook') {
    errors.push(
      `[notebook] root INDEX.md scope must be "notebook", got "${root.fm.scope}"`
    )
  }
  return errors
}

function validateLibraryIndex(
  lib: NotebookLibrary
): { errors: string[]; refIds: Set<string> } {
  const label = `notebook.${lib}`
  const libIndexPath = notebookLibraryIndexPath(lib)
  const expectedScope = `notebook.${lib}` as const
  const expectedAxis = AXIS_BY_LIBRARY[lib]
  const errors: string[] = []
  const refIds = new Set<string>()

  if (!fs.existsSync(libIndexPath)) {
    return { errors: [`[${label}] missing INDEX.md`], refIds }
  }

  const parsed = parseNotebookAsset(libIndexPath, label)
  errors.push(...parsed.errors)
  if (!parsed.fm) return { errors, refIds }

  if (parsed.fm.kind !== 'index') {
    errors.push(`[${label}] INDEX.md must have kind: index`)
    return { errors, refIds }
  }

  const libFm = parsed.fm as IndexAssetShape
  if (libFm.scope !== expectedScope) {
    errors.push(
      `[${label}] INDEX.md scope must be "${expectedScope}", got "${libFm.scope}"`
    )
  }

  const refDirAbs = path.dirname(libIndexPath)
  for (const ref of libFm.references) {
    if (refIds.has(ref.ref_id)) {
      errors.push(`[${label}] duplicate reference ref_id: "${ref.ref_id}"`)
    } else {
      refIds.add(ref.ref_id)
    }
    const axis = parseRefId(ref.ref_id)?.axis
    if (axis && axis !== expectedAxis) {
      errors.push(
        `[${label}] reference ref_id "${ref.ref_id}" axis mismatch: expected ${expectedAxis}-NN`
      )
    }
    if (!fs.existsSync(path.resolve(refDirAbs, ref.file))) {
      errors.push(
        `[${label}] dead reference: ${ref.ref_id} → ${ref.file} (file not found)`
      )
    }
  }

  return { errors, refIds }
}

function validateTopicFile(
  lib: NotebookLibrary,
  topicPath: string,
  refIds: Set<string>
): string[] {
  const label = `notebook.${lib}`
  const fname = path.basename(topicPath)
  const expectedScope = `notebook.${lib}` as const
  const expectedAxis = AXIS_BY_LIBRARY[lib]
  const errors: string[] = []

  const parsed = parseNotebookAsset(topicPath, label)
  errors.push(...parsed.errors)
  if (!parsed.fm) return errors

  if (parsed.fm.kind !== 'topic') {
    errors.push(`[${label}] ${fname} must have kind: topic`)
    return errors
  }

  const topicFm = parsed.fm as TopicAssetShape
  if (topicFm.scope !== expectedScope) {
    errors.push(
      `[${label}] topic ${fname} scope must be "${expectedScope}", got "${topicFm.scope}"`
    )
  }
  if (topicFm.library !== lib) {
    errors.push(
      `[${label}] topic ${fname} library must be "${lib}", got "${topicFm.library}"`
    )
  }
  const axis = parseRefId(topicFm.ref_id)?.axis
  if (axis && axis !== expectedAxis) {
    errors.push(
      `[${label}] topic ${fname} ref_id "${topicFm.ref_id}" axis mismatch: expected ${expectedAxis}-NN`
    )
  }
  if (!refIds.has(topicFm.ref_id)) {
    errors.push(
      `[${label}] orphan topic: ${fname} (ref_id ${topicFm.ref_id} not in INDEX.references)`
    )
  }
  return errors
}

export function validateNotebook(): string[] {
  if (!fs.existsSync(notebookRootIndexPath())) return []

  const errors: string[] = []
  errors.push(...validateRootIndex())

  for (const lib of NOTEBOOK_LIBRARIES) {
    const { errors: libErrs, refIds } = validateLibraryIndex(lib)
    errors.push(...libErrs)
    for (const topicPath of listNotebookTopicFiles(lib)) {
      errors.push(...validateTopicFile(lib, topicPath, refIds))
    }
  }

  return errors
}

export function validate(dateId: string): ValidateResult {
  let parsedId: string
  try {
    parsedId = parseDateId(dateId)
  } catch (e) {
    return { ok: false, errors: [(e as Error).message] }
  }

  let version: number
  try {
    version = activeVersion(dateId)
  } catch (e) {
    return { ok: false, errors: [(e as Error).message] }
  }

  let plan: unknown
  try {
    plan = loadPlan(dateId, version)
  } catch (e) {
    return { ok: false, errors: [(e as Error).message] }
  }

  if (!ajvPlan(plan)) {
    return { ok: false, errors: prefix('plan', humanizeAjv(ajvPlan.errors ?? [])) }
  }
  const p = plan as PlanShape
  const errors: string[] = []

  if (p.id !== parsedId) {
    errors.push(
      `[plan] id "${p.id}" does not match parsed id from dateId "${parsedId}"`
    )
  }

  errors.push(...prefix('plan', findDuplicates(p.asks, 'q', 'asks')))
  errors.push(...prefix('plan', findDuplicates(p.checks, 'id', 'checks')))
  errors.push(...prefix('plan', findDuplicates(p.tasks, 'id', 'tasks')))

  const checkIds = new Set(p.checks.map((c) => c.id))
  for (const t of p.tasks) {
    if (!checkIds.has(t.verify)) {
      errors.push(
        `[plan] tasks[id=${t.id}].verify references unknown check: "${t.verify}"`
      )
    }
  }

  errors.push(...checkFreezeIntegrity(dateId))

  const pipelineRaw = loadPipelineOptional(dateId, version)
  if (pipelineRaw !== null) {
    if (!ajvPipeline(pipelineRaw)) {
      errors.push(...prefix('pipeline', humanizeAjv(ajvPipeline.errors ?? [])))
    } else {
      const pipeline = pipelineRaw as PipelineShape
      if (pipeline.id !== parsedId) {
        errors.push(
          `[pipeline] id "${pipeline.id}" does not match parsed id "${parsedId}"`
        )
      }
      errors.push(...checkMonotonicN(pipeline.attempts, 'pipeline'))
      if (pipeline.attempts.length > MAX_ATTEMPTS) {
        errors.push(
          `[pipeline] attempts.length=${pipeline.attempts.length} exceeds MAX_ATTEMPTS=${MAX_ATTEMPTS}`
        )
      }
      const planTaskIds = new Set(p.tasks.map((t) => t.id))
      for (const a of pipeline.attempts) {
        for (const tr of a.task_results) {
          if (!planTaskIds.has(tr.id)) {
            errors.push(
              `[pipeline] attempts[n=${a.n}].task_results.id "${tr.id}" not in plan.tasks`
            )
          }
        }
      }
    }
  }

  const checkRaw = loadCheckOptional(dateId, version)
  if (checkRaw !== null) {
    if (!ajvCheck(checkRaw)) {
      errors.push(...prefix('check', humanizeAjv(ajvCheck.errors ?? [])))
    } else {
      const c = checkRaw as CheckShape
      if (c.id !== parsedId) {
        errors.push(`[check] id "${c.id}" does not match parsed id "${parsedId}"`)
      }
      errors.push(...checkMonotonicN(c.attempts, 'check'))
      if (c.attempts.length > MAX_ATTEMPTS) {
        errors.push(
          `[check] attempts.length=${c.attempts.length} exceeds MAX_ATTEMPTS=${MAX_ATTEMPTS}`
        )
      }
      const planCheckIds = new Set(p.checks.map((x) => x.id))
      for (const a of c.attempts) {
        for (const cr of a.check_results) {
          if (!planCheckIds.has(cr.id)) {
            errors.push(
              `[check] attempts[n=${a.n}].check_results.id "${cr.id}" not in plan.checks`
            )
          }
        }
      }
    }
  }

  return { ok: errors.length === 0, errors }
}
