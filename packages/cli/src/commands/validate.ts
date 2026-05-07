import Ajv, { ValidateFunction } from 'ajv'
import * as fs from 'fs'
import * as path from 'path'
import {
  loadSpecOptional,
  loadPlanOptional,
  loadTasksOptional,
  loadCheckOptional,
  parseDateId,
  listTaskDirs,
  notebookRootIndexPath,
  notebookLibraryIndexPath,
  listNotebookTopicFiles,
  readNotebookFrontmatter,
  parseRefId,
  NOTEBOOK_LIBRARIES,
} from '../lib/yaml-io'
import { humanizeAjv, findDuplicates } from '../lib/errors'
import type {
  SpecShape,
  PlanShape,
  TasksShape,
  CheckShape,
  NotebookAssetShape,
  IndexAssetShape,
  TopicAssetShape,
  NotebookAxis,
  NotebookLibrary,
} from '../lib/types'
import specSchema from '../schemas/spec.schema.json'
import planSchema from '../schemas/plan.schema.json'
import tasksSchema from '../schemas/tasks.schema.json'
import checkSchema from '../schemas/check.schema.json'
import notebookSchema from '../schemas/notebook-asset.schema.json'

const ajv = new Ajv({ allErrors: true })
const ajvSpec = ajv.compile<SpecShape>(specSchema)
const ajvPlan = ajv.compile<PlanShape>(planSchema)
const ajvTasks = ajv.compile<TasksShape>(tasksSchema)
const ajvCheck = ajv.compile<CheckShape>(checkSchema)
const ajvNotebook = ajv.compile<NotebookAssetShape>(notebookSchema)

const AXIS_BY_LIBRARY: Record<NotebookLibrary, NotebookAxis> = {
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

function loadAndValidateOptional<T>(
  raw: unknown | null,
  validator: ValidateFunction<T>,
  label: string,
  errors: string[]
): T | null {
  if (raw === null) return null
  if (!validator(raw)) {
    errors.push(...prefix(label, humanizeAjv(validator.errors ?? [])))
    return null
  }
  return raw as T
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

function validateCrossFiles(
  parsedId: string,
  spec: SpecShape,
  plan: PlanShape | null,
  tasks: TasksShape | null,
  check: CheckShape | null
): string[] {
  const errors: string[] = []

  if (spec.id !== parsedId) {
    errors.push(
      `[spec] id "${spec.id}" does not match parsed id from dateId "${parsedId}"`
    )
  }
  if (plan && plan.id !== parsedId) {
    errors.push(`[plan] id "${plan.id}" does not match parsed id "${parsedId}"`)
  }
  if (tasks && tasks.id !== parsedId) {
    errors.push(
      `[tasks] id "${tasks.id}" does not match parsed id "${parsedId}"`
    )
  }
  if (check && check.id !== parsedId) {
    errors.push(`[check] id "${check.id}" does not match parsed id "${parsedId}"`)
  }

  const checkIds = new Set(spec.checks.map((c) => c.id))
  if (tasks) {
    for (const t of tasks.tasks) {
      if (!checkIds.has(t.verify)) {
        errors.push(
          `[tasks] tasks[id=${t.id}].verify references unknown spec.checks.id: "${t.verify}"`
        )
      }
    }
  }
  if (check) {
    for (const cr of check.check_results) {
      if (!checkIds.has(cr.id)) {
        errors.push(
          `[check] check_results.id "${cr.id}" not in spec.checks`
        )
      }
    }
  }

  return errors
}

function checkOrphanTaskDirs(
  dateId: string,
  tasks: TasksShape | null
): string[] {
  const dirs = listTaskDirs(dateId)
  if (dirs.length === 0) return []
  const errors: string[] = []
  const known = new Set(tasks?.tasks.map((t) => t.id) ?? [])
  for (const d of dirs) {
    if (!known.has(d)) {
      errors.push(
        `[tasks] orphan task directory: tasks/${d}/ has no matching entry in tasks.yaml`
      )
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

  const specRaw = loadSpecOptional(dateId)
  if (specRaw === null) {
    return {
      ok: false,
      errors: [`[spec] spec.yaml not found for dateId ${dateId}`],
    }
  }
  if (!ajvSpec(specRaw)) {
    return { ok: false, errors: prefix('spec', humanizeAjv(ajvSpec.errors ?? [])) }
  }
  const spec = specRaw as SpecShape

  const errors: string[] = []
  errors.push(...prefix('spec', findDuplicates(spec.asks, 'q', 'asks')))
  errors.push(...prefix('spec', findDuplicates(spec.checks, 'id', 'checks')))

  const plan = loadAndValidateOptional<PlanShape>(
    loadPlanOptional(dateId),
    ajvPlan,
    'plan',
    errors
  )
  const tasks = loadAndValidateOptional<TasksShape>(
    loadTasksOptional(dateId),
    ajvTasks,
    'tasks',
    errors
  )
  if (tasks) {
    errors.push(...prefix('tasks', findDuplicates(tasks.tasks, 'id', 'tasks')))
  }
  const check = loadAndValidateOptional<CheckShape>(
    loadCheckOptional(dateId),
    ajvCheck,
    'check',
    errors
  )

  errors.push(...validateCrossFiles(parsedId, spec, plan, tasks, check))
  errors.push(...checkOrphanTaskDirs(dateId, tasks))

  return { ok: errors.length === 0, errors }
}
