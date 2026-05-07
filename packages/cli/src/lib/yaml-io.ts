import * as fs from 'fs'
import * as path from 'path'
import * as yaml from 'js-yaml'
import type { NotebookAxis, NotebookLibrary } from './types'

const SPECGUARD_ROOT = '.specguard'
const ROOT = `${SPECGUARD_ROOT}/changes`

export const DATEID_PATTERN = /^(\d{8})-([a-z][a-z0-9-]*)$/

const CHANGE_YAML_PATH_PATTERN =
  /\.specguard\/changes\/(\d{8}-[a-z][a-z0-9-]*)\/(spec|plan|tasks|check)\.yaml$/

export interface ChangeYamlPath {
  dateId: string
  kind: 'spec' | 'plan' | 'tasks' | 'check'
}

export function parseChangeYamlPath(filePath: string): ChangeYamlPath | null {
  const m = CHANGE_YAML_PATH_PATTERN.exec(filePath)
  if (!m) return null
  return {
    dateId: m[1],
    kind: m[2] as ChangeYamlPath['kind'],
  }
}

export const configPath = (): string =>
  path.resolve(SPECGUARD_ROOT, 'config.yaml')

export const notebookDir = (subdir?: NotebookLibrary): string =>
  subdir
    ? path.resolve(SPECGUARD_ROOT, 'notebook', subdir)
    : path.resolve(SPECGUARD_ROOT, 'notebook')

export const changesRoot = (): string => path.resolve(ROOT)

export function parseDateId(dateId: string): string {
  const m = DATEID_PATTERN.exec(dateId)
  if (!m) {
    throw new Error(
      `invalid dateId "${dateId}"; expected YYYYMMDD-<kebab-id> (e.g. 20260504-add-auth)`
    )
  }
  return m[2]
}

export const changeDir = (dateId: string): string =>
  path.resolve(ROOT, dateId)

export const specPath = (dateId: string): string =>
  path.resolve(changeDir(dateId), 'spec.yaml')

export const planPath = (dateId: string): string =>
  path.resolve(changeDir(dateId), 'plan.yaml')

export const tasksPath = (dateId: string): string =>
  path.resolve(changeDir(dateId), 'tasks.yaml')

export const checkPath = (dateId: string): string =>
  path.resolve(changeDir(dateId), 'check.yaml')

export const taskDir = (dateId: string, taskId: string): string =>
  path.resolve(changeDir(dateId), 'tasks', taskId)

export const taskPromptPath = (dateId: string, taskId: string): string =>
  path.resolve(taskDir(dateId, taskId), 'prompt.md')

export const taskDebugLogPath = (dateId: string, taskId: string): string =>
  path.resolve(taskDir(dateId, taskId), 'debug.log')

export function isENOENT(e: unknown): boolean {
  return (e as NodeJS.ErrnoException)?.code === 'ENOENT'
}

export function readYamlOptional(p: string): unknown | null {
  try {
    return yaml.load(fs.readFileSync(p, 'utf8'))
  } catch (e) {
    if (isENOENT(e)) return null
    throw e
  }
}

export function writeYaml(p: string, data: unknown): void {
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, yaml.dump(data, { noRefs: true, lineWidth: 120 }))
}

export function loadSpec(dateId: string): unknown {
  const p = specPath(dateId)
  try {
    return yaml.load(fs.readFileSync(p, 'utf8'))
  } catch (e) {
    if (isENOENT(e)) throw new Error(`spec.yaml not found: ${p}`)
    throw e
  }
}

export function loadSpecOptional(dateId: string): unknown | null {
  return readYamlOptional(specPath(dateId))
}

export function loadPlanOptional(dateId: string): unknown | null {
  return readYamlOptional(planPath(dateId))
}

export function loadTasksOptional(dateId: string): unknown | null {
  return readYamlOptional(tasksPath(dateId))
}

export function loadCheckOptional(dateId: string): unknown | null {
  return readYamlOptional(checkPath(dateId))
}

export function saveTasks(dateId: string, data: unknown): void {
  writeYaml(tasksPath(dateId), data)
}

export function saveCheck(dateId: string, data: unknown): void {
  writeYaml(checkPath(dateId), data)
}

export function listTaskDirs(dateId: string): string[] {
  const dir = path.resolve(changeDir(dateId), 'tasks')
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch (e) {
    if (isENOENT(e)) return []
    throw e
  }
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()
}

export const NOTEBOOK_LIBRARIES: readonly NotebookLibrary[] = [
  'knowledge',
  'skill',
  'check',
] as const

export const notebookRootIndexPath = (): string =>
  path.resolve(SPECGUARD_ROOT, 'notebook', 'INDEX.md')

export const notebookLibraryIndexPath = (library: NotebookLibrary): string =>
  path.resolve(SPECGUARD_ROOT, 'notebook', library, 'INDEX.md')

export const notebookTopicPath = (library: NotebookLibrary, topic: string): string =>
  path.resolve(SPECGUARD_ROOT, 'notebook', library, `${topic}.md`)

export function todayDateId(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}${m}${day}`
}

export function frontmatterBlock(data: Record<string, unknown>): string {
  return `---\n${yaml.dump(data, { noRefs: true, lineWidth: 120 })}---\n`
}

const REF_ID_PATTERN = /^([KSC])-(\d{2})$/

export interface ParsedRefId {
  axis: NotebookAxis
  n: number
}

export function parseRefId(s: string): ParsedRefId | null {
  const m = REF_ID_PATTERN.exec(s)
  if (!m) return null
  return {
    axis: m[1] as NotebookAxis,
    n: parseInt(m[2], 10),
  }
}

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/

export function readNotebookFrontmatter(filePath: string): unknown | null {
  let raw: string
  try {
    raw = fs.readFileSync(filePath, 'utf8')
  } catch (e) {
    if (isENOENT(e)) return null
    throw e
  }
  const m = FRONTMATTER_PATTERN.exec(raw)
  if (!m) return null
  try {
    return yaml.load(m[1])
  } catch {
    return null
  }
}

export function listNotebookTopicFiles(library: NotebookLibrary): string[] {
  const dir = path.resolve(SPECGUARD_ROOT, 'notebook', library)
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch (e) {
    if (isENOENT(e)) return []
    throw e
  }
  return entries
    .filter(
      (e) => e.isFile() && e.name.endsWith('.md') && e.name !== 'INDEX.md'
    )
    .map((e) => path.resolve(dir, e.name))
    .sort()
}
