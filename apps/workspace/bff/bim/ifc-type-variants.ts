import type { BimElement } from './types'

const CASE_SUFFIX = /(standardcase|elementedcase)$/

const normaliseType = (ifcType: string): string => ifcType.toLowerCase().replace(CASE_SUFFIX, '')

export function ifcTypeVariants(ifcType: string): string[] {
  const base = normaliseType(ifcType)
  return [base, `${base}standardcase`, `${base}elementedcase`]
}

export const matchesType = (element: BimElement, types: readonly string[]): boolean =>
  types.some((type) => normaliseType(type) === normaliseType(element.ifcType))
