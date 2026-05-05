import type { ErrorObject } from 'ajv'

export function humanizeAjv(errs: ErrorObject[]): string[] {
  return errs.map((e) => {
    const loc = e.instancePath || '(root)'
    if (e.keyword === 'required') {
      return `${loc} missing required field: ${(e.params as { missingProperty: string }).missingProperty}`
    }
    if (e.keyword === 'additionalProperties') {
      return `${loc} unknown field: ${(e.params as { additionalProperty: string }).additionalProperty}`
    }
    if (e.keyword === 'pattern') {
      return `${loc} does not match required pattern: ${(e.params as { pattern: string }).pattern}`
    }
    if (e.keyword === 'enum') {
      const allowed = (e.params as { allowedValues: unknown[] }).allowedValues
      return `${loc} must be one of: ${JSON.stringify(allowed)}`
    }
    if (e.keyword === 'minLength' || e.keyword === 'minItems') {
      return `${loc} ${e.message ?? 'too short'}`
    }
    return `${loc} ${e.message ?? 'invalid'}`
  })
}

export function findDuplicates<T, K extends keyof T>(
  items: T[],
  key: K,
  label: string
): string[] {
  const seen = new Map<unknown, number>()
  const dups: string[] = []
  items.forEach((item, i) => {
    const v = item[key]
    if (seen.has(v)) {
      dups.push(`${label}[${i}].${String(key)} duplicate value: "${String(v)}"`)
    } else {
      seen.set(v, i)
    }
  })
  return dups
}
