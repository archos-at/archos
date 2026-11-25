import type { Translator } from '@/i18n/translate'
import { formatCalendarDay } from '@/lib/format'
import {
  inboxTypePresentation,
  UNKNOWN_TYPE_PRESENTATION,
  type InboxItemView,
} from '@/lib/inbox/types'

export interface InboxDue {
  label: string
  urgency: 'overdue' | 'soon' | 'date'
}

export function inboxDue(item: InboxItemView, t: Translator, locale?: string): InboxDue | null {
  const presentation = inboxTypePresentation(item.type) ?? UNKNOWN_TYPE_PRESENTATION
  const open =
    presentation.tone === 'request' &&
    item.actionable &&
    item.state !== 'resolved' &&
    item.state !== 'inert'
  if (!open || !item.dueOn) return null
  if (item.variant === 'overdue') return { label: t('inbox.due.overdue'), urgency: 'overdue' }
  if (item.variant === 'due_soon') return { label: t('inbox.due.soon'), urgency: 'soon' }
  if (item.variant?.startsWith('due')) return null
  return {
    label: t('inbox.due.on', { due: formatCalendarDay(item.dueOn, locale) }),
    urgency: 'date',
  }
}
