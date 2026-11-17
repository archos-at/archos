import { z } from 'zod'
import { foldForScreening } from './name-screen'
import { normalizeTermList, type UploadScreeningPolicy } from './policy'

export interface ProjectScreeningOverride {
  addedNameTerms: string[]
  removedNameTerms: string[]
}

export const EMPTY_PROJECT_OVERRIDE: ProjectScreeningOverride = { addedNameTerms: [], removedNameTerms: [] }

export const MAX_PROJECT_ADDED_TERMS = 50
export const MAX_PROJECT_REMOVED_TERMS = 200
const MAX_TERM_LENGTH = 80

const projectTermList = (max: number) =>
  z
    .array(z.string().max(MAX_TERM_LENGTH * 2))
    .max(max)
    .transform((terms) => normalizeTermList(terms))
    .refine((terms) => terms.every((term) => term.length <= MAX_TERM_LENGTH), {
      message: `A term is at most ${MAX_TERM_LENGTH} characters`,
    })

export const projectScreeningOverrideSchema = z
  .object({
    addedNameTerms: projectTermList(MAX_PROJECT_ADDED_TERMS),
    removedNameTerms: projectTermList(MAX_PROJECT_REMOVED_TERMS),
  })
  .strict()

const termKey = (term: string): string => foldForScreening(term.trim())

export function isEmptyOverride(override: ProjectScreeningOverride): boolean {
  return override.addedNameTerms.length === 0 && override.removedNameTerms.length === 0
}

export function effectiveOverride(
  office: UploadScreeningPolicy,
  override: ProjectScreeningOverride
): ProjectScreeningOverride {
  const officeKeys = new Set(office.nameTerms.map(termKey))
  const removedNameTerms = normalizeTermList(override.removedNameTerms).filter((term) => officeKeys.has(termKey(term)))
  const removedKeys = new Set(removedNameTerms.map(termKey))
  const addedNameTerms = normalizeTermList(override.addedNameTerms).filter((term) => {
    const key = termKey(term)
    return !officeKeys.has(key) && !removedKeys.has(key)
  })
  return { addedNameTerms, removedNameTerms }
}

export function applyProjectOverride(
  office: UploadScreeningPolicy,
  override: ProjectScreeningOverride | null
): UploadScreeningPolicy {
  if (!office.enabled || !override || isEmptyOverride(override)) return office
  const { addedNameTerms, removedNameTerms } = effectiveOverride(office, override)
  const removed = new Set(removedNameTerms.map(termKey))
  return {
    ...office,
    nameTerms: [...office.nameTerms.filter((term) => !removed.has(termKey(term))), ...addedNameTerms],
  }
}
