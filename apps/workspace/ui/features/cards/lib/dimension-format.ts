import type { Translator } from '@/i18n'
import type { Provenance } from '@/shared/cards/schemas'

export const missingLabel = (t: Translator): string => t('cards.kit.missingValue')

const numberFormat = new Intl.NumberFormat('de-AT', { maximumFractionDigits: 2 })

export const fmtNum = (value: number): string => numberFormat.format(value)

export const fmtDim = (value: number | null | undefined, unit: string, t: Translator): string =>
  value == null ? missingLabel(t) : `${fmtNum(value)} ${unit}`

export const fmtComparator = (comparator: '<=' | '>=' | null | undefined): string =>
  comparator === '<=' ? '≤' : comparator === '>=' ? '≥' : ''

export const provenanceLabel = (provenance: Provenance, t: Translator): string => {
  switch (provenance) {
    case 'declared':
      return t('cards.kit.provenance.declared')
    case 'computed':
      return t('cards.kit.provenance.computed')
    case 'inferred':
      return t('cards.kit.provenance.inferred')
  }
}

export const provenanceTitle = (provenance: Provenance, t: Translator): string => {
  switch (provenance) {
    case 'declared':
      return t('cards.kit.provenanceTitle.declared')
    case 'computed':
      return t('cards.kit.provenanceTitle.computed')
    case 'inferred':
      return t('cards.kit.provenanceTitle.inferred')
  }
}

export const fmtTolerance = (tolerance: number | null | undefined, unit: string): string | null => {
  if (tolerance == null || !Number.isFinite(tolerance) || tolerance <= 0) return null
  const magnitude = Math.floor(Math.log10(Math.abs(tolerance)))
  const decimals = Math.min(6, Math.max(0, 1 - magnitude))
  return `±${new Intl.NumberFormat('de-AT', { maximumFractionDigits: decimals }).format(tolerance)} ${unit}`
}
