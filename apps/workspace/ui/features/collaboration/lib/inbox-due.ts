import type { Translator } from '@/i18n/translate'
import { formatDayRange } from '@/lib/format'
import { INBOX_TYPE_PRESENTATION, UNKNOWN_TYPE_PRESENTATION, type InboxItemView } from '@/lib/inbox/types'

export interface InboxDue {
  label: string
  variant: 'danger' | 'warning' | 'secondary'
}

export function inboxDue(item: InboxItemView, t: Translator, locale?: string): InboxDue | null {
  const presentation = INBOX_TYPE_PRESENTATION[item.type] ?? UNKNOWN_TYPE_PRESENTATION
  const open = presentation.tone === 'request' && item.actionable && item.state !== 'resolved' && item.state !== 'inert'
  if (!open || !item.dueOn) return null
  if (item.variant === 'overdue') return { label: t('inbox.due.overdue'), variant: 'danger' }
  if (item.variant === 'due_soon') return { label: t('inbox.due.soon'), variant: 'warning' }
  if (item.variant?.startsWith('due')) return null
  return { label: t('inbox.due.on', { due: formatDayRange(item.dueOn, item.dueOn, locale) }), variant: 'secondary' }
}
