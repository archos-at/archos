import type { Translator } from '@/i18n/translate'
import { INBOX_TYPE_PRESENTATION, type InboxItemView } from '@/lib/inbox/types'

const REASONS: Record<string, { key: string; actor: boolean }> = {
  annotationAssigned: { key: 'assigned', actor: true },
  annotationMentioned: { key: 'mentioned', actor: true },
  agentAsksYou: { key: 'asks', actor: false },
  mentionRequested: { key: 'input', actor: true },
  documentReviewRequested: { key: 'approval', actor: true },
}

export function inboxReason(item: InboxItemView, t: Translator): string | null {
  const i18nKey = INBOX_TYPE_PRESENTATION[item.type]?.i18nKey
  const reason = i18nKey ? REASONS[i18nKey] : undefined
  if (!reason) return null
  const who =
    reason.actor && !item.actorName
      ? t(`inbox.reason.${reason.key}NoActor`)
      : t(`inbox.reason.${reason.key}`, { actor: item.actorName ?? '' })
  const markNumber = item.resourceType === 'document' && item.type !== 'document.review_requested' ? item.related : null
  return markNumber ? `${who} · ${t('inbox.reason.mark', { number: markNumber })}` : who
}
