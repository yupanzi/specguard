import * as fs from 'fs'
import * as path from 'path'
import * as yaml from 'js-yaml'
import type { NotebookLibrary } from './types'

const SPECGUARD_ROOT = '.specguard'
const ROOT = `${SPECGUARD_ROOT}/changes`

export const DATEID_PATTERN = /^(\d{8})-([a-z][a-z0-9-]*)$/

const CHANGE_YAML_PATH_PATTERN =
  /\.specguard\/changes\/(\d{8}-[a-z][a-z0-9-]*)\/v(\d+)\/(plan|pipeline|check)\.yaml$/

export interface ChangeYamlPath {
  dateId: string
  version: number
  kind: 'plan' | 'pipeline' | 'check'
}

export function parseChangeYamlPath(filePath: string): ChangeYamlPath | null {
  const m = CHANGE_YAML_PATH_PATTERN.exec(filePath)
  if (!m) return null
  return {
    dateId: m[1],
    version: parseInt(m[2], 10),
    kind: m[3] as ChangeYamlPath['kind'],
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

export const versionDir = (dateId: string, version: number): string =>
  path.resolve(ROOT, dateId, `v${version}`)

export const planPath = (dateId: string, version: number): string =>
  path.resolve(versionDir(dateId, version), 'plan.yaml')

export const pipelinePath = (dateId: string, version: number): string =>
  path.resolve(versionDir(dateId, version), 'pipeline.yaml')

export const checkPath = (dateId: string, version: number): string =>
  path.resolve(versionDir(dateId, version), 'check.yaml')

export const logsDir = (dateId: string, version: number, n: number): string =>
  path.resolve(versionDir(dateId, version), 'logs', `r${n}`)

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

function scanVersions(dateId: string): number[] {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(changeDir(dateId), { withFileTypes: true })
  } catch (e) {
    if (isENOENT(e)) return []
    throw e
  }
  return entries
    .filter((e) => e.isDirectory() && /^v\d+$/.test(e.name))
    .map((e) => parseInt(e.name.slice(1), 10))
    .filter((n) => n > 0)
    .sort((a, b) => a - b)
}

export function listVersions(dateId: string): number[] {
  return scanVersions(dateId)
}

export function activeVersion(dateId: string): number {
  const versions = scanVersions(dateId)
  if (versions.length === 0) {
    throw new Error(`no version directories found in ${changeDir(dateId)}`)
  }
  return versions[versions.length - 1]
}

export function loadPlan(dateId: string, version: number): unknown {
  const p = planPath(dateId, version)
  try {
    return yaml.load(fs.readFileSync(p, 'utf8'))
  } catch (e) {
    if (isENOENT(e)) throw new Error(`plan.yaml not found: ${p}`)
    throw e
  }
}

export function loadPipelineOptional(
  dateId: string,
  version: number
): unknown | null {
  return readYamlOptional(pipelinePath(dateId, version))
}

export function loadCheckOptional(
  dateId: string,
  version: number
): unknown | null {
  return readYamlOptional(checkPath(dateId, version))
}

export function saveCheck(
  dateId: string,
  version: number,
  data: unknown
): void {
  writeYaml(checkPath(dateId, version), data)
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
  axis: 'K' | 'S' | 'C'
  n: number
}

export function parseRefId(s: string): ParsedRefId | null {
  const m = REF_ID_PATTERN.exec(s)
  if (!m) return null
  return {
    axis: m[1] as 'K' | 'S' | 'C',
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
