import type { Translator } from '@/i18n'
import type { DimensionCheckData } from '@/shared/cards/schemas'
import { fmtDim } from './dimension-format'

export const pick = (
  dims: DimensionCheckData[],
  keywords: string[],
  unitIs?: string
): DimensionCheckData | undefined =>
  dims.find((d) => {
    const label = d.label.toLowerCase()
    if (keywords.some((k) => label.includes(k))) return true
    return unitIs != null && (d.unit ?? 'cm') === unitIs
  })

export const label = (d: DimensionCheckData, t: Translator): string => fmtDim(d.value, d.unit ?? 'cm', t)

export const toMetres = (d: DimensionCheckData | undefined): number | null =>
  d?.value == null ? null : (d.unit ?? 'cm') === 'cm' ? d.value / 100 : d.value
