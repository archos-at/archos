import { getByPath, type Translator } from '@/i18n/translate'
import { formatDayRange } from '@/lib/format'
import {
  INBOUND_MAIL_EXPIRING_NOTICE_DAYS,
  INBOUND_MAIL_RESTORE_DAYS,
  MAIL_THREAD_FOLLOW_EXPIRING_NOTICE_DAYS,
} from '@/lib/inbound-mail/inbound-mail-vocabulary'
import { inboxTypePresentation, UNKNOWN_TYPE_PRESENTATION, type InboxItemView } from './types'

const TYPES_PATH = 'collaboration.inbox.types'

function pickKey(dictionary: unknown, i18nKey: string, candidates: readonly string[]): string | null {
  for (const leaf of candidates) {
    if (typeof getByPath(dictionary, `${TYPES_PATH}.${i18nKey}.${leaf}`) === 'string') return leaf
  }
  return null
}

function withVariant(variant: string | null, leaves: readonly string[]): string[] {
  return variant ? [...leaves.map((leaf) => `variants.${variant}.${leaf}`), ...leaves] : [...leaves]
}

function resourceLeaf(resourceType: string | undefined): string {
  return (resourceType ?? '')
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')
}

export interface InboxItemCopy {
  title: string
  body: string | null
}

export function inboxItemCopy(item: InboxItemView, t: Translator, dictionary: unknown, locale?: string): InboxItemCopy {
  const presentation = inboxTypePresentation(item.type) ?? UNKNOWN_TYPE_PRESENTATION
  const redacted = !item.href

  const vars = {
    actor: item.actorName ?? t('inbox.unknownActor'),
    subject: item.subject ?? t(redacted ? 'inbox.inert' : 'inbox.untitledConversation'),
    related: item.related ?? '',
    excerpt: item.excerpt ?? '',
    via: item.via ?? '',
    count: item.count,
    due: item.dueOn ? formatDayRange(item.dueOn, item.dueOn, locale) : '',
    marks: item.openMarks ?? 0,
    revision: item.marksRevision ?? '',
    restoreDays: INBOUND_MAIL_RESTORE_DAYS,
    noticeDays: INBOUND_MAIL_EXPIRING_NOTICE_DAYS,
    followNoticeDays: MAIL_THREAD_FOLLOW_EXPIRING_NOTICE_DAYS,
  }

  const countedTitles =
    item.count > 1 ? ['titleMany', 'title'] : item.count === 1 ? ['titleOne', 'title'] : ['titleNone', 'titleOne', 'title']
  const related = (leaf: string) =>
    item.count > 1 ? [`${leaf}Many`, leaf] : item.count === 0 ? [`${leaf}None`, leaf] : [leaf]
  const withoutActor = (leaves: readonly string[]) =>
    item.actorName === null ? leaves.flatMap((leaf) => [`${leaf}NoActor`, leaf]) : [...leaves]
  const titleCandidates = withVariant(item.variant, [
    ...(redacted ? ['titleRedacted'] : []),
    ...(item.state === 'resolved' ? withoutActor(['titleResolved']) : []),
    ...withoutActor([
      ...(item.related !== null && !redacted
        ? [...(item.subject === null ? related('titleRelatedNoSubject') : []), ...related('titleRelated')]
        : []),
      ...countedTitles,
    ]),
  ])
  const titleLeaf = pickKey(dictionary, presentation.i18nKey, titleCandidates) ?? 'title'
  const title = t(`inbox.types.${presentation.i18nKey}.${titleLeaf}`, vars)
  const bodyLeaf = pickKey(
    dictionary,
    presentation.i18nKey,
    withVariant(item.variant, [
      ...(item.answerIn === 'review' ? ['bodyInReview'] : []),
      ...(item.subject === null ? ['bodyNoSubject'] : []),
      ...(item.excerpt === null ? ['bodyNoExcerpt'] : []),
      ...(item.count > 1 ? ['bodyMany'] : []),
      ...(item.dueOn ? ['bodyDue'] : []),
      `body${resourceLeaf(item.resourceType)}`,
      'body',
    ]),
  )
  const body = redacted
    ? t('inbox.bodyUnavailable')
    : bodyLeaf
      ? t(`inbox.types.${presentation.i18nKey}.${bodyLeaf}`, vars)
      : null

  return { title, body }
}
