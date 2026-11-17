import type { Translator } from '@/i18n'
import type { DimStatus } from '@/shared/cards/schemas'

export const statusColor = (status: DimStatus): string => {
  switch (status) {
    case 'pass':
      return 'var(--text-color-feedback-success)'
    case 'fail':
      return 'var(--text-color-feedback-danger)'
    case 'warning':
      return 'var(--text-color-feedback-warning)'
    case 'needs_input':
      return 'var(--muted-foreground)'
  }
}

export const statusLabel = (status: DimStatus, t: Translator): string => {
  switch (status) {
    case 'pass':
      return t('cards.kit.status.pass')
    case 'fail':
      return t('cards.kit.status.fail')
    case 'warning':
      return t('cards.kit.status.warning')
    case 'needs_input':
      return t('cards.kit.status.needsInput')
  }
}

const STATUS_RANK: Record<DimStatus, number> = { fail: 3, needs_input: 2, warning: 1, pass: 0 }

export const worstStatus = (statuses: DimStatus[]): DimStatus | null => {
  if (statuses.length === 0) return null
  return statuses.reduce((worst, s) => (STATUS_RANK[s] > STATUS_RANK[worst] ? s : worst))
}
